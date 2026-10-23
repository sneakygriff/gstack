import { expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { execFileSync } from 'node:child_process';
import { createLifecycleDiagnostics } from './helpers/lifecycle-diagnostics';

test('opt-in trace retains a real child timeout and fixture failure before cleanup without changing the error', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'life-diag-test-'));
  try {
    const fixture = path.join(root, 'fixture'), output = path.join(root, 'output');
    fs.mkdirSync(fixture); fs.mkdirSync(output);
    const diagnostic = createLifecycleDiagnostics(fixture, output);
    let childError: any, observed: any;
    try {
      await diagnostic.step('bounded child', () => {
        try {
          return execFileSync(process.execPath, ['-e', "process.stderr.write('fixture-timeout-marker'); setInterval(() => {}, 1000)"],
            { timeout: 500, stdio: ['ignore', 'pipe', 'pipe'] });
        } catch (error) { childError = error; throw error; }
      });
    } catch (error) { observed = error; }
    expect(observed).toBe(childError);
    expect(childError.code).toBe('ETIMEDOUT');
    const captures = path.join(fixture, '.context/shared-libs-captures');
    fs.mkdirSync(captures, { recursive: true });
    fs.writeFileSync(path.join(captures, 'probe.failure.json'), JSON.stringify({ error: 'fixture failure marker' }));
    diagnostic.beforeCleanup();
    fs.rmSync(fixture, { recursive: true });
    const events = fs.readFileSync(diagnostic.log!, 'utf8').trim().split('\n').map(line => JSON.parse(line));
    expect(events.map(event => event.event)).toEqual(['runtime', 'start', 'error', 'before-cleanup', 'fixture-failure']);
    expect(events[2]).toMatchObject({ id: events[1].id, code: 'ETIMEDOUT', stderr: 'fixture-timeout-marker' });
    expect(events[4].text).toContain('fixture failure marker');
    expect(events[4].truncated).toBe(false);
    expect(fs.statSync(diagnostic.log!).mode & 0o777).toBe(0o600);
    expect(fs.statSync(path.dirname(diagnostic.log!)).mode & 0o777).toBe(0o700);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('disabled tracing preserves results and errors; cleanup output cannot live in the fixture', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'life-diag-off-'));
  try {
    const diagnostic = createLifecycleDiagnostics(root, '');
    expect(await diagnostic.step('result', () => 42)).toBe(42);
    const error = new Error('same instance');
    await expect(diagnostic.step('failure', () => { throw error; })).rejects.toBe(error);
    diagnostic.beforeCleanup();
    expect(fs.readdirSync(root)).toEqual([]);
    expect(() => createLifecycleDiagnostics(root, root)).toThrow('survive fixture cleanup');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('retained capture bounds and symlink protection are explicit', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'life-diag-bounds-'));
  try {
    const fixture = path.join(root, 'fixture'), output = path.join(root, 'output');
    fs.mkdirSync(fixture); fs.mkdirSync(output);
    const diagnostic = createLifecycleDiagnostics(fixture, output);
    const captures = path.join(fixture, '.context/shared-libs-captures');
    fs.mkdirSync(captures, { recursive: true });
    fs.writeFileSync(path.join(captures, 'large.failure.json'), 'x'.repeat(70000));
    fs.writeFileSync(path.join(root, 'outside'), 'do-not-copy');
    fs.symlinkSync(path.join(root, 'outside'), path.join(captures, 'link.failure.json'));
    diagnostic.beforeCleanup();
    const text = fs.readFileSync(diagnostic.log!, 'utf8');
    const events = text.trim().split('\n').map(line => JSON.parse(line));
    const capture = events.find(event => event.event === 'fixture-failure');
    expect(capture.truncated).toBe(true);
    expect(capture.text.length).toBe(65536);
    expect(text).not.toContain('do-not-copy');
    expect(events.some(event => event.event === 'capture-error')).toBe(true);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('a lost diagnostic destination cannot replace a work error or stop cleanup', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'life-diag-lost-'));
  try {
    const fixture = path.join(root, 'fixture'), output = path.join(root, 'output');
    fs.mkdirSync(fixture); fs.mkdirSync(output);
    const diagnostic = createLifecycleDiagnostics(fixture, output);
    const original = new Error('original work failure');
    await expect(diagnostic.step('remove output then fail', () => {
      fs.rmSync(output, { recursive: true });
      throw original;
    })).rejects.toBe(original);
    expect(diagnostic.writeFailures).toEqual(['ENOENT']);
    expect(() => diagnostic.beforeCleanup()).not.toThrow();
    fs.rmSync(fixture, { recursive: true });
    expect(fs.existsSync(fixture)).toBe(false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
