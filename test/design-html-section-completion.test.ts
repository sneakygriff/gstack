import { expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { CARVE_GUARDS } from './helpers/carve-guards';

const ROOT = path.resolve(import.meta.dir, '..');
// Exact REPORT.md from the completed native design-html capture, session
// 7fded9af-0cb9-44ce-8aed-4cb25cd054a0. Only the report is retained here; no
// transcript, private paths, thinking, or signatures are needed by the test.
const report = fs.readFileSync(path.join(import.meta.dir, 'fixtures/design-html-section-complete.md'), 'utf8');
const genericReport = '# Review report\n' + 'The requested section work is complete. '.repeat(8);

interface Fixture {
  skill?: string;
  output?: string;
  writeReport?: boolean;
  exitReason?: string;
  missingRead?: string;
  windowsPaths?: boolean;
  acceptance?: boolean;
}

// Run the actual paid registration and actual capture helper in an isolated
// free child. Only the session-runner/provider boundary is replaced. This
// covers file-vs-stdout selection, native completion, and the real assertions.
function exercise(fixture: Fixture = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'design-html-completion-'));
  const script = path.join(dir, 'capture.test.ts');
  const facts = path.join(dir, 'facts.json');
  const input = { skill: 'design-html', output: report, writeReport: true, exitReason: 'success', ...fixture };
  const planPath = path.join(dir, 'acceptance-plan.json');
  const plan = { schemaVersion: 'autobuilder-acceptance-plan/v1', root: dir, checks: [{ id: 'section-read', kind: 'native-eval',
    files: ['capture.test.ts'], inputs: ['capture.test.ts', path.join(ROOT, 'test/helpers/carve-section-case.ts'),
      path.join(ROOT, 'test/helpers/auq-sdk-capture.ts'), path.join(ROOT, 'test/helpers/carve-guards.ts')],
    cases: [`${input.skill}: a real run Reads ${CARVE_GUARDS[input.skill].requiredReads.join(', ')}`], environment: [],
    scope: { status: 'declared-complete', note: 'Controlled native session boundary with explicit fixture inputs.', unresolved: [] }, record: '' }] };
  fs.writeFileSync(script, `
import { expect, mock } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { CARVE_GUARDS } from ${JSON.stringify(path.join(ROOT, 'test/helpers/carve-guards.ts'))};
import { resolveEvalModel } from ${JSON.stringify(path.join(ROOT, 'lib/eval-model.ts'))};
const input = ${JSON.stringify(input)};
const guard = CARVE_GUARDS[input.skill];
mock.module(${JSON.stringify(path.join(ROOT, 'test/helpers/session-runner.ts'))}, () => ({
  runSkillTest: async opts => {
    expect(opts.prompt).toContain(guard.scenario);
    expect(opts).toMatchObject({ maxTurns: 25, timeout: 480000, model: resolveEvalModel('capture') });
    expect(opts.allowedTools).toEqual(['Read', 'Grep', 'Glob', 'Write', 'Edit', 'Agent']);
    if (input.writeReport) fs.writeFileSync(path.join(opts.workingDirectory, 'REPORT.md'), input.output);
    fs.writeFileSync(${JSON.stringify(facts)}, JSON.stringify({ called: true }));
    return {
      exitReason: input.exitReason, output: input.output,
      toolCalls: guard.requiredReads.filter(section => section !== input.missingRead).map(section => ({
        tool: 'Read', input: { file_path: (input.windowsPaths ? path.win32 : path).join(opts.workingDirectory, input.skill, 'sections', section) },
      })), transcript: [],
    };
  },
}));
const { registerCarveSectionCase } = await import(${JSON.stringify(path.join(ROOT, 'test/helpers/carve-section-case.ts'))});
registerCarveSectionCase(input.skill);
`);
  try {
    const env = { PATH: process.env.PATH ?? '', HOME: dir, TMPDIR: dir, TEMP: dir, TMP: dir,
      ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
      ...(input.acceptance ? { GSTACK_ACCEPTANCE_PLAN: planPath, GSTACK_ACCEPTANCE_CHECK: 'section-read', GSTACK_EVAL_DIR: path.join(dir, 'evals') } : {}) };
    if (input.acceptance) fs.writeFileSync(planPath, JSON.stringify(plan));
    const child = Bun.spawnSync([process.execPath, 'test', script], {
      cwd: ROOT,
      env,
      timeout: 10_000,
    });
    expect(fs.existsSync(facts), child.stderr.toString()).toBe(true);
    expect(JSON.parse(fs.readFileSync(facts, 'utf8'))).toEqual({ called: true });
    expect(child.signalCode ?? null).toBeNull();
    let manifest: any = null;
    let native: any = null;
    if (input.acceptance) {
      const evalDir = path.join(dir, 'evals');
      const records = fs.existsSync(evalDir) ? fs.readdirSync(evalDir).filter(name => !name.startsWith('_partial') && name.endsWith('.json')) : [];
      expect(records, child.stderr.toString()).toHaveLength(1);
      plan.checks[0].record = path.join(evalDir, records[0]);
      fs.writeFileSync(planPath, JSON.stringify(plan));
      native = JSON.parse(fs.readFileSync(plan.checks[0].record, 'utf8'));
      const assembled = Bun.spawnSync([process.execPath, path.join(ROOT, 'scripts/autobuilder-acceptance.ts'), 'assemble', planPath],
        { cwd: ROOT, env, stdout: 'pipe', stderr: 'pipe', timeout: 10000 });
      manifest = JSON.parse(assembled.stdout.toString());
    }
    return { code: child.exitCode, output: child.stdout.toString() + child.stderr.toString(), manifest, native };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('opt-in section evidence binds the real public Read and completion assertions and preserves failures', () => {
  const complete = exercise({ acceptance: true, skill: 'autobuilder-loop', output: genericReport });
  expect(complete.code, complete.output).toBe(0);
  expect(complete.manifest.checks[0]).toMatchObject({ status: 'passed', applicability: 'applicable', coverageCredit: true });
  expect(complete.native.tests[0]).toMatchObject({ cost_usd: null, model_source: 'resolved-request', provider_model: null });
  expect(complete.native.total_cost_usd).toBeNull();
  expect(complete.native.tests[0].prompt).toContain(CARVE_GUARDS['autobuilder-loop'].scenario);
  expect(complete.native.tests[0].transcript.some((event: any) => event.tool === 'Read')).toBe(true);
  const missing = exercise({ acceptance: true, skill: 'autobuilder-loop', output: genericReport,
    missingRead: CARVE_GUARDS['autobuilder-loop'].requiredReads[0] });
  expect(missing.code).toBe(1);
  expect(missing.manifest.checks[0]).toMatchObject({ status: 'failed', coverageCredit: false, counts: { failed: 1 } });
}, 30000);

test('accepts the exact completed HTML report without generic review keywords', () => {
  expect(new Bun.CryptoHasher('sha256').update(report).digest('hex')).toBe('82818f5b3c5ded9acda285d7115f7b1aee1e3dce6c456a3f2833ead52e268038');
  expect(/report|review|summary|design doc|handoff/i.test(report)).toBe(false);
  const result = exercise();
  expect(result.code, result.output).toBe(0);
}, 20_000);

test('the registered case credits native Windows section paths and still rejects a missing Read', () => {
  expect(exercise({ windowsPaths: true }).code).toBe(0);
  const missing = exercise({ windowsPaths: true, missingRead: 'doctrine.md' });
  expect(missing.code).toBe(1);
  expect(missing.output).toContain('"missing"');
}, 20_000);

test.each([
  ['missing file despite complete terminal HTML', { writeReport: false }],
  ['generic prose instead of HTML', { output: genericReport }],
  ['missing doctype', { output: report.replace('<!DOCTYPE html>', '') }],
  ['missing html opening', { output: report.replace('<html lang="en">', '') }],
  ['missing head closing', { output: report.replace('</head>', '') }],
  ['missing body opening', { output: report.replace('<body>', '') }],
  ['missing body closing', { output: report.replace('</body>', '') }],
  ['truncated document', { output: report.slice(0, report.indexOf('</html>')) }],
  ['failed native run with complete file', { exitReason: 'error_api' }],
  ['timed out native run with complete file', { exitReason: 'timeout' }],
  ['missing doctrine Read', { missingRead: 'doctrine.md' }],
  ['missing Pretext Read', { missingRead: 'pretext-patterns.md' }],
  ['short complete document below the existing floor', { output: '<!doctype html><html><head><title>Pricing</title></head><body>Pricing</body></html>' }],
] satisfies Array<[string, Fixture]>)('rejects %s', (_name, fixture) => {
  const result = exercise(fixture);
  expect(result.code, result.output).toBe(1);
}, 20_000);

test('other carved skills preserve their generic report and stdout rules', () => {
  const generic = exercise({ skill: 'review', output: genericReport, writeReport: false });
  expect(generic.code, generic.output).toBe(0);
  const html = exercise({ skill: 'review' });
  expect(html.code, html.output).toBe(1);
}, 20_000);
