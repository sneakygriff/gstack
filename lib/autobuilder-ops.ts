/** Local deterministic autobuilder chores. No model, network, or shell evaluation. */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const TIMEOUT_MS = 30_000;
export const EXCLUSIONS = ['*.lock', 'package-lock.json', 'pnpm-lock.yaml', 'bun.lockb', '*dist/*', '*build/*', '*.gen.ts', '*generated/*', '*drizzle/meta/*', '*__snapshots__/*', '*.snap'].map(p => `:(exclude)${p}`);
export const TEST_PATHS = ['**/test/**', '**/__tests__/**', '**/*.test.*', '**/*.spec.*', '**/e2e*/**'].map(p => `:(glob)${p}`);
function git(cwd: string, args: string[]): string {
  const r = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8', timeout: TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, LC_ALL: 'C', GIT_OPTIONAL_LOCKS: '0' } });
  if (r.error || r.status !== 0) throw new Error('git_failed'); // never relay repo paths or stderr
  return r.stdout;
}
function object(x: unknown): x is Record<string, any> { return !!x && typeof x === 'object' && !Array.isArray(x); }
function readObject(file: string, optional = false): Record<string, any> {
  try {
    if (!fs.lstatSync(file).isFile()) throw new Error('not_regular_file');
    const x = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!object(x)) throw new Error('not_object');
    return x;
  } catch (e: any) { if (optional && e.code === 'ENOENT') return {}; throw new Error('invalid_state_or_roster'); }
}
export function updateState(r: Record<string, any>): void {
  if (!object(r) || typeof r.runDir !== 'string' || !path.isAbsolute(r.runDir) || typeof r.lane !== 'string' || !path.isAbsolute(r.lane)
      || !['unit', 'flow', 'phase', 'base'].every(k => typeof r[k] === 'string') || !Number.isInteger(r.round) || r.round < 0
      || !Array.isArray(r.decisions) || !r.decisions.every((d: unknown) => typeof d === 'string') || !object(r.extra)) throw new Error('invalid_request');
  const root = fs.realpathSync(r.runDir), file = path.join(root, 'state.json'), lock = path.join(root, '.state.lock');
  // Exclusive, fail closed. Never guess whether a leftover lock belongs to a live writer.
  fs.mkdirSync(lock, { mode: 0o700 });
  const tmp = path.join(lock, 'state.json');
  try {
    const old = readObject(file, true), roster = readObject(path.join(root, 'lanes.json'), true);
    if (old.open_decisions !== undefined && (!Array.isArray(old.open_decisions) || !old.open_decisions.every((d: unknown) => typeof d === 'string'))) throw new Error('invalid_decisions');
    let head: string | null = null;
    try { head = git(r.lane, ['rev-parse', '--verify', 'HEAD']).trim(); } catch { /* historical contract: null on error */ }
    const next = { ...old, workflow_run_id: old.workflow_run_id ?? null, unit: r.unit, flow: r.flow, phase: r.phase,
      round: r.round, ship_base: r.base, lane_head: head,
      lanes_roster: Object.fromEntries(Object.entries(roster).filter(([, v]) => object(v) && typeof v.status === 'string').map(([k, v]) => [k, v.status])),
      updated_at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'), open_decisions: [...new Set([...(old.open_decisions || []), ...r.decisions])] } as Record<string, any>;
    const reserved = new Set(['__proto__', 'constructor', 'prototype', 'workflow_run_id', 'unit', 'flow', 'phase', 'round', 'ship_base', 'lane_head', 'lanes_roster', 'updated_at', 'open_decisions']);
    for (const [k, v] of Object.entries(r.extra)) {
      if (reserved.has(k) || !object(v) || (old[k] !== undefined && !object(old[k]))) throw new Error('invalid_extra');
      next[k] = { ...(old[k] || {}), ...v };
    }
    fs.writeFileSync(tmp, JSON.stringify(next, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    readObject(tmp); // validate before atomic replace; failed writes preserve prior checkpoint
    fs.renameSync(tmp, file);
  } finally { fs.rmSync(tmp, { force: true }); fs.rmdirSync(lock); }
}
export function measureSize(lane: string, base: string) {
  if (!path.isAbsolute(lane) || !base || base.startsWith('-') || /[\x00-\x1f]/.test(base)) throw new Error('invalid_meter_input');
  const root = fs.realpathSync(lane);
  const sha = git(root, ['rev-parse', '--verify', '--end-of-options', `${base}^{commit}`]).trim();
  function count(paths: string[]): number {
    // shortstat preserves existing binary-file and insertion+deletion semantics.
    const stat = git(root, ['diff', '--no-ext-diff', '--shortstat', sha, '--', ...paths, ...EXCLUSIONS]);
    let n = [...stat.matchAll(/(\d+) (?:insertion|deletion)/g)].reduce((s, m) => s + Number(m[1]), 0);
    const untracked = git(root, ['ls-files', '--others', '--exclude-standard', '-z', '--', ...paths, ...EXCLUSIONS]).split('\0').filter(Boolean);
    for (const f of untracked) {
      const full = path.resolve(root, f);
      if (!full.startsWith(root + path.sep) || !fs.lstatSync(full).isFile() || fs.realpathSync(full) !== full) throw new Error('unreadable_untracked');
      // Match wc -l: count newline bytes, including binary files; never follow symlinks.
      for (const b of fs.readFileSync(full)) if (b === 10) n++;
    }
    return n;
  }
  const all = count(['.']), test = count(TEST_PATHS), prod = all - test;
  if (prod < 0) throw new Error('inconsistent_meter');
  return { prod_loc: prod, test_loc: test, line: `SHIP_METER: ${prod} prod + ${test} test` };
}
