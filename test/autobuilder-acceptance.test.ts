import { afterEach, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EvalCollector } from './helpers/eval-store';

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

test('a contemporaneously bound native collector run earns scoped credit and retains its original identity', () => {
  const f = fixture();
  Object.assign(f.plan.checks[0], { kind: 'native-eval', cases: ['controlled judge'] });
  const driver = path.join(f.root, 'driver.ts');
  fs.writeFileSync(driver, `import {EvalCollector} from ${JSON.stringify(path.resolve(import.meta.dir, 'helpers/eval-store.ts'))};
    const collector = new EvalCollector('llm-judge', ${JSON.stringify(f.root)});
    collector.addTest({name:'controlled judge',suite:'fixture',tier:'llm-judge',passed:true,
      duration_ms:1,cost_usd:0,model:'controlled-model',prompt:'Controlled input',error:undefined});
    console.log(JSON.stringify({record:await collector.finalize()}));`);
  f.plan.checks[0].inputs.push('driver.ts');
  f.save();
  const child = Bun.spawnSync([process.execPath, driver], { stdout: 'pipe', stderr: 'pipe', timeout: 10000,
    env: { ...process.env, GSTACK_ACCEPTANCE_PLAN: f.planPath, GSTACK_ACCEPTANCE_CHECK: 'focused' } });
  expect(child.exitCode, child.stderr.toString()).toBe(0);
  f.plan.checks[0].record = JSON.parse(child.stdout.toString()).record;
  f.save();
  const native = JSON.parse(fs.readFileSync(f.plan.checks[0].record, 'utf8'));
  const result = run('assemble', f.planPath);
  expect(result.code, result.stderr).toBe(0);
  expect(result.json.checks[0]).toMatchObject({ status: 'passed', applicability: 'applicable',
    coverageCredit: true, reused: true, provenance: { runId: native.acceptance.runId } });
  fs.writeFileSync(path.join(f.root, 'unrelated.md'), 'Unconsumed documentation');
  expect(run('assemble', f.planPath).json.checks[0].provenance.runId).toBe(native.acceptance.runId);
});

test('native bindings reject changed inputs, runtime, environment and result bytes', () => {
  const f = fixture();
  Object.assign(f.plan.checks[0], { kind: 'native-eval', cases: ['controlled judge'] });
  const driver = path.join(f.root, 'driver.ts');
  fs.writeFileSync(driver, `import {EvalCollector} from ${JSON.stringify(path.resolve(import.meta.dir, 'helpers/eval-store.ts'))};
    const collector = new EvalCollector('llm-judge', ${JSON.stringify(f.root)});
    collector.addTest({name:'controlled judge',suite:'fixture',tier:'llm-judge',passed:true,duration_ms:1,cost_usd:0,model:'fixture',prompt:'Controlled input'});
    console.log(JSON.stringify({record:await collector.finalize()}));`);
  f.plan.checks[0].inputs.push('driver.ts');
  f.save();
  const child = Bun.spawnSync([process.execPath, driver], { stdout: 'pipe', stderr: 'pipe', timeout: 10000,
    env: { ...process.env, GSTACK_ACCEPTANCE_PLAN: f.planPath, GSTACK_ACCEPTANCE_CHECK: 'focused' } });
  expect(child.exitCode, child.stderr.toString()).toBe(0);
  f.plan.checks[0].record = JSON.parse(child.stdout.toString()).record;
  f.save();
  const original = fs.readFileSync(f.plan.checks[0].record, 'utf8');
  const source = fs.readFileSync(path.join(f.root, 'source.ts'), 'utf8');
  fs.appendFileSync(path.join(f.root, 'source.ts'), '// changed');
  expect(run('assemble', f.planPath).json.checks[0]).toMatchObject({ applicability: 'stale', coverageCredit: false });
  fs.writeFileSync(path.join(f.root, 'source.ts'), source);
  const changedEnvironment = Bun.spawnSync([process.execPath, command, 'assemble', f.planPath], {
    stdout: 'pipe', stderr: 'pipe', timeout: 10000, env: { ...process.env, ACCEPTANCE_FIXTURE: 'different' } });
  expect(JSON.parse(changedEnvironment.stdout.toString()).checks[0]).toMatchObject({ applicability: 'stale', coverageCredit: false });
  for (const change of ['runtime', 'result', 'during-run']) {
    const record = JSON.parse(original);
    if (change === 'runtime') record.acceptance.before.runtime.bun = record.acceptance.after.runtime.bun = 'different';
    if (change === 'result') record.tests[0].model = 'altered-after-finalize';
    if (change === 'during-run') record.acceptance.after.inputs[0].sha256 = '0'.repeat(64);
    fs.writeFileSync(f.plan.checks[0].record, JSON.stringify(record));
    expect(run('assemble', f.planPath).json.checks[0]).toMatchObject({
      applicability: change === 'runtime' ? 'stale' : 'incomplete', coverageCredit: false });
  }
});

test('invalid or late native opt-in cannot label an already started execution as bound', () => {
  const f = fixture();
  Object.assign(f.plan.checks[0], { kind: 'native-eval', cases: ['controlled judge'] });
  const driver = path.join(f.root, 'driver.ts');
  fs.writeFileSync(driver, `import {EvalCollector} from ${JSON.stringify(path.resolve(import.meta.dir, 'helpers/eval-store.ts'))};
    import fs from 'node:fs';
    const collector = new EvalCollector('llm-judge', ${JSON.stringify(f.root)});
    fs.writeFileSync(${JSON.stringify(path.join(f.root, 'model-started'))},'yes');
    process.env.GSTACK_ACCEPTANCE_PLAN=${JSON.stringify(f.planPath)};process.env.GSTACK_ACCEPTANCE_CHECK='focused';
    collector.addTest({name:'controlled judge',suite:'fixture',tier:'llm-judge',passed:true,duration_ms:1,cost_usd:0,model:'fixture',prompt:'Controlled input'});
    console.log(JSON.stringify({record:await collector.finalize()}));`);
  f.plan.checks[0].inputs.push('driver.ts');
  f.save();
  for (const check of ['', 'missing-check']) {
    const child = Bun.spawnSync([process.execPath, driver], { stdout: 'pipe', stderr: 'pipe', timeout: 10000,
      env: { ...process.env, GSTACK_ACCEPTANCE_PLAN: f.planPath, GSTACK_ACCEPTANCE_CHECK: check } });
    expect(child.exitCode).not.toBe(0);
    expect(fs.existsSync(path.join(f.root, 'model-started'))).toBe(false);
  }
  const late = Bun.spawnSync([process.execPath, driver], { stdout: 'pipe', stderr: 'pipe', timeout: 10000,
    env: { ...process.env, GSTACK_ACCEPTANCE_PLAN: undefined, GSTACK_ACCEPTANCE_CHECK: undefined } });
  expect(late.exitCode, late.stderr.toString()).toBe(0);
  f.plan.checks[0].record = JSON.parse(late.stdout.toString()).record;
  f.save();
  expect(run('assemble', f.planPath).json.checks[0]).toMatchObject({ applicability: 'incomplete', coverageCredit: false,
    reasons: expect.arrayContaining(['Native evaluation lacks consumed source/instruction fingerprints']) });
});

test('bound native attempts preserve final retry policy, failures, missing cases and unsupported entry reuse', () => {
  for (const scenario of ['retry', 'failure', 'missing-case', 'missing-prompt', 'reused']) {
    const f = fixture();
    Object.assign(f.plan.checks[0], { kind: 'native-eval', cases: scenario === 'missing-case' ? ['controlled judge', 'unstarted judge'] : ['controlled judge'] });
    const driver = path.join(f.root, 'driver.ts');
    fs.writeFileSync(driver, `import {EvalCollector} from ${JSON.stringify(path.resolve(import.meta.dir, 'helpers/eval-store.ts'))};
      const collector = new EvalCollector('llm-judge', ${JSON.stringify(f.root)});
      const entry = {name:'controlled judge',suite:'fixture',tier:'llm-judge',passed:true,duration_ms:1,cost_usd:0,model:'fixture',prompt:'Controlled input'};
      if (${JSON.stringify(scenario)} === 'retry') collector.addTest({...entry,passed:false});
      if (${JSON.stringify(scenario)} === 'missing-prompt') delete entry.prompt;
      collector.addTest({...entry,passed:${scenario !== 'failure'},${scenario === 'reused' ? "execution:'reused',reused_from:{input_key:'key',run_id:'old',revision:'old',completed_at:'old'}," : ''}});
      console.log(JSON.stringify({record:await collector.finalize()}));`);
    f.plan.checks[0].inputs.push('driver.ts');
    f.save();
    const child = Bun.spawnSync([process.execPath, driver], { stdout: 'pipe', stderr: 'pipe', timeout: 10000,
      env: { ...process.env, GSTACK_ACCEPTANCE_PLAN: f.planPath, GSTACK_ACCEPTANCE_CHECK: 'focused' } });
    expect(child.exitCode, child.stderr.toString()).toBe(0);
    f.plan.checks[0].record = JSON.parse(child.stdout.toString()).record;
    f.save();
    const result = run('assemble', f.planPath);
    if (scenario === 'retry') {
      expect(result.json.checks[0]).toMatchObject({ status: 'passed', coverageCredit: true, counts: { passed: 1, failed: 1 },
        provenance: { entries: [{ outcome: 'failed', attempt: 1 }, { outcome: 'passed', attempt: 2 }] } });
    } else if (scenario === 'failure') expect(result.json.checks[0]).toMatchObject({ status: 'failed', coverageCredit: false });
    else expect(result.json.checks[0]).toMatchObject({ applicability: 'incomplete', coverageCredit: false,
      ...(scenario === 'missing-prompt' ? { reasons: expect.arrayContaining(['Native evaluation lacks retained model input prompt']) } : {}) });
  }
}, 30000);

test('native collector outcomes are reconciled but cannot certify missing consumed inputs or runtime', async () => {
  const f = fixture();
  const collector = new EvalCollector('llm-judge', f.root);
  collector.addTest({ name: 'controlled judge', suite: 'fixture', tier: 'llm-judge', passed: true,
    duration_ms: 1, cost_usd: 0, model: 'fixture-model', judge_scores: { clarity: 5 }, judge_reasoning: 'Controlled record, no provider call.' });
  f.plan.checks[0].record = await collector.finalize();
  Object.assign(f.plan.checks[0], { kind: 'native-eval', cases: ['controlled judge'] });
  f.save();
  const result = run('assemble', f.planPath);
  expect(result.code).toBe(1);
  expect(result.json.checks[0]).toMatchObject({ kind: 'native-eval', status: 'passed', applicability: 'incomplete',
    coverageCredit: false, counts: { passed: 1, failed: 0, executed: 1, reused: 0 },
    reasons: expect.arrayContaining(['Native evaluation lacks consumed source/instruction fingerprints',
      'Native evaluation lacks complete runtime and environment binding']) });
  const record = JSON.parse(fs.readFileSync(f.plan.checks[0].record, 'utf8'));
  record.passed = 99;
  fs.writeFileSync(f.plan.checks[0].record, JSON.stringify(record));
  expect(run('assemble', f.planPath).json.checks[0]).toMatchObject({ status: 'incomplete',
    reasons: expect.arrayContaining(['Native evaluation counters contradict its entries']) });
  record.passed = 1;
  record._partial = true;
  record.tests[0].execution = 'reused';
  record.executed_tests = 0;
  record.reused_tests = 1;
  fs.writeFileSync(f.plan.checks[0].record, JSON.stringify(record));
  expect(run('assemble', f.planPath).json.checks[0]).toMatchObject({ applicability: 'incomplete', coverageCredit: false,
    counts: { reused: 1, executed: 0 }, reasons: expect.arrayContaining(['Native evaluation is partial, not finalized',
      'Native reused entry lacks original provenance']) });
  fs.writeFileSync(f.plan.checks[0].record, JSON.stringify({ passed: true, status: 'passed' }));
  expect(run('assemble', f.planPath).json.checks[0]).toMatchObject({ status: 'incomplete', coverageCredit: false,
    reasons: ['Invalid native EvalResult metadata'] });
  expect(run('capture', f.planPath, 'focused')).toMatchObject({ code: 2,
    stderr: expect.stringContaining('capture is free-only') });
}, 30000);

test('usage assembly reconciles original artifacts and consumed bytes without supplying missing quality evidence', () => {
  const f = fixture();
  const inputPath = path.join(f.root, 'events.json');
  const reportPath = path.join(f.root, 'usage.json');
  const rawPath = path.join(f.root, 'provider.json');
  const hash = (file: string) => Bun.CryptoHasher.hash('sha256', fs.readFileSync(file), 'hex');
  fs.writeFileSync(rawPath, JSON.stringify({ id: 'message-1', usage: { input_tokens: 7 } }));
  fs.writeFileSync(path.join(f.root, 'prompt.md'), 'Controlled instruction bytes');
  const event = { runId: 'controlled-run', eventId: 'message-1', kind: 'model', phase: 'review', role: 'judge',
    observation: 'observed', provider: 'fixture', model: 'fixture-model', transport: 'fixture', recordScope: 'message',
    sourceFingerprints: { 'source.ts': hash(path.join(f.root, 'source.ts')) },
    instructionFingerprints: { 'prompt.md': hash(path.join(f.root, 'prompt.md')) },
    evidence: [{ ref: rawPath, sha256: hash(rawPath) }], usage: { inputTokens: 7 } };
  fs.writeFileSync(inputPath, JSON.stringify({ schemaVersion: 'autobuilder-usage-events/v1', events: [event, event] }));
  const produced = Bun.spawnSync([process.execPath, path.resolve(import.meta.dir, '../scripts/autobuilder-usage.ts'), inputPath],
    { stdout: 'pipe', stderr: 'pipe', timeout: 5000 });
  expect(produced.exitCode, produced.stderr.toString()).toBe(0);
  fs.writeFileSync(reportPath, produced.stdout);
  Object.assign(f.plan, { measurements: [{ id: 'usage', report: reportPath, inputs: ['source.ts'],
    instructions: ['prompt.md'], environment: ['ACCEPTANCE_FIXTURE'], scope: f.plan.checks[0].scope }] });
  Object.assign(f.plan.checks[0], { kind: 'native-eval', cases: ['unavailable judge'] });
  f.save();
  const result = run('assemble', f.planPath);
  expect(result.code).toBe(1);
  expect(result.json.checks[0]).toMatchObject({ status: 'unexecuted', coverageCredit: false });
  expect(result.json.measurements[0]).toMatchObject({ applicability: 'incomplete', coverageCredit: false,
    consistency: 'consistent', duplicateEvents: 1, groups: [{ inputTokens: { total: 7 }, outputTokens: { total: null } }],
    reasons: expect.arrayContaining(['Usage format lacks recorded execution environment: ACCEPTANCE_FIXTURE']) });
  fs.appendFileSync(path.join(f.root, 'prompt.md'), ' changed');
  expect(run('assemble', f.planPath).json.measurements[0]).toMatchObject({ applicability: 'stale',
    reasons: expect.arrayContaining(['Instruction fingerprint changed: prompt.md']) });
  fs.appendFileSync(path.join(f.root, 'source.ts'), ' // changed');
  expect(run('assemble', f.planPath).json.measurements[0]).toMatchObject({ applicability: 'stale',
    reasons: expect.arrayContaining(['Source fingerprint changed: source.ts']) });
  fs.appendFileSync(rawPath, ' ');
  expect(run('assemble', f.planPath).json.measurements[0]).toMatchObject({ consistency: 'incomplete',
    reasons: expect.arrayContaining([`Usage evidence missing or changed: ${rawPath}`]) });
  const report = JSON.parse(produced.stdout.toString());
  report.groups[0].inputTokens.total = 999;
  fs.writeFileSync(reportPath, JSON.stringify(report));
  expect(run('assemble', f.planPath).json.measurements[0]).toMatchObject({ consistency: 'incomplete',
    reasons: expect.arrayContaining(['Usage report contradicts its normalized input']) });
  fs.writeFileSync(reportPath, produced.stdout);
  fs.appendFileSync(inputPath, ' ');
  expect(run('assemble', f.planPath).json.measurements[0]).toMatchObject({ consistency: 'incomplete',
    reasons: expect.arrayContaining(['Usage normalized input missing or changed']) });
});

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
