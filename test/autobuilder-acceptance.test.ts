import { afterEach, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Value: protects=acceptance credits only consistent applicable retained execution;
// fails_when=stale or tampered receipts certify coverage; why_new=focused runner lacks acceptance assembly; seam=public CLI
const command = path.resolve(import.meta.dir, '../scripts/autobuilder-acceptance.ts');
const dirs: string[] = [];
function fixture(source = "import {test,expect} from 'bun:test';import {answer} from '../source';test('answer',()=>expect(answer).toBe(42));") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'accept-'));
  dirs.push(root);
  fs.mkdirSync(path.join(root, 'test'));
  fs.writeFileSync(path.join(root, 'source.ts'), 'export const answer = 42;');
  fs.writeFileSync(path.join(root, 'test/check.test.ts'), source);
  const plan = { schemaVersion: 'autobuilder-acceptance-plan/v1', root, checks: [{ id: 'focused',
    files: ['test/check.test.ts'], inputs: ['test/check.test.ts', 'source.ts'], environment: ['ACCEPTANCE_FIXTURE'],
    scope: { status: 'declared-complete', note: 'Self-contained Bun fixture; no external state or packages.', unresolved: [] },
    record: path.join(root, 'record.json') }], historical: [] };
  const planPath = path.join(root, 'plan.json');
  const save = () => fs.writeFileSync(planPath, JSON.stringify(plan));
  save();
  return { root, plan, planPath, save };
}
function run(...args: string[]) {
  const child = Bun.spawnSync([process.execPath, command, ...args], { stdout: 'pipe', stderr: 'pipe', timeout: 20_000 });
  return { code: child.exitCode, stderr: child.stderr.toString(), json: child.stdout.length ? JSON.parse(child.stdout.toString()) : null };
}
afterEach(() => { for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

test('captures a real focused run and reuses its applicable result with original provenance', () => {
  const f = fixture();
  for (const args of [['init', '-q'], ['config', 'user.name', 'Fixture'], ['config', 'user.email', 'fixture@example.test'],
    ['add', 'source.ts', 'test/check.test.ts'], ['commit', '-qm', 'initial']]) {
    expect(Bun.spawnSync(['git', ...args], { cwd: f.root, timeout: 5000 }).exitCode).toBe(0);
  }
  const captured = run('capture', f.planPath, 'focused');
  expect(captured.code, captured.stderr).toBe(0);
  fs.writeFileSync(path.join(f.root, 'unrelated.md'), 'Documentation outside declared consumed scope.');
  for (const args of [['add', 'unrelated.md'], ['commit', '-qm', 'documentation']]) {
    expect(Bun.spawnSync(['git', ...args], { cwd: f.root, timeout: 5000 }).exitCode).toBe(0);
  }
  const result = run('assemble', f.planPath);
  expect(result.json.revision).not.toBe(captured.json.receipt.revision);
  expect(result.code, result.stderr).toBe(0);
  expect(result.json).toMatchObject({ status: 'passed', coverageCredit: true,
    checks: [{ id: 'focused', status: 'passed', applicability: 'applicable', reused: true,
      counts: { passed: 1, failed: 0, skipped: 0 }, provenance: { runId: captured.json.runId } }] });
}, 30000);

test('absent metadata is incomplete and never mistaken for changed inputs or acceptance', () => {
  const f = fixture();
  expect(run('capture', f.planPath, 'focused').code).toBe(0);
  const record = JSON.parse(fs.readFileSync(f.plan.checks[0].record, 'utf8'));
  delete record.before;
  fs.writeFileSync(f.plan.checks[0].record, JSON.stringify(record));
  const result = run('assemble', f.planPath);
  expect(result.code).toBe(1);
  expect(result.json.checks[0]).toMatchObject({ applicability: 'incomplete', coverageCredit: false, reused: false });
});

test('rejects internally consistent forged counters when the terminal total disagrees', () => {
  const f = fixture();
  expect(run('capture', f.planPath, 'focused').code).toBe(0);
  const record = JSON.parse(fs.readFileSync(f.plan.checks[0].record, 'utf8'));
  const log = fs.readFileSync(record.log.path, 'utf8').replace('1 pass', '9 pass');
  fs.writeFileSync(record.log.path, log);
  record.log.sha256 = Bun.CryptoHasher.hash('sha256', log, 'hex');
  record.receipt.outcome.evidence.passedTests = 9;
  fs.writeFileSync(record.receiptFile.path, JSON.stringify(record.receipt));
  record.receiptFile.sha256 = Bun.CryptoHasher.hash('sha256', fs.readFileSync(record.receiptFile.path), 'hex');
  fs.writeFileSync(f.plan.checks[0].record, JSON.stringify(record));
  const result = run('assemble', f.planPath);
  expect(result.code).toBe(1);
  expect(result.json.checks[0]).toMatchObject({ applicability: 'incomplete', coverageCredit: false });
});

test('a claimed passed JSON without execution metadata is incomplete', () => {
  const f = fixture();
  fs.writeFileSync(f.plan.checks[0].record, JSON.stringify({ status: 'passed', coverageCredit: true }));
  const result = run('assemble', f.planPath);
  expect(result.code).toBe(1);
  expect(result.json.checks[0]).toMatchObject({ applicability: 'incomplete', coverageCredit: false, reused: false });
});

test('source changes invalidate reuse even though the selected test and HEAD have not changed', () => {
  const f = fixture();
  expect(run('capture', f.planPath, 'focused').code).toBe(0);
  fs.writeFileSync(path.join(f.root, 'source.ts'), 'export const answer = 41;');
  const result = run('assemble', f.planPath);
  expect(result.code).toBe(1);
  expect(result.json.checks[0]).toMatchObject({ status: 'passed', applicability: 'stale', coverageCredit: false, reused: false });
});

test('missing artifacts, modified logs and unknown dependency scope never gain credit', () => {
  for (const variant of ['missing-log', 'modified-log', 'unknown-scope']) {
    const f = fixture();
    if (variant === 'unknown-scope') { f.plan.checks[0].scope.status = 'unknown'; f.save(); }
    expect(run('capture', f.planPath, 'focused').code).toBe(0);
    const record = JSON.parse(fs.readFileSync(f.plan.checks[0].record, 'utf8'));
    if (variant === 'missing-log') fs.unlinkSync(record.log.path);
    if (variant === 'modified-log') fs.appendFileSync(record.log.path, '(fail) injected failure [1ms]\n');
    const result = run('assemble', f.planPath);
    expect(result.code, variant).toBe(1);
    expect(result.json.checks[0]).toMatchObject({ applicability: 'incomplete', coverageCredit: false });
  }
}, 30000);

test('failed, skipped and unexecuted checks remain separate from historical totals', () => {
  const f = fixture("import {test,expect} from 'bun:test';test('broken',()=>expect(1).toBe(2));");
  const failed = run('capture', f.planPath, 'focused');
  expect(failed.code).toBe(1);
  fs.writeFileSync(path.join(f.root, 'test/skipped.test.ts'), "import {test} from 'bun:test';test.skip('unavailable',()=>{});");
  f.plan.checks.push({ ...f.plan.checks[0], id: 'skipped', files: ['test/skipped.test.ts'], inputs: ['test/skipped.test.ts'], record: path.join(f.root, 'skip.json') });
  f.plan.checks.push({ ...f.plan.checks[0], id: 'not-run', record: path.join(f.root, 'missing.json') });
  (f.plan.historical as unknown[]).push({ id: 'earlier-full', totals: { failed: 422 } }, { id: 'later-focused', totals: { passed: 50 } });
  f.save();
  expect(run('capture', f.planPath, 'skipped').code).toBe(0);
  const result = run('assemble', f.planPath);
  expect(result.code).toBe(1);
  expect(result.json.checks).toMatchObject([
    { status: 'failed', applicability: 'applicable', counts: { failed: 1 } },
    { status: 'skipped', coverageCredit: false, counts: { skipped: 1 } },
    { status: 'unexecuted', applicability: 'missing', coverageCredit: false } ]);
  expect(result.json.historical).toEqual([
    { record: { id: 'earlier-full', totals: { failed: 422 } }, applicability: 'historical-unknown-inputs', coverageCredit: false },
    { record: { id: 'later-focused', totals: { passed: 50 } }, applicability: 'historical-unknown-inputs', coverageCredit: false } ]);
}, 30000);

test('cancelled execution preserves its partial evidence without acceptance credit', async () => {
  const f = fixture("import {test} from 'bun:test';test('waiting',async()=>{console.error('READY_TO_CANCEL');await new Promise(()=>{});});");
  const child = Bun.spawn([process.execPath, command, 'capture', f.planPath, 'focused'], { stdout: 'pipe', stderr: 'pipe' });
  let ready = false;
  for (let i = 0; i < 100; i++) {
    const logs = path.join(f.root, '.context/free-test-logs');
    if (fs.existsSync(logs) && fs.readdirSync(logs).some(name => name.endsWith('.log') && fs.readFileSync(path.join(logs, name), 'utf8').includes('READY_TO_CANCEL'))) { ready = true; break; }
    await Bun.sleep(20);
  }
  child.kill('SIGTERM');
  await child.exited;
  expect(ready).toBe(true);
  const result = run('assemble', f.planPath);
  expect(result.code).toBe(1);
  expect(result.json.checks[0]).toMatchObject({ status: 'cancelled', applicability: 'incomplete', coverageCredit: false });
}, 15000);

test('timeout remains distinct from explicit cancellation', () => {
  const f = fixture("import {test} from 'bun:test';test('slow',async()=>await Bun.sleep(500));");
  Object.assign(f.plan.checks[0], { wallTimeoutSeconds: 0.05 });
  f.save();
  expect(run('capture', f.planPath, 'focused').code).toBe(1);
  const result = run('assemble', f.planPath);
  expect(result.code).toBe(1);
  expect(result.json.checks[0]).toMatchObject({ status: 'timed-out', applicability: 'incomplete', coverageCredit: false });
});
