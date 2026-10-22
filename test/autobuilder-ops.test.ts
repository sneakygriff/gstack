import { test, expect, afterEach } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { updateState, measureSize } from '../lib/autobuilder-ops';
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
test('CLI returns failure without echoing request contents and rejects extra arguments', () => {
  const r = spawnSync('bun', [path.join(root, 'bin/gstack-autobuilder-ops'), 'state', '{private-data'], { encoding: 'utf8', timeout: 10_000 });
  expect(r.status).toBe(1); expect(r.stdout.trim()).toBe('FAILED: state operation failed'); expect(r.stderr).toBe('');
});
test('the workflow state command round-trips shell metacharacters as data', () => {
  const d = tmp(), marker = path.join(d, 'must-not-exist');
  const source = fs.readFileSync(path.join(root, 'autobuilder-loop/autobuilder-unit.js'), 'utf8');
  const argLine = source.split('\n').find(l => l.startsWith('const shellArg = '))!;
  const quote = new Function(`${argLine}; return shellArg;`)();
  const decision = `quote ' and $(touch ${marker}) and backtick \`touch ${marker}\``;
  const command = `bun ${quote(path.join(root, 'bin/gstack-autobuilder-ops'))} state ${quote(JSON.stringify({ ...req(d), decisions: [decision] }))}`;
  const r = spawnSync('sh', ['-c', command], { encoding: 'utf8', timeout: 10_000 });
  expect(r.status).toBe(0); expect(r.stdout.trim()).toBe('ok'); expect(fs.existsSync(marker)).toBe(false);
  expect(JSON.parse(fs.readFileSync(path.join(d, 'state.json'), 'utf8')).open_decisions).toEqual([decision]);
});
