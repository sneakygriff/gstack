import { test, expect, afterEach } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { updateState, measureSize, failureReason } from '../lib/autobuilder-ops';
const dirs: string[] = [];
const root = path.resolve(import.meta.dir, '..');
function tmp() { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ab-ops-')); dirs.push(d); return d; }
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });
function git(d: string, ...args: string[]) {
  const r = spawnSync('git', ['-C', d, ...args], { encoding: 'utf8', timeout: 10_000 });
  if (r.status !== 0) throw new Error(r.stderr); return r.stdout.trim();
}
function repo() {
  const d = tmp(); git(d, 'init', '-q'); git(d, 'config', 'user.email', 'test@example.invalid'); git(d, 'config', 'user.name', 'test');
  fs.writeFileSync(path.join(d, 'app.ts'), 'old\n'); git(d, 'add', 'app.ts'); git(d, 'commit', '-qm', 'base'); return d;
}
function req(d: string) { return { runDir: d, lane: d, unit: 'u1', flow: 'FULL', phase: 'Build', round: 0, base: 'HEAD', decisions: ['one'], extra: {} }; }
test('state preserves resume identity, unknown fields and previous map entries; deduplicates decisions', () => {
  const d = repo(), file = path.join(d, 'state.json');
  fs.writeFileSync(file, JSON.stringify({ workflow_run_id: 'resume-123', custom: 42, open_decisions: ['one'], waves: { old: 'kept' } }));
  fs.writeFileSync(path.join(d, 'lanes.json'), JSON.stringify({ l2: { status: 'cooling', reason: 'private' }, l3: { status: 'ok' } }));
  updateState({ ...req(d), decisions: ['one', 'two'], extra: { waves: { new: 'added' } } });
  const s = JSON.parse(fs.readFileSync(file, 'utf8'));
  expect(s.workflow_run_id).toBe('resume-123'); expect(s.custom).toBe(42); expect(s.open_decisions).toEqual(['one', 'two']);
  expect(s.waves).toEqual({ old: 'kept', new: 'added' }); expect(s.lanes_roster).toEqual({ l2: 'cooling', l3: 'ok' });
  expect(s.lane_head).toBe(git(d, 'rev-parse', 'HEAD')); expect(fs.existsSync(path.join(d, '.state.lock'))).toBe(false);
});
test('missing state/roster supported; unavailable Git head stays null', () => {
  const d = tmp(); updateState(req(d)); const s = JSON.parse(fs.readFileSync(path.join(d, 'state.json'), 'utf8'));
  expect(s.workflow_run_id).toBeNull(); expect(s.lane_head).toBeNull(); expect(s.lanes_roster).toEqual({});
});
for (const data of ['{broken', '[]', '{"open_decisions":{}}']) test(`malformed state never overwritten: ${data}`, () => {
  const d = tmp(), file = path.join(d, 'state.json'); fs.writeFileSync(file, data);
  expect(() => updateState(req(d))).toThrow(); expect(fs.readFileSync(file, 'utf8')).toBe(data);
});
test('invalid roster, reserved extra keys and lock contention preserve checkpoint', () => {
  const d = tmp(), file = path.join(d, 'state.json'); fs.writeFileSync(file, '{}'); fs.writeFileSync(path.join(d, 'lanes.json'), 'broken');
  expect(() => updateState(req(d))).toThrow(); fs.unlinkSync(path.join(d, 'lanes.json'));
  expect(() => updateState({ ...req(d), extra: { workflow_run_id: { bad: true } } })).toThrow();
  fs.mkdirSync(path.join(d, '.state.lock')); expect(() => updateState(req(d))).toThrow(); expect(fs.readFileSync(file, 'utf8')).toBe('{}');
});
test('symlink checkpoint and symlink untracked input fail closed', () => {
  const d = repo(), other = tmp(), target = path.join(other, 'target'); fs.writeFileSync(target, '{}');
  fs.symlinkSync(target, path.join(d, 'state.json')); expect(() => updateState(req(d))).toThrow(); expect(fs.readFileSync(target, 'utf8')).toBe('{}');
  expect(() => measureSize(d, 'HEAD')).toThrow();
});
test('meter matches tracked insertion+deletion and untracked newline counts, test split and exclusions', () => {
  const d = repo(); fs.writeFileSync(path.join(d, 'app.ts'), 'new\nnext\n');
  fs.mkdirSync(path.join(d, 'test')); fs.writeFileSync(path.join(d, 'test', 'case.ts'), 'a\nb\n');
  fs.writeFileSync(path.join(d, 'extra.ts'), 'a\nno-final-newline'); fs.writeFileSync(path.join(d, 'bun.lock'), 'ignored\n');
  fs.mkdirSync(path.join(d, 'dist')); fs.writeFileSync(path.join(d, 'dist', 'a.js'), 'ignored\n');
  expect(measureSize(d, 'HEAD')).toEqual({ prod_loc: 4, test_loc: 2, line: 'SHIP_METER: 4 prod + 2 test' });
});
test('empty diffs, staged changes, deleted lines and binary tracked changes preserve old shortstat semantics', () => {
  const d = repo(); expect(measureSize(d, 'HEAD').prod_loc).toBe(0);
  fs.writeFileSync(path.join(d, 'binary'), Buffer.from([0, 1, 2])); git(d, 'add', 'binary');
  fs.unlinkSync(path.join(d, 'app.ts')); expect(measureSize(d, 'HEAD').prod_loc).toBe(1);
});
test('invalid base, non-repo and option-like base cannot become zero LOC', () => {
  const d = repo(); for (const base of ['missing', '--help', 'HEAD\n']) expect(() => measureSize(d, base)).toThrow();
  expect(() => measureSize(tmp(), 'HEAD')).toThrow();
});
function cli(...args: string[]) {
  return cliWithEnv(process.env, ...args);
}
function cliWithEnv(env: NodeJS.ProcessEnv, ...args: string[]) {
  return spawnSync(path.join(root, 'bin/gstack-autobuilder-ops'), args, { encoding: 'utf8', timeout: 10_000, env });
}
test('CLI meter ignores inherited Git repository and index overrides', () => {
  const lane = repo(), other = repo();
  fs.writeFileSync(path.join(lane, 'app.ts'), 'old\n' + 'extra\n'.repeat(5));
  const normal = cli('meter', lane, 'HEAD');
  expect(normal.status).toBe(0); expect(normal.stdout.trim()).toBe('SHIP_METER: 5 prod + 0 test');
  const redirected = cliWithEnv({ ...process.env, GIT_DIR: path.join(other, '.git'), GIT_WORK_TREE: other, GIT_INDEX_FILE: path.join(other, '.git', 'index') }, 'meter', lane, 'HEAD');
  expect(redirected.status).toBe(0); expect(redirected.stdout).toBe(normal.stdout); expect(redirected.stderr).toBe('');
});
test('CLI meter never executes repository fsmonitor hooks', () => {
  const lane = repo(), outside = tmp(), marker = path.join(outside, 'called'), hook = path.join(outside, 'fsmonitor');
  fs.writeFileSync(hook, '#!/bin/sh\nprintf called >> "$(dirname "$0")/called"\nprintf "token\\n"\n', { mode: 0o700 });
  git(lane, 'config', 'core.fsmonitor', hook);
  fs.writeFileSync(path.join(lane, 'app.ts'), 'old\nextra\n');
  const result = cli('meter', lane, 'HEAD');
  expect(result.status).toBe(0); expect(result.stdout.trim()).toBe('SHIP_METER: 1 prod + 0 test');
  expect(fs.existsSync(marker)).toBe(false);
});
function expectFailure(r: ReturnType<typeof cli>, op: 'state' | 'meter', reason: string) {
  expect(r.status).toBe(1);
  expect(r.stdout.trim()).toBe(op === 'meter' ? 'SHIP_METER FAIL: operation failed' : 'FAILED: state operation failed');
  expect(r.stderr.split('\n')[0]).toBe(`AUTOBUILDER_OPS_ERROR: ${reason}`);
  expect(r.stderr.length).toBeLessThan(400);
}
test('CLI malformed JSON and invalid schema have safe distinct diagnostics', () => {
  for (const [request, reason] of [['{private-data', 'invalid_request_json'], ['{"secret":"private-data"}', 'invalid_request']]) {
    const r = cli('state', request);
    expectFailure(r, 'state', reason); expect(r.stderr).not.toContain('private-data');
  }
});
test('CLI rejects actual extra arguments before updating a checkpoint or measuring', () => {
  const d = repo(), file = path.join(d, 'state.json'); fs.writeFileSync(file, '{"custom":"kept"}');
  expectFailure(cli('state', JSON.stringify(req(d)), 'private-extra'), 'state', 'usage');
  expect(fs.readFileSync(file, 'utf8')).toBe('{"custom":"kept"}');
  expectFailure(cli('meter', d, 'HEAD', 'private-extra'), 'meter', 'usage');
  expect(fs.existsSync(path.join(d, '.state.lock'))).toBe(false);
});
test('CLI held lock preserves another writer lock and checkpoint and gives safe recovery guidance', () => {
  const d = tmp(), file = path.join(d, 'state.json'), lock = path.join(d, '.state.lock');
  fs.writeFileSync(file, '{"custom":"private-checkpoint"}'); fs.mkdirSync(lock);
  fs.writeFileSync(path.join(lock, 'state.json'), 'private-writer-in-progress');
  const r = cli('state', JSON.stringify({ ...req(d), decisions: ['private-request'] }));
  expectFailure(r, 'state', 'lock_held');
  expect(r.stderr).toContain('Check for an active writer'); expect(r.stderr).toContain('Never auto-delete the lock or increase the existing retry limit');
  expect(r.stderr).not.toContain(d); expect(r.stderr).not.toContain('private-');
  expect(fs.readFileSync(file, 'utf8')).toBe('{"custom":"private-checkpoint"}');
  expect(fs.readFileSync(path.join(lock, 'state.json'), 'utf8')).toBe('private-writer-in-progress');
});
test('CLI malformed checkpoint and roster preserve checkpoint and release only their acquired lock', () => {
  for (const bad of ['state.json', 'lanes.json']) {
    const d = tmp(), file = path.join(d, 'state.json'); fs.writeFileSync(file, '{"custom":"kept"}');
    fs.writeFileSync(path.join(d, bad), '{private-malformed');
    const before = fs.readFileSync(file, 'utf8'), r = cli('state', JSON.stringify(req(d)));
    expectFailure(r, 'state', 'invalid_state_or_roster');
    expect(r.stderr).not.toContain('private-malformed'); expect(r.stderr).not.toContain(d);
    expect(fs.readFileSync(file, 'utf8')).toBe(before); expect(fs.existsSync(path.join(d, '.state.lock'))).toBe(false);
  }
});
test('CLI symlink checkpoint and untracked symlink fail with safe actionable causes', () => {
  const d = repo(), other = tmp(), target = path.join(other, 'private-target'); fs.writeFileSync(target, '{}');
  fs.symlinkSync(target, path.join(d, 'state.json'));
  const state = cli('state', JSON.stringify(req(d))), meter = cli('meter', d, 'HEAD');
  expectFailure(state, 'state', 'unsafe_state_or_roster'); expectFailure(meter, 'meter', 'unreadable_untracked');
  for (const r of [state, meter]) { expect(r.stderr).not.toContain(d); expect(r.stderr).not.toContain(target); }
  expect(fs.readFileSync(target, 'utf8')).toBe('{}'); expect(fs.existsSync(path.join(d, '.state.lock'))).toBe(false);
});
test('CLI Git and input failures never report zero LOC or leak Git stderr', () => {
  const d = repo();
  for (const [lane, base, reason] of [[d, 'private-missing-base', 'git_failed'], [tmp(), 'HEAD', 'git_failed'], [d, '--private-option', 'invalid_meter_input']]) {
    const r = cli('meter', lane, base);
    expectFailure(r, 'meter', reason); expect(r.stderr).not.toContain(lane); expect(r.stderr).not.toContain(base); expect(r.stderr).not.toContain('fatal:');
  }
});
test('unexpected errors cannot inject arbitrary diagnostic text', () => {
  expect(failureReason(new Error('private-path-secret'))).toBe('operation_failed');
  expect(failureReason({ reason: 'lock_held', message: 'private-path-secret' })).toBe('operation_failed');
});
test('the workflow state command round-trips shell metacharacters as data', () => {
  const d = tmp(), marker = path.join(d, 'must-not-exist');
  const source = fs.readFileSync(path.join(root, 'autobuilder-loop/autobuilder-unit.js'), 'utf8');
  const argLine = source.split('\n').find(l => l.startsWith('const shellArg = '))!;
  const quote = new Function(`${argLine}; return shellArg;`)();
  const decision = `quote ' and $(touch ${marker}) and backtick \`touch ${marker}\``;
  const command = `${quote(path.join(root, 'bin/gstack-autobuilder-ops'))} state ${quote(JSON.stringify({ ...req(d), decisions: [decision] }))}`;
  const r = spawnSync('sh', ['-c', command], { encoding: 'utf8', timeout: 10_000 });
  expect(r.status).toBe(0); expect(r.stdout.trim()).toBe('ok'); expect(fs.existsSync(marker)).toBe(false);
  expect(JSON.parse(fs.readFileSync(path.join(d, 'state.json'), 'utf8')).open_decisions).toEqual([decision]);
});
