// Public command seam: selection omissions, accidental paid execution, and fail-open unknowns.
import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const root = resolve(import.meta.dir, '..');
const command = join(root, 'scripts/validation-select.ts');
const roots: string[] = [];
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'validation-'));
  roots.push(dir);
  return dir;
}
function file(dir: string, name: string, source: string) {
  mkdirSync(resolve(dir, name, '..'), { recursive: true });
  writeFileSync(join(dir, name), source);
}
function run(args: string[], cwd = root, noLaunch = false) {
  const result = Bun.spawnSync([process.execPath,
    ...(noLaunch ? ['--preload', join(root, 'test/fixtures/validation-no-launch.ts')] : []),
    command, '--root', cwd, ...args], { cwd, stdout: 'pipe', stderr: 'pipe', timeout: 20_000 });
  return { code: result.exitCode, stderr: result.stderr.toString(), text: result.stdout.toString() };
}
afterEach(() => { for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true }); });

test('template preview includes structural checks and separate model reasons without any process or provider launch', () => {
  const result = run(['--plan', '--', 'autobuilder-loop/SKILL.md.tmpl'], root, true);
  expect(result.code, result.stderr).toBe(0);
  const report = JSON.parse(result.text);
  expect(report).toMatchObject({ kind: 'dependent-check-plan', status: 'planned', coverageCredit: false, unknownFiles: [] });
  const files = report.free.map((check: any) => check.file);
  for (const name of ['generated-content-freshness', 'auq-format-always-loaded', 'section-manifest-consistency',
    'carve-guard-completeness', 'carve-section-ordering', 'context-budget-ratchet', 'parity-suite']) {
    expect(files).toContain(`test/${name}.test.ts`);
  }
  expect(report.model).toContainEqual(expect.objectContaining({ id: 'autobuilder-loop/SKILL.md workflow', kind: 'judge' }));
  expect(report.model).toContainEqual(expect.objectContaining({ file: 'test/carve-section-loading-autobuilder-loop.test.ts', kind: 'section-read' }));
  for (const check of [...report.free, ...report.model]) expect(check.reasons.length).toBeGreaterThan(0);
});

test('free execution delegates exact selected files and preserves strict receipts without running model work', () => {
  const dir = fixture();
  file(dir, 'test/test-focused.test.ts', `import {test,expect} from 'bun:test';test('fixture contract',()=>expect(4).toBe(4));`);
  file(dir, 'test/skill-e2e-unrelated.test.ts', `throw new Error('provider must not start');`);
  const result = run(['--run-free', '--', 'scripts/test-focused.ts'], dir);
  expect(result.code, result.stderr).toBe(0);
  const report = JSON.parse(result.text);
  expect(report).toMatchObject({ kind: 'dependent-check-result', status: 'passed', coverageCredit: false,
    freeResult: { status: 'passed', observedFiles: ['test/test-focused.test.ts'], coverageCredit: true } });
  expect(existsSync(report.freeResult.receiptPath)).toBe(true);
});

test('manifest and shared contract changes retain structural and supervision coverage with reasons', () => {
  const result = run(['--', 'autobuilder-loop/sections/manifest.json', 'scripts/resolvers/preamble/generate-ask-user-format.ts',
    'autobuilder-loop/autobuilder-unit.js'], root, true);
  expect(result.code, result.stderr).toBe(0);
  const report = JSON.parse(result.text);
  expect(report.free).toContainEqual(expect.objectContaining({ file: 'test/autobuilder-unit-harness.test.ts',
    reasons: [expect.objectContaining({ source: 'autobuilder-loop/autobuilder-unit.js', registry: 'FREE_TOUCHFILES' })] }));
  expect(report.free).toContainEqual(expect.objectContaining({ file: 'test/auq-format-always-loaded.test.ts' }));
  expect(report.free).toContainEqual(expect.objectContaining({ file: 'test/section-manifest-consistency.test.ts' }));
  expect(report.free.every((check: any) => existsSync(join(root, check.file)))).toBe(true);
});

test('unrelated documentation selects no model or free checks and gives no coverage credit', () => {
  const result = run(['--', 'docs/unrelated-notes.md'], root, true);
  expect(result.code, result.stderr).toBe(0);
  expect(JSON.parse(result.text)).toMatchObject({ status: 'no-work', free: [], model: [], coverageCredit: false,
    ignoredFiles: ['docs/unrelated-notes.md'], unknownFiles: [] });
});

test('paid exemptions cannot silently discard unknown free helper or golden coverage', () => {
  for (const source of ['test/helpers/auq-parallel-worker.ts', 'test/fixtures/golden/claude-ship-SKILL.md']) {
    const result = run(['--run-free', '--', source], root, true);
    expect(result.code, result.stderr).toBe(2);
    expect(JSON.parse(result.text)).toMatchObject({ status: 'blocked', model: [], coverageCredit: false,
      ignoredFiles: [], unknownFiles: [source], uncertainties: [{ file: source, reason: expect.stringContaining('coverage is unknown') }] });
  }
});

test('unknown source and changed dependency registry remain blocked before any free or paid launch', () => {
  for (const source of ['lib/new-unregistered-helper.ts', 'test/helpers/touchfiles-data.ts']) {
    const result = run(['--run-free', '--', 'scripts/test-focused.ts', source], root, true);
    expect(result.code, result.stderr).toBe(2);
    expect(JSON.parse(result.text)).toMatchObject({ status: 'blocked', coverageCredit: false, unknownFiles: [source] });
  }
});

test('preview mode cannot be combined with an execution request', () => {
  const result = run(['--plan', '--run-free', '--', 'scripts/test-focused.ts'], root, true);
  expect(result.code).toBe(1);
  expect(result.stderr).toContain('cannot combine');
});

test('a changed free test selects itself exactly and failures retain their original exit status', () => {
  const dir = fixture();
  file(dir, 'test/changed.test.ts', `import {test,expect} from 'bun:test';test('known failure',()=>expect(1).toBe(2));`);
  file(dir, 'test/changed-extra.test.ts', `throw new Error('must not run');`);
  const result = run(['--run-free', '--', 'test/changed.test.ts'], dir);
  expect(result.code, result.stderr).toBe(1);
  const report = JSON.parse(result.text);
  expect(report).toMatchObject({ status: 'failed', freeResult: { status: 'failed',
    observedFiles: ['test/changed.test.ts'], outcome: { exitCode: 1 } } });
});

test('Git change preview uses the same source selection and fails closed when the base is unavailable', () => {
  const dir = fixture();
  const git = (args: string[]) => Bun.spawnSync(['git', ...args], { cwd: dir, stdout: 'pipe', stderr: 'pipe', timeout: 5_000 });
  for (const args of [['init', '-q'], ['config', 'user.name', 'fixture'], ['config', 'user.email', 'fixture@example.invalid']]) expect(git(args).exitCode).toBe(0);
  file(dir, 'scripts/test-focused.ts', '// before');
  file(dir, 'test/test-focused.test.ts', `throw new Error('preview must not execute');`);
  expect(git(['add', '.']).exitCode).toBe(0);
  expect(git(['commit', '-qm', 'fixture']).exitCode).toBe(0);
  file(dir, 'scripts/test-focused.ts', '// after');
  const result = run(['--plan', '--base', 'HEAD'], dir);
  expect(result.code, result.stderr).toBe(0);
  expect(JSON.parse(result.text)).toMatchObject({ status: 'planned', changedFiles: ['scripts/test-focused.ts'],
    free: [expect.objectContaining({ file: 'test/test-focused.test.ts' })], model: [] });
  expect(existsSync(join(dir, '.context'))).toBe(false);
  expect(run(['--plan', '--base', 'nonexistent'], dir).code).toBe(1);
});

test('direct Bun preview accepts source paths even when Bun consumes its leading delimiter', () => {
  const result = Bun.spawnSync([process.execPath, command, '--', 'autobuilder-loop/SKILL.md.tmpl'], {
    cwd: root, stdout: 'pipe', stderr: 'pipe', timeout: 5_000,
  });
  expect(result.exitCode, result.stderr.toString()).toBe(0);
  expect(JSON.parse(result.stdout.toString())).toMatchObject({ status: 'planned', changedFiles: ['autobuilder-loop/SKILL.md.tmpl'] });
});

test('model dependencies remain listed but unexecuted during a successful free run', () => {
  const dir = fixture();
  for (const name of ['autobuilder-efficiency', 'autobuilder-queue', 'autobuilder-launcher', 'autobuilder-ops']) {
    file(dir, `test/${name}.test.ts`, `import {test,expect} from 'bun:test';test('free fixture',()=>expect(1).toBe(1));`);
  }
  file(dir, 'test/skill-llm-eval.test.ts', `import {writeFileSync} from 'node:fs';writeFileSync('paid-started','yes');throw new Error('paid');`);
  const result = run(['--run-free', '--', 'lib/autobuilder-ops-cli.ts'], dir);
  expect(result.code, result.stderr).toBe(0);
  const report = JSON.parse(result.text);
  expect(report.model).toContainEqual(expect.objectContaining({ kind: 'judge', id: 'autobuilder-loop/SKILL.md workflow' }));
  expect(report).toMatchObject({ status: 'passed', coverageCredit: false, freeResult: { status: 'passed', coverageCredit: true } });
  expect(existsSync(join(dir, 'paid-started'))).toBe(false);
});

test('state helper changes select the state and queue checks rather than only model evaluation', () => {
  const result = run(['--', 'lib/autobuilder-ops.ts'], root, true);
  expect(result.code, result.stderr).toBe(0);
  const report = JSON.parse(result.text);
  expect(report.free).toContainEqual(expect.objectContaining({ file: 'test/autobuilder-ops.test.ts' }));
  expect(report.free).toContainEqual(expect.objectContaining({ file: 'test/autobuilder-queue.test.ts' }));
});

test('mixed positional and delimited sources never discard an earlier changed dependency', () => {
  const result = run(['scripts/test-focused.ts', '--', 'docs/unrelated-notes.md'], root, true);
  expect(result.code, result.stderr).toBe(0);
  expect(JSON.parse(result.text)).toMatchObject({ status: 'planned',
    changedFiles: ['docs/unrelated-notes.md', 'scripts/test-focused.ts'],
    free: [expect.objectContaining({ file: 'test/test-focused.test.ts' })] });
});
