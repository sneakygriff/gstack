#!/usr/bin/env bun
/** Exact, free-only selection adapter for the supervised free runner. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { isPaidTestFile } from '../test/helpers/paid-test-set';
import { runFreeShard, wallTimeoutForShard } from './test-free-shards';

function selection(root: string, inputs: string[]): string[] {
  const files = new Set<string>();
  for (const input of inputs) {
    const requested = path.resolve(root, input);
    const stat = fs.lstatSync(requested, { throwIfNoEntry: false });
    if (!stat?.isFile()) throw new Error(`Missing or linked test selector: ${input}`);
    const absolute = fs.realpathSync(requested);
    const relative = path.relative(root, absolute).split(path.sep).join('/');
    if (!relative || relative.startsWith('../') || path.isAbsolute(relative)
      || !/\.test\.(?:[cm]?[jt]s|tsx|jsx)$/.test(relative)) {
      throw new Error(`Invalid exact test selector: ${input}`);
    }
    if (isPaidTestFile(relative)) throw new Error(`Paid evaluation is outside focused free execution: ${input}`);
    files.add(relative);
  }
  return [...files];
}

async function main() {
  const args = process.argv.slice(2);
  let root = process.cwd();
  let planOnly = false;
  let wallTimeoutMs: number | undefined;
  const inputs: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--') { inputs.push(...args.slice(i + 1)); break; }
    if (args[i] === '--root' && args[i + 1]) root = args[++i];
    else if (args[i] === '--plan') planOnly = true;
    else if (args[i] === '--wall-timeout' && args[i + 1]) {
      wallTimeoutMs = Number(args[++i]) * 1000;
      if (!Number.isFinite(wallTimeoutMs) || wallTimeoutMs <= 0) throw new Error('Invalid wall timeout');
    }
    else throw new Error(`Unknown option: ${args[i]}; use -- before exact test paths`);
  }
  root = fs.realpathSync(root);
  const files = selection(root, inputs);
  const digestInputs = () => files.map(file => {
    try { return { file, sha256: createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex') }; }
    catch { return { file, sha256: null }; }
  });
  const plan = { version: 1, kind: 'focused-plan', root, files,
    inputs: digestInputs(), status: files.length ? 'planned' : 'no-work', coverageCredit: false };
  if (planOnly || !files.length) { console.log(JSON.stringify(plan)); return; }
  const git = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', timeout: 5000 });
  const revision = git.status === 0 && /^[a-f0-9]{40,64}$/.test(git.stdout.trim()) ? git.stdout.trim() : null;
  const startedAt = new Date().toISOString();
  const runId = randomUUID();
  const outcome = await runFreeShard(files, 1, 1, { rootDir: root, quiet: true,
    wallTimeoutMs: wallTimeoutMs ?? wallTimeoutForShard(files.length), log: line => console.error(line) });
  const evidence = outcome.evidence!;
  const observedFiles = evidence.observedFiles;
  const missingFiles = files.filter(file => !observedFiles.includes(file));
  const unexpectedFiles = observedFiles.filter(file => !files.includes(file));
  const finalInputs = digestInputs();
  const inputsUnchanged = finalInputs.every((input, i) => input.sha256 !== null && input.sha256 === plan.inputs[i].sha256);
  const status = evidence.cancellationSignal ? 'cancelled' : outcome.status === 'timed-out' ? 'timed-out'
    : !evidence.captureComplete || !evidence.logRetained || !outcome.summary?.sawTerminalSummary
      || missingFiles.length || unexpectedFiles.length || !inputsUnchanged ? 'incomplete' : outcome.status;
  const receiptPath = `${evidence.logPath}.receipt.json`;
  const receipt = { version: 1, kind: 'focused-result', runId, revision, startedAt, completedAt: new Date().toISOString(),
    plan, status, coverageCredit: status === 'passed' && evidence.passedTests > 0 && evidence.skippedTests === 0,
    inputsUnchanged, finalInputs,
    observedFiles, missingFiles, unexpectedFiles, outcome, logPath: evidence.logPath, receiptPath };
  fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify(receipt));
  process.exitCode = status === 'passed' ? 0 : status === 'cancelled'
    ? evidence.cancellationSignal === 'SIGINT' ? 130 : 143 : status === 'timed-out' ? 124 : 1;
}

if (import.meta.main) {
  try { await main(); }
  catch (error) { console.error(`[test:focused] ${error instanceof Error ? error.message : String(error)}`); process.exitCode = 1; }
}
