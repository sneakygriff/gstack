/** Local deterministic autobuilder chores. No model, network, or shell evaluation. */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const TIMEOUT_MS = 30_000;
// Only these locally-defined codes may cross the CLI boundary. Never serialize
// Error.message, filesystem paths, requests, or child-process stderr.
const REASONS = [
  'usage', 'invalid_request_json', 'invalid_request', 'lock_held', 'lock_unavailable',
  'invalid_state_or_roster', 'unsafe_state_or_roster', 'invalid_decisions', 'invalid_extra',
  'git_failed', 'invalid_meter_input', 'unreadable_untracked', 'inconsistent_meter',
  'filesystem_failed', 'operation_failed',
] as const;
type Reason = typeof REASONS[number];
export class AutobuilderOpsError extends Error {
  constructor(readonly reason: Reason) { super(reason); }
}
export function failureReason(error: unknown): Reason {
  return error instanceof AutobuilderOpsError && REASONS.includes(error.reason) ? error.reason : 'operation_failed';
}
function filesystem<T>(fn: () => T): T {
  try { return fn(); } catch { throw new AutobuilderOpsError('filesystem_failed'); }
}
export const EXCLUSIONS = ['*.lock', 'package-lock.json', 'pnpm-lock.yaml', 'bun.lockb', '*dist/*', '*build/*', '*.gen.ts', '*generated/*', '*drizzle/meta/*', '*__snapshots__/*', '*.snap'].map(p => `:(exclude)${p}`);
export const TEST_PATHS = ['**/test/**', '**/__tests__/**', '**/*.test.*', '**/*.spec.*', '**/e2e*/**'].map(p => `:(glob)${p}`);
function git(cwd: string, args: string[]): string {
  // The requested lane, not ambient Git overrides, owns the measurement/checkpoint.
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith('GIT_')) delete env[key];
  Object.assign(env, { LC_ALL: 'C', GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' });
  const prefix = ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', '-C', cwd];
  const run = (argv: string[]) => spawnSync('git', [...prefix, ...argv], { encoding: 'utf8', timeout: TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024, env });
  if (args[0] === 'diff') {
    // Like gstack-lane's inert Git path, count raw files without running clean/process
    // filters. Environment config preserves empty names and names containing '='.
    const configured = run(['config', '--null', '--name-only', '--get-regexp', '^filter\\.']);
    if (configured.error || (configured.status !== 0 && configured.status !== 1)) throw new AutobuilderOpsError('git_failed');
    const filters = new Set(configured.stdout.split('\0').filter(k => k.startsWith('filter.') && k.lastIndexOf('.') >= 7).map(k => k.slice(0, k.lastIndexOf('.'))));
    let count = 0;
    for (const filter of filters) for (const [key, value] of [['clean', 'cat'], ['smudge', 'cat'], ['process', ''], ['required', 'false']]) {
      env[`GIT_CONFIG_KEY_${count}`] = `${filter}.${key}`;
      env[`GIT_CONFIG_VALUE_${count++}`] = value;
    }
    env.GIT_CONFIG_COUNT = String(count);
  }
  const r = run(args);
  if (r.error || r.status !== 0) throw new AutobuilderOpsError('git_failed'); // never relay repo paths or stderr
  return r.stdout;
}
function object(x: unknown): x is Record<string, any> { return !!x && typeof x === 'object' && !Array.isArray(x); }
function readObject(file: string, optional = false): Record<string, any> {
  try {
    if (!fs.lstatSync(file).isFile()) throw new AutobuilderOpsError('unsafe_state_or_roster');
    const x = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!object(x)) throw new AutobuilderOpsError('invalid_state_or_roster');
    return x;
  } catch (e: any) {
    if (optional && e.code === 'ENOENT') return {};
    if (e instanceof AutobuilderOpsError) throw e;
    throw new AutobuilderOpsError('invalid_state_or_roster');
  }
}
export function updateState(r: Record<string, any>): void {
  if (!object(r) || typeof r.runDir !== 'string' || !path.isAbsolute(r.runDir) || typeof r.lane !== 'string' || !path.isAbsolute(r.lane)
      || !['unit', 'flow', 'phase', 'base'].every(k => typeof r[k] === 'string') || !Number.isInteger(r.round) || r.round < 0
      || !Array.isArray(r.decisions) || !r.decisions.every((d: unknown) => typeof d === 'string') || !object(r.extra)) throw new AutobuilderOpsError('invalid_request');
  const root = filesystem(() => fs.realpathSync(r.runDir)), file = path.join(root, 'state.json'), lock = path.join(root, '.state.lock');
  // Exclusive, fail closed. Never guess whether a leftover lock belongs to a live writer.
  try { fs.mkdirSync(lock, { mode: 0o700 }); }
  catch (e: any) { throw new AutobuilderOpsError(e.code === 'EEXIST' ? 'lock_held' : 'lock_unavailable'); }
  const tmp = path.join(lock, 'state.json');
  try {
    const old = readObject(file, true), roster = readObject(path.join(root, 'lanes.json'), true);
    if (old.open_decisions !== undefined && (!Array.isArray(old.open_decisions) || !old.open_decisions.every((d: unknown) => typeof d === 'string'))) throw new AutobuilderOpsError('invalid_decisions');
    let head: string | null = null;
    try { head = git(r.lane, ['rev-parse', '--verify', 'HEAD']).trim(); } catch { /* historical contract: null on error */ }
    const next = { ...old, workflow_run_id: old.workflow_run_id ?? null, unit: r.unit, flow: r.flow, phase: r.phase,
      round: r.round, ship_base: r.base, lane_head: head,
      lanes_roster: Object.fromEntries(Object.entries(roster).filter(([, v]) => object(v) && typeof v.status === 'string').map(([k, v]) => [k, v.status])),
      updated_at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'), open_decisions: [...new Set([...(old.open_decisions || []), ...r.decisions])] } as Record<string, any>;
    const reserved = new Set(['__proto__', 'constructor', 'prototype', 'workflow_run_id', 'unit', 'flow', 'phase', 'round', 'ship_base', 'lane_head', 'lanes_roster', 'updated_at', 'open_decisions']);
    for (const [k, v] of Object.entries(r.extra)) {
      if (reserved.has(k) || !object(v) || (old[k] !== undefined && !object(old[k]))) throw new AutobuilderOpsError('invalid_extra');
      next[k] = { ...(old[k] || {}), ...v };
    }
    filesystem(() => fs.writeFileSync(tmp, JSON.stringify(next, null, 2) + '\n', { mode: 0o600, flag: 'wx' }));
    readObject(tmp); // validate before atomic replace; failed writes preserve prior checkpoint
    filesystem(() => fs.renameSync(tmp, file));
  } finally { filesystem(() => { fs.rmSync(tmp, { force: true }); fs.rmdirSync(lock); }); }
}
export function measureSize(lane: string, base: string) {
  if (typeof lane !== 'string' || !path.isAbsolute(lane) || typeof base !== 'string' || !base || base.startsWith('-') || /[\x00-\x1f]/.test(base)) throw new AutobuilderOpsError('invalid_meter_input');
  const root = filesystem(() => fs.realpathSync(lane));
  const sha = git(root, ['rev-parse', '--verify', '--end-of-options', `${base}^{commit}`]).trim();
  function count(paths: string[]): number {
    // shortstat preserves existing binary-file and insertion+deletion semantics.
    const stat = git(root, ['diff', '--no-ext-diff', '--no-textconv', '--shortstat', sha, '--', ...paths, ...EXCLUSIONS]);
    let n = [...stat.matchAll(/(\d+) (?:insertion|deletion)/g)].reduce((s, m) => s + Number(m[1]), 0);
    const untracked = git(root, ['ls-files', '--others', '--exclude-standard', '-z', '--', ...paths, ...EXCLUSIONS]).split('\0').filter(Boolean);
    for (const f of untracked) {
      const full = path.resolve(root, f);
      try {
        if (!full.startsWith(root + path.sep) || !fs.lstatSync(full).isFile() || fs.realpathSync(full) !== full) throw new AutobuilderOpsError('unreadable_untracked');
        // Match wc -l: count newline bytes, including binary files; never follow symlinks.
        for (const b of fs.readFileSync(full)) if (b === 10) n++;
      } catch { throw new AutobuilderOpsError('unreadable_untracked'); }
    }
    return n;
  }
  const all = count(['.']), test = count(TEST_PATHS), prod = all - test;
  if (prod < 0) throw new AutobuilderOpsError('inconsistent_meter');
  return { prod_loc: prod, test_loc: test, line: `SHIP_METER: ${prod} prod + ${test} test` };
}
