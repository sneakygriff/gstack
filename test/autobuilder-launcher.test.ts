import { test, expect, afterEach } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = path.resolve(import.meta.dir, '..');
const launcher = path.join(root, 'bin/gstack-autobuilder-ops');
const dirs: string[] = [];
function fixture() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ab-launch-')));
  dirs.push(dir);
  const lane = path.join(dir, 'lane with spaces'), scratch = path.join(dir, 'scratch');
  fs.mkdirSync(lane); fs.mkdirSync(scratch);
  return { dir, lane, scratch };
}
afterEach(() => { for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });
function run(command: string, args: string[], cwd: string, overrides: Record<string, string> = {}) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (/^BUN_|^NODE_(OPTIONS|PATH)$/.test(key)) delete env[key];
  return spawnSync(command, args, {
    cwd, env: { ...env, PATH: `${path.dirname(process.execPath)}:${env.PATH}`, ...overrides },
    encoding: 'utf8', timeout: 10_000,
  });
}
function repo(lane: string) {
  for (const args of [['init', '-q'], ['config', 'user.email', 'fixture@example.invalid'], ['config', 'user.name', 'fixture']]) {
    expect(run('git', args, lane).status).toBe(0);
  }
  fs.writeFileSync(path.join(lane, 'app.ts'), 'base\n');
  expect(run('git', ['add', 'app.ts'], lane).status).toBe(0);
  expect(run('git', ['commit', '-qm', 'base'], lane).status).toBe(0);
}
function request(runDir: string, lane: string, decisions: string[] = []) {
  return { runDir, lane, unit: 'u1', flow: 'FULL', phase: 'Build', round: 0, base: 'HEAD', decisions, extra: {} };
}

test('real state and meter commands resist cwd preload and inherited Bun/Node options; clean up on success and failure', () => {
  const { dir, lane, scratch } = fixture(); repo(lane);
  const marker = path.join(dir, 'preload-ran'), inheritedMarker = path.join(dir, 'inherited-ran');
  const payload = path.join(lane, 'payload.ts'), inherited = path.join(dir, 'inherited.cjs');
  fs.writeFileSync(payload, `require('fs').writeFileSync(${JSON.stringify(marker)}, 'ran');\n`);
  fs.writeFileSync(inherited, `require('fs').writeFileSync(${JSON.stringify(inheritedMarker)}, 'ran');\n`);
  fs.writeFileSync(path.join(lane, 'bunfig.toml'), 'preload = ["./payload.ts"]\n');
  // Positive control: the original bare-Bun launch really executes this same fixture.
  expect(run(process.execPath, ['-e', 'console.log("control")'], lane).status).toBe(0);
  expect(fs.existsSync(marker)).toBe(true); fs.unlinkSync(marker);
  const env = { TMPDIR: scratch, BUN_OPTIONS: `--preload ${inherited}`, NODE_OPTIONS: `--require ${inherited}`, NODE_PATH: dir };
  const state = run(launcher, ['state', JSON.stringify(request(dir, lane))], lane, env);
  expect({ status: state.status, out: state.stdout.trim(), err: state.stderr }).toEqual({ status: 0, out: 'ok', err: '' });
  expect(JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8')).lane_head).toMatch(/^[a-f0-9]{40}$/);
  const meter = run(launcher, ['meter', lane, 'HEAD'], lane, env);
  expect(meter.status).toBe(0); expect(meter.stdout).toMatch(/^SHIP_METER: \d+ prod \+ 0 test\n$/);
  const failure = run(launcher, ['meter', lane, 'missing-ref'], lane, env);
  expect(failure.status).toBe(1); expect(failure.stdout.trim()).toBe('SHIP_METER FAIL: operation failed');
  expect(fs.existsSync(marker)).toBe(false); expect(fs.existsSync(inheritedMarker)).toBe(false);
  expect(fs.readdirSync(scratch)).toEqual([]);
});

test('cwd dotenv cannot change Git behavior before the real meter runs', () => {
  const { dir, lane, scratch } = fixture(); repo(lane);
  fs.writeFileSync(path.join(lane, '.env'), `GIT_DIR=${path.join(dir, 'nonexistent-git-dir')}\n`);
  const control = run(process.execPath, ['-e', 'console.log(process.env.GIT_DIR)'], lane);
  expect(control.stdout.trim()).toBe(path.join(dir, 'nonexistent-git-dir'));
  const actual = run(launcher, ['meter', lane, 'HEAD'], lane, { TMPDIR: scratch });
  expect(actual.status).toBe(0); expect(actual.stdout).toMatch(/^SHIP_METER: \d+ prod \+ 0 test\n$/);
  expect(fs.readdirSync(scratch)).toEqual([]);
});

test('the launcher gives Bun a neutral cwd, excludes startup variables and ignores install-side config/dotenv', () => {
  const { dir, lane, scratch } = fixture();
  const install = path.join(dir, 'install with spaces'), bin = path.join(install, 'bin'), lib = path.join(install, 'lib');
  fs.mkdirSync(bin, { recursive: true }); fs.mkdirSync(lib);
  // Copy only into an owned fixture. The probe replaces the CLI, not the launcher.
  const copy = path.join(bin, 'gstack-autobuilder-ops');
  fs.copyFileSync(launcher, copy); fs.chmodSync(copy, 0o755);
  const marker = path.join(dir, 'install-preload-ran');
  fs.writeFileSync(path.join(lib, 'payload.ts'), `require('fs').writeFileSync(${JSON.stringify(marker)}, 'ran');\n`);
  for (const configDir of [install, lib, lane]) {
    fs.writeFileSync(path.join(configDir, 'bunfig.toml'), `preload = [${JSON.stringify(path.join(lib, 'payload.ts'))}]\n`);
    fs.writeFileSync(path.join(configDir, '.env'), 'AB_DOTENV_PROBE=loaded\n');
  }
  fs.writeFileSync(path.join(lib, 'autobuilder-ops-cli.ts'), `console.log(JSON.stringify({
    cwd: process.cwd(), args: process.argv.slice(2), dotenv: process.env.AB_DOTENV_PROBE ?? null,
    startup: Object.keys(process.env).filter(k => /^BUN_|^NODE_(OPTIONS|PATH)$/.test(k))
  }));\n`);
  const args = ['state', 'literal quote \' and $() and `backticks` and spaces'];
  const actual = run(copy, args, lane, {
    TMPDIR: scratch, BUN_OPTIONS: '--preload /nonexistent', BUN_CONFIG_DUMMY: 'unset-me', NODE_OPTIONS: '--require /nonexistent', NODE_PATH: dir,
  });
  expect(actual.status).toBe(0);
  const probe = JSON.parse(actual.stdout);
  expect(probe.args).toEqual(args); expect(probe.dotenv).toBeNull(); expect(probe.startup).toEqual([]);
  expect(path.dirname(probe.cwd)).toBe(scratch); expect(path.basename(probe.cwd)).toMatch(/^gstack-autobuilder-bun\./);
  expect(fs.existsSync(probe.cwd)).toBe(false); expect(fs.existsSync(marker)).toBe(false);
});

test('the real state entry preserves shell metacharacters and a Bun runtime selected through a relative PATH', () => {
  const { dir, lane, scratch } = fixture();
  const runtime = path.join(lane, 'runtime'); fs.mkdirSync(runtime);
  fs.symlinkSync(process.execPath, path.join(runtime, 'bun'));
  const marker = path.join(dir, 'must-not-exist');
  const decision = `quote ' and $(touch ${marker}) and \`touch ${marker}\``;
  const actual = run(launcher, ['state', JSON.stringify(request(dir, lane, [decision]))], lane, {
    TMPDIR: scratch, PATH: `runtime:${process.env.PATH}`,
  });
  expect(actual.status).toBe(0); expect(actual.stdout.trim()).toBe('ok');
  expect(JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8')).open_decisions).toEqual([decision]);
  expect(fs.existsSync(marker)).toBe(false); expect(fs.readdirSync(scratch)).toEqual([]);
});

test('failure to create the isolated cwd fails closed without writing state or exposing request data', () => {
  const { dir, lane } = fixture();
  const secret = 'private-request-sentinel';
  for (const args of [['state', JSON.stringify(request(dir, lane, [secret]))], ['meter', lane, 'HEAD']]) {
    const actual = run(launcher, args, lane, { TMPDIR: path.join(dir, 'missing', secret) });
    expect(actual.status).toBe(1);
    expect(actual.stdout.trim()).toBe(args[0] === 'meter' ? 'SHIP_METER FAIL: operation failed' : 'FAILED: state operation failed');
    expect(actual.stderr.trim()).toBe('AUTOBUILDER_OPS_ERROR: launcher_failed');
    expect(actual.stdout + actual.stderr).not.toContain(secret);
  }
  expect(fs.existsSync(path.join(dir, 'state.json'))).toBe(false);
});
