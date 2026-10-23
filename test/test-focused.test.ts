import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const command = resolve(import.meta.dir, '../scripts/test-focused.ts');
const roots: string[] = [];
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'focused-'));
  roots.push(root);
  mkdirSync(join(root, 'test'));
  return root;
}
function file(root: string, name: string, source: string) {
  mkdirSync(resolve(root, name, '..'), { recursive: true });
  writeFileSync(join(root, name), source);
}
function run(root: string, args: string[], preload?: string) {
  const child = Bun.spawnSync([process.execPath, ...(preload ? ['--preload', preload] : []), command, '--root', root, ...args], {
    cwd: root, stdout: 'pipe', stderr: 'pipe', timeout: 15_000,
  });
  return { code: child.exitCode, text: child.stdout.toString(), stderr: child.stderr.toString() };
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

test('direct and actual package launchers execute positional selectors with the default root', () => {
  const root = fixture();
  file(root, 'test/public.test.ts', `import {test,expect} from 'bun:test';test('public launcher',()=>expect(2+2).toBe(4));`);
  // Preserve the real package command while keeping child artifacts disposable.
  file(root, 'package.json', readFileSync(resolve(import.meta.dir, '../package.json'), 'utf8'));
  symlinkSync(resolve(import.meta.dir, '../scripts'), join(root, 'scripts'));
  for (const args of [[command, '--', 'test/public.test.ts'], ['run', 'test:focused', '--', 'test/public.test.ts']]) {
    const result = Bun.spawnSync([process.execPath, ...args], {
      cwd: root, stdout: 'pipe', stderr: 'pipe', timeout: 15_000,
    });
    expect(result.exitCode, result.stderr.toString()).toBe(0);
    expect(JSON.parse(result.stdout.toString())).toMatchObject({ status: 'passed', coverageCredit: true,
      observedFiles: ['test/public.test.ts'], missingFiles: [], unexpectedFiles: [],
      outcome: { summary: { testsRan: 1, filesRan: 1 } } });
  }
}, 20000);

test('rejects a missing selector before running any valid file', () => {
  const root = fixture();
  file(root, 'test/valid.test.ts', `import {writeFileSync} from 'node:fs';writeFileSync('executed','yes');`);
  const result = run(root, ['--', 'test/valid.test.ts', 'test/missing.test.ts']);
  expect(result.code).toBe(1);
  expect(result.stderr).toContain('test/missing.test.ts');
  expect(existsSync(join(root, 'executed'))).toBe(false);
  expect(existsSync(join(root, '.context'))).toBe(false);
});

test('preview deduplicates exact paths with spaces without launching or writing artifacts', () => {
  const root = fixture();
  file(root, 'test/space name.test.ts', `throw new Error('must not launch');`);
  const before = readdirSync(root);
  const result = run(root, ['--plan', '--', './test/space name.test.ts', join(root, 'test/space name.test.ts')]);
  expect(result.code).toBe(0);
  expect(JSON.parse(result.text)).toMatchObject({ kind: 'focused-plan', status: 'planned', files: ['test/space name.test.ts'] });
  expect(readdirSync(root)).toEqual(before);
});

test('an empty selection is no-work and earns no coverage', () => {
  const root = fixture();
  const result = run(root, ['--']);
  expect(result.code).toBe(0);
  expect(JSON.parse(result.text)).toMatchObject({ status: 'no-work', files: [], coverageCredit: false });
  expect(existsSync(join(root, '.context'))).toBe(false);
});

test('runs only exact selected files and retains a reconciled receipt and complete log', () => {
  const root = fixture();
  file(root, 'test/space name.test.ts', `import {test,expect} from 'bun:test';test('works',()=>expect(2+2).toBe(4));`);
  file(root, 'browse/test/space name.test.ts', `import {writeFileSync} from 'node:fs';writeFileSync('unexpected','yes');throw new Error('wrong file');`);
  const result = run(root, ['--', 'test/space name.test.ts', 'test/space name.test.ts']);
  expect(result.code, result.stderr).toBe(0);
  const receipt = JSON.parse(result.text);
  expect(receipt).toMatchObject({ status: 'passed', coverageCredit: true,
    observedFiles: ['test/space name.test.ts'], missingFiles: [], unexpectedFiles: [],
    outcome: { exitCode: 0, summary: { testsRan: 1, filesRan: 1, sawTerminalSummary: true } } });
  expect(existsSync(join(root, 'unexpected'))).toBe(false);
  expect(JSON.parse(readFileSync(receipt.receiptPath, 'utf8'))).toEqual(receipt);
  expect(readFileSync(receipt.logPath, 'utf8')).toContain('Ran 1 test across 1 file');
}, 20000);

test('invalid, linked, outside-root and paid selections fail before execution', () => {
  const root = fixture();
  file(root, 'test/valid.test.ts', '');
  file(root, 'test/skill-e2e-paid.test.ts', `throw new Error('must not execute');`);
  const outside = fixture();
  file(outside, 'test/escape.test.ts', '');
  symlinkSync(join(root, 'test/valid.test.ts'), join(root, 'test/link.test.ts'));
  for (const name of ['', 'test', 'test/*.test.ts', 'test/link.test.ts', join(outside, 'test/escape.test.ts'), 'test/skill-e2e-paid.test.ts']) {
    expect(run(root, ['--', name]).code, name).toBe(1);
  }
  expect(existsSync(join(root, '.context'))).toBe(false);
});

test('retains original failures and module-load diagnostics', () => {
  for (const [name, source] of [
    ['failure', `import {test,expect} from 'bun:test';test('known failure',()=>expect(1).toBe(2));`],
    ['module', `import './does-not-exist';`],
  ]) {
    const root = fixture();
    file(root, `test/${name}.test.ts`, source);
    const result = run(root, ['--', `test/${name}.test.ts`]);
    const receipt = JSON.parse(result.text);
    expect(result.code).toBe(1);
    expect(receipt).toMatchObject({ status: 'failed', coverageCredit: false, outcome: { exitCode: 1 } });
    expect(readFileSync(receipt.logPath, 'utf8')).toContain(name === 'failure' ? 'known failure' : 'does-not-exist');
  }
}, 20000);

test('a zero exit without the terminal summary is incomplete evidence', () => {
  const root = fixture();
  file(root, 'test/early.test.ts', `console.log('before early exit');process.exit(0);`);
  const result = run(root, ['--', 'test/early.test.ts']);
  const receipt = JSON.parse(result.text);
  expect(result.code).toBe(1);
  expect(receipt).toMatchObject({ status: 'incomplete', coverageCredit: false, outcome: { exitCode: 0 } });
  expect(readFileSync(receipt.logPath, 'utf8')).toContain('before early exit');
}, 20000);

test('unexpected file headers cannot earn coverage even with a matching terminal count', () => {
  const root = fixture();
  file(root, 'test/extra.test.ts', `import {test} from 'bun:test';test('extra output',()=>console.error('test/unplanned.test.ts:'));`);
  const result = run(root, ['--', 'test/extra.test.ts']);
  expect(result.code).toBe(1);
  expect(JSON.parse(result.text)).toMatchObject({ status: 'incomplete', unexpectedFiles: ['test/unplanned.test.ts'], coverageCredit: false });
}, 20000);

test('wall timeout retains diagnostics and a distinct timed-out receipt', () => {
  const root = fixture();
  file(root, 'test/slow.test.ts', `console.error('waiting at fixture boundary');await new Promise(()=>{});`);
  const result = run(root, ['--wall-timeout', '0.3', '--', 'test/slow.test.ts']);
  expect(result.code, result.stderr).toBe(124);
  const receipt = JSON.parse(result.text);
  expect(receipt).toMatchObject({ status: 'timed-out', coverageCredit: false, outcome: { exitCode: null } });
  expect(readFileSync(receipt.logPath, 'utf8')).toContain('waiting at fixture boundary');
}, 20000);

test('cancellation remains distinct from failure and preserves evidence', async () => {
  const root = fixture();
  file(root, 'test/cancel.test.ts', `import {writeFileSync} from 'node:fs';writeFileSync('ready','yes');console.error('awaiting cancellation');await new Promise(()=>{});`);
  const child = Bun.spawn([process.execPath, command, '--root', root, '--', 'test/cancel.test.ts'], {
    cwd: root, stdout: 'pipe', stderr: 'pipe',
  });
  const stdout = new Response(child.stdout).text();
  const stderr = new Response(child.stderr).text();
  const watchdog = setTimeout(() => child.kill('SIGKILL'), 12000);
  try {
    const deadline = Date.now() + 5000;
    while (!existsSync(join(root, 'ready')) && Date.now() < deadline) await Bun.sleep(20);
    expect(existsSync(join(root, 'ready'))).toBe(true);
    child.kill('SIGTERM');
    expect(await child.exited, await stderr).toBe(143);
    const receipt = JSON.parse(await stdout);
    expect(receipt).toMatchObject({ status: 'cancelled', coverageCredit: false,
      outcome: { evidence: { cancellationSignal: 'SIGTERM' } } });
    expect(readFileSync(receipt.logPath, 'utf8')).toContain('awaiting cancellation');
  } finally { clearTimeout(watchdog); if (child.exitCode === null) child.kill('SIGKILL'); }
}, 20000);

test('receipt binds selected input bytes and refuses passing credit if they change during execution', () => {
  const root = fixture();
  file(root, 'test/mutate.test.ts', `import {test} from 'bun:test';import {appendFileSync} from 'node:fs';test('mutates input',()=>appendFileSync(import.meta.filename,'\\n// changed'));`);
  const result = run(root, ['--', 'test/mutate.test.ts']);
  expect(result.code).toBe(1);
  const receipt = JSON.parse(result.text);
  expect(receipt).toMatchObject({ status: 'incomplete', coverageCredit: false, inputsUnchanged: false, revision: null });
  expect(receipt.plan.inputs[0]).toMatchObject({ file: 'test/mutate.test.ts' });
  expect(receipt.plan.inputs[0].sha256).toMatch(/^[a-f0-9]{64}$/);
  expect(receipt.finalInputs[0].sha256).not.toBe(receipt.plan.inputs[0].sha256);
}, 20000);

test('a matching terminal count cannot certify a selected file never observed', () => {
  const root = fixture();
  file(root, 'test/a.test.ts', `console.error('Ran 2 tests across 2 files. [1.00ms]');process.exit(0);`);
  file(root, 'test/b.test.ts', `throw new Error('never started');`);
  const result = run(root, ['--', 'test/a.test.ts', 'test/b.test.ts']);
  expect(result.code).toBe(1);
  expect(JSON.parse(result.text)).toMatchObject({ status: 'incomplete', missingFiles: ['test/b.test.ts'],
    outcome: { exitCode: 0, summary: { filesRan: 2 } }, coverageCredit: false });
}, 20000);

test('lost stdout prevents coverage credit despite an intact stderr summary', () => {
  const root = fixture();
  file(root, 'test/capture.test.ts', `import {test,expect} from 'bun:test';test('works',()=>expect(true).toBe(true));`);
  const result = run(root, ['--', 'test/capture.test.ts'], resolve(import.meta.dir, 'fixtures/focused-capture-preload.ts'));
  expect(result.code).toBe(1);
  const receipt = JSON.parse(result.text);
  expect(receipt).toMatchObject({ status: 'incomplete', coverageCredit: false,
    outcome: { exitCode: 0, evidence: { captureComplete: false }, summary: { sawTerminalSummary: true } } });
  expect(readFileSync(receipt.logPath, 'utf8')).toContain('focused fixture capture loss');
}, 20000);

test('skipped cases remain visible and cannot earn complete coverage credit', () => {
  const root = fixture();
  file(root, 'test/skip.test.ts', `import {test} from 'bun:test';test.skip('unavailable',()=>{});`);
  const result = run(root, ['--', 'test/skip.test.ts']);
  expect(result.code).toBe(0);
  expect(JSON.parse(result.text)).toMatchObject({ status: 'passed', coverageCredit: false,
    outcome: { evidence: { passedTests: 0, skippedTests: 1, failedTests: 0 } } });
}, 20000);
