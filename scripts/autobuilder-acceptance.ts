#!/usr/bin/env bun
/** Bounded, operator-declared input scope; never a dependency discovery or release gate. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { FreeRunReporter } from './test-free-shards';
import { BunTestOutputClassifier, installChildSignalForwarding } from './test-strict-output';

type Check = { id: string; files: string[]; inputs: string[]; environment: string[];
  scope: { status: 'declared-complete' | 'unknown'; note: string; unresolved: string[] }; record?: string; wallTimeoutSeconds?: number };
type Plan = { schemaVersion: string; root: string; checks: Check[]; historical?: unknown[] };
const engineRoot = path.resolve(import.meta.dir, '..');
const engineFiles = ['scripts/autobuilder-acceptance.ts', 'scripts/test-focused.ts', 'scripts/test-free-shards.ts',
  'scripts/test-strict-output.ts', 'test/helpers/paid-test-set.ts', 'test/helpers/touchfiles.ts',
  'test/helpers/touchfiles-data.ts', 'test/helpers/test-selection.ts'];
const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(s => typeof s === 'string' && s.length > 0)
    && new Set(value).size === value.length;
}
function readJSON(file: string) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function loadPlan(file: string): Plan {
  const plan = readJSON(file);
  if (plan.schemaVersion !== 'autobuilder-acceptance-plan/v1' || typeof plan.root !== 'string'
    || !Array.isArray(plan.checks) || !plan.checks.length) throw new Error('Invalid acceptance plan');
  plan.root = fs.realpathSync(path.resolve(path.dirname(file), plan.root));
  const ids = new Set();
  for (const check of plan.checks) {
    if (typeof check.id !== 'string' || !check.id || ids.has(check.id) || !strings(check.files) || !check.files.length
      || !strings(check.inputs) || !strings(check.environment) || !check.scope
      || !['declared-complete', 'unknown'].includes(check.scope.status) || typeof check.scope.note !== 'string'
      || !check.scope.note.trim() || !strings(check.scope.unresolved)
      || check.wallTimeoutSeconds != null && (!Number.isFinite(check.wallTimeoutSeconds) || check.wallTimeoutSeconds <= 0)
      || check.record != null && typeof check.record !== 'string') throw new Error('Invalid check declaration');
    ids.add(check.id);
    for (const file of check.files) {
      if (path.isAbsolute(file) || path.relative(plan.root, path.resolve(plan.root, file)).startsWith('..')
        || !check.inputs.includes(file)) throw new Error('Selected tests must belong to declared inputs inside root');
    }
    if (check.record) check.record = path.resolve(path.dirname(file), check.record);
  }
  if (plan.historical != null && !Array.isArray(plan.historical)) throw new Error('Invalid historical records');
  return plan;
}
function fingerprint(file: string) {
  try { return { path: fs.realpathSync(file), sha256: sha(fs.readFileSync(file)) }; }
  catch { return { path: path.resolve(file), sha256: null }; }
}
function snapshot(root: string, check: Check) {
  const environment = [...new Set(['PATH', 'TMPDIR', 'NODE_OPTIONS', 'BUN_OPTIONS', ...check.environment])].sort();
  return { inputs: check.inputs.map(file => ({ file, ...fingerprint(path.resolve(root, file)) })),
    engine: engineFiles.map(file => ({ file, ...fingerprint(path.join(engineRoot, file)) })),
    runtime: { ...fingerprint(process.execPath), version: Bun.version, platform: process.platform, arch: process.arch },
    environment: environment.map(name => ({ name, sha256: process.env[name] == null ? null : sha(process.env[name]!) })) };
}
function declaration(root: string, check: Check) {
  const { record: _, ...contract } = check;
  return sha(JSON.stringify({ root, ...contract }));
}
function revision(root: string) {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', timeout: 5000 });
  return result.status === 0 ? result.stdout.trim() : null;
}
async function capture(plan: Plan, id: string) {
  const check = plan.checks.find(c => c.id === id);
  if (!check?.record) throw new Error('Capture requires a known check with an unused record path');
  if (fs.existsSync(check.record)) throw new Error('Refusing to replace an original record; use a new path');
  const before = snapshot(plan.root, check);
  if ([...before.inputs, ...before.engine, before.runtime].some(i => !i.sha256)) throw new Error('Cannot capture missing declared inputs');
  const child = spawn(process.execPath, [path.join(engineRoot, 'scripts/test-focused.ts'), '--root', plan.root,
    ...(check.wallTimeoutSeconds == null ? [] : ['--wall-timeout', String(check.wallTimeoutSeconds)]), '--', ...check.files],
    { cwd: plan.root, stdio: ['ignore', 'pipe', 'pipe'] });
  const forwarding = installChildSignalForwarding(child);
  let stdout = ''; let stderr = '';
  child.stdout!.on('data', data => { stdout += data; });
  child.stderr!.on('data', data => { stderr += data; });
  const exitCode = await new Promise<number | null>((resolve, reject) => { child.on('error', reject); child.on('close', resolve); });
  forwarding.dispose();
  const after = snapshot(plan.root, check);
  let receipt: any = null;
  try { receipt = JSON.parse(stdout); } catch { /* preserve failed launch as incomplete, never fabricate receipt */ }
  const record = { schemaVersion: 'autobuilder-acceptance-record/v1', checkId: id, capturedAt: new Date().toISOString(),
    declaration: declaration(plan.root, check), before, after, exitCode, receipt,
    receiptFile: receipt?.receiptPath ? fingerprint(receipt.receiptPath) : null,
    log: receipt?.logPath ? fingerprint(receipt.logPath) : null, stderr,
    runId: receipt?.runId ?? null };
  fs.writeFileSync(check.record, JSON.stringify(record, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify(record));
  process.exitCode = exitCode === 0 ? 0 : 1;
}
function inspectRecord(plan: Plan, check: Check) {
  const base = { id: check.id, status: 'unexecuted', applicability: 'missing', coverageCredit: false, reused: false,
    counts: null as any, failureDetails: null as any, provenance: null as any, scope: check.scope, reasons: [] as string[] };
  if (!check.record || !fs.existsSync(check.record)) return { ...base, reasons: ['No retained execution record'] };
  const reasons: string[] = [];
  let record: any;
  try { record = readJSON(check.record); if (!record || typeof record !== 'object' || Array.isArray(record)) throw new Error(); } catch { return { ...base, applicability: 'incomplete', reasons: ['Unreadable execution record'] }; }
  const receipt = record.receipt;
  const evidence = receipt?.outcome?.evidence;
  base.provenance = { record: fingerprint(check.record), runId: record.runId ?? null,
    revision: receipt?.revision ?? null, startedAt: receipt?.startedAt ?? null, completedAt: receipt?.completedAt ?? null,
    receipt: record.receiptFile ?? null, log: record.log ?? null };
  base.status = ['passed', 'failed', 'cancelled', 'timed-out', 'incomplete'].includes(receipt?.status) ? receipt.status : 'unexecuted';
  let applicable = 'applicable';
  if (record.schemaVersion !== 'autobuilder-acceptance-record/v1' || record.checkId !== check.id
    || !record.before || !record.after || !record.declaration || !receipt || !evidence) reasons.push('Missing capture metadata');
  if (check.scope.status !== 'declared-complete' || check.scope.unresolved.length) reasons.push('Consumed input scope remains unknown');
  if (record.declaration && record.before && (record.declaration !== declaration(plan.root, check) || !equal(record.before, snapshot(plan.root, check)))) {
    applicable = 'stale'; reasons.push('Declared inputs, environment, runtime, engine or selection changed');
  }
  if (!equal(record.before, record.after)) reasons.push('Consumed inputs changed during execution');
  if (!Array.isArray(record.before?.inputs) || !record.before.inputs.length || record.before.inputs.some((i: any) => !i.sha256)) reasons.push('Missing input hashes');
  try {
    if (!record.receiptFile?.sha256 || !record.log?.sha256
      || !equal(record.receiptFile, fingerprint(record.receiptFile.path))
      || !equal(record.log, fingerprint(record.log.path))) throw new Error('Retained artifacts missing or altered');
    if (!equal(readJSON(record.receiptFile.path), receipt)) throw new Error('Receipt does not match captured execution');
    if (receipt.version !== 1 || receipt.kind !== 'focused-result' || !receipt.runId || record.runId !== receipt.runId
      || !receipt.startedAt || !receipt.completedAt || receipt.plan?.root !== plan.root
      || !equal(receipt.plan?.files, check.files) || !equal(receipt.outcome?.files, check.files)
      || receipt.logPath !== record.log.path || receipt.receiptPath !== record.receiptFile.path
      || evidence.logPath !== record.log.path) throw new Error('Plan, receipt and capture disagree');
    const log = fs.readFileSync(record.log.path, 'utf8');
    const parser = new BunTestOutputClassifier(); parser.write(log); const counts = parser.end();
    const reporter = new FreeRunReporter(check.files); reporter.write(log, 'stdout'); reporter.end();
    const report = reporter.report();
    base.failureDetails = { namedFailures: report.failures, unreportedFailures: report.unreportedFailures,
      unhandledErrors: report.unhandledErrors, crashedFiles: report.crashedFiles };
    base.counts = { passed: counts.passedTests, failed: counts.failedTests, skipped: counts.skippedTests,
      unhandled: counts.unhandledBetweenTests, testsRan: report.testsRan, filesRan: report.filesRan };
    if (base.status === 'passed' && counts.skippedTests > 0) base.status = 'skipped';
    if (!equal(reporter.observedFiles(plan.root), receipt.observedFiles)
      || !equal(receipt.observedFiles, evidence.observedFiles)
      || !equal(receipt.missingFiles, check.files.filter(f => !receipt.observedFiles.includes(f)))
      || !equal(receipt.unexpectedFiles, receipt.observedFiles.filter((f: string) => !check.files.includes(f)))
      || evidence.passedTests !== counts.passedTests || evidence.failedTests !== counts.failedTests
      || evidence.skippedTests !== counts.skippedTests
      || receipt.outcome.summary?.testsRan !== report.testsRan || receipt.outcome.summary?.filesRan !== report.filesRan
      || receipt.outcome.summary?.sawTerminalSummary !== report.sawTerminalSummary) throw new Error('Retained log contradicts receipt');
    const selected = record.before.inputs.filter((i: any) => check.files.includes(i.file)).map(({ file, sha256 }: any) => ({ file, sha256 }));
    const ordered = check.files.map(f => selected.find((i: any) => i.file === f));
    if (!equal(receipt.plan.inputs, ordered) || !equal(receipt.finalInputs, ordered) || receipt.inputsUnchanged !== true)
      throw new Error('Selected input hashes disagree');
    if (report.sawTerminalSummary && (report.testsRan !== counts.passedTests + counts.failedTests + counts.skippedTests
      || report.filesRan !== check.files.length)) throw new Error('Terminal totals contradict case counts or plan');
    if (!evidence.captureComplete || !evidence.logRetained || evidence.cleanupError || !report.sawTerminalSummary
      || counts.terminalFileCounts.length !== 1 || receipt.missingFiles.length || receipt.unexpectedFiles.length)
      reasons.push('Incomplete capture or coverage');
    if (receipt.status === 'passed' && (record.exitCode !== 0 || receipt.outcome.exitCode !== 0 || receipt.outcome.status !== 'passed'
      || counts.failedTests || counts.unhandledBetweenTests || report.crashedFiles.length || receipt.outcome.unattributedFailures))
      throw new Error('Passing claim contradicts process or failure evidence');
    if (receipt.status === 'cancelled' || receipt.status === 'timed-out') reasons.push(`Execution ${receipt.status}`);
  } catch (error) { reasons.push(error instanceof Error ? error.message : 'Invalid evidence'); }
  if (reasons.length && applicable !== 'stale') applicable = 'incomplete';
  const coverageCredit = applicable === 'applicable' && base.status === 'passed' && base.counts?.passed > 0
    && receipt.coverageCredit === true;
  return { ...base, applicability: applicable, coverageCredit, reused: applicable === 'applicable', reasons };
}
function inspect(plan: Plan, check: Check) {
  try { return inspectRecord(plan, check); }
  catch { return { id: check.id, status: 'unexecuted', applicability: 'incomplete', coverageCredit: false, reused: false,
    counts: null, provenance: null, scope: check.scope, reasons: ['Malformed execution metadata'] }; }
}
function assemble(plan: Plan, planPath: string) {
  const checks = plan.checks.map(check => inspect(plan, check));
  const coverageCredit = checks.length > 0 && checks.every(check => check.coverageCredit);
  const report = { schemaVersion: 'autobuilder-acceptance-manifest/v1', plan: fingerprint(planPath), revision: revision(plan.root),
    assembledAt: new Date().toISOString(), status: coverageCredit ? 'passed' : checks.some(c => c.status === 'failed') ? 'failed' : 'incomplete',
    coverageCredit, applicabilityScope: 'Operator-declared consumed inputs only; no automatic dependency discovery, authenticated provenance or whole-release certification.',
    checks, historical: (plan.historical ?? []).map(record => ({ record, applicability: 'historical-unknown-inputs', coverageCredit: false })) };
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = coverageCredit ? 0 : 1;
}
async function main() {
  const [mode, file, id, ...extra] = process.argv.slice(2);
  if (!file || extra.length || mode === 'assemble' && id || !['capture', 'assemble'].includes(mode))
    throw new Error('usage: autobuilder-acceptance.ts capture <plan.json> <check-id> | assemble <plan.json>');
  const plan = loadPlan(path.resolve(file));
  if (mode === 'capture') await capture(plan, id); else assemble(plan, path.resolve(file));
}
if (import.meta.main) {
  try { await main(); } catch (error) { console.error(`autobuilder-acceptance: ${error instanceof Error ? error.message : String(error)}`); process.exitCode = 2; }
}
