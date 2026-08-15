/**
 * bin/gstack-lint-touched — PostToolUse (Edit|Write) lint-check hook.
 *
 * The hook's contract is fail-OPEN: it must never break editing. These cases
 * pin the guardrails hardened after review — repo-local binaries only (never a
 * network-installing bunx), tool-crash != findings, and JSON-first file_path
 * extraction. Each spawns the script with synthetic PostToolUse JSON on stdin.
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, chmodSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const SCRIPT = join(import.meta.dir, '..', 'bin', 'gstack-lint-touched');

let work: string;

function hook(payload: unknown) {
  const r = Bun.spawnSync(['bash', SCRIPT], {
    stdin: Buffer.from(typeof payload === 'string' ? payload : JSON.stringify(payload)),
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env },
  });
  return { exitCode: r.exitCode, stderr: r.stderr.toString() };
}

/** A throwaway git repo so `git rev-parse --show-toplevel` resolves a root. */
function repo(): string {
  const dir = mkdtempSync(join(work, 'repo-'));
  Bun.spawnSync(['git', 'init', '-q', dir]);
  return dir;
}

beforeEach(() => { work = mkdtempSync(join(tmpdir(), 'gstack-lint-')); });
afterEach(() => { rmSync(work, { recursive: true, force: true }); });

describe('gstack-lint-touched (fail-open contract)', () => {
  test('non-JS file: exit 0, silent', () => {
    const dir = repo();
    const f = join(dir, 'notes.md');
    writeFileSync(f, '# hi\n');
    expect(hook({ tool_input: { file_path: f } }).exitCode).toBe(0);
  });

  test('missing file: exit 0', () => {
    expect(hook({ tool_input: { file_path: join(work, 'ghost.ts') } }).exitCode).toBe(0);
  });

  test('node_modules path: exit 0 (never lint vendored)', () => {
    const dir = repo();
    const f = join(dir, 'node_modules', 'pkg', 'index.js');
    mkdirSync(join(dir, 'node_modules', 'pkg'), { recursive: true });
    writeFileSync(f, 'var x=1\n');
    expect(hook({ tool_input: { file_path: f } }).exitCode).toBe(0);
  });

  test('JS file, repo has no lint config: exit 0', () => {
    const dir = repo();
    const f = join(dir, 'a.ts');
    writeFileSync(f, 'const x = 1\n');
    expect(hook({ tool_input: { file_path: f } }).exitCode).toBe(0);
  });

  test('biome.json present but no local binary: exit 0 (fail-open, no bunx download)', () => {
    const dir = repo();
    writeFileSync(join(dir, 'biome.json'), '{}\n');
    const f = join(dir, 'a.ts');
    writeFileSync(f, 'const x = 1\n');
    expect(hook({ tool_input: { file_path: f } }).exitCode).toBe(0);
  });

  test('malformed stdin: exit 0', () => {
    expect(hook('not json at all').exitCode).toBe(0);
  });

  test('JSON-first extraction: a decoy file_path in content is ignored', () => {
    const dir = repo();
    const decoy = join(dir, 'decoy.js'); // .js — would be linted if selected
    writeFileSync(decoy, 'var x = 1\n');
    const real = join(dir, 'real.md'); // .md — non-JS, guarantees exit 0 if selected
    writeFileSync(real, '# hi\n');
    // content mentions the decoy .js path BEFORE tool_input.file_path in the object.
    const exit = hook({
      tool_response: { file_path: decoy },
      tool_input: { content: `see ${decoy}`, file_path: real },
    }).exitCode;
    expect(exit).toBe(0); // linted real.md (non-JS) → 0, not the decoy
  });

  test('real findings: local biome exits 1 → hook exits 2 with the file named', () => {
    const dir = repo();
    writeFileSync(join(dir, 'biome.json'), '{}\n');
    const binDir = join(dir, 'node_modules', '.bin');
    mkdirSync(binDir, { recursive: true });
    const fakeBiome = join(binDir, 'biome');
    // Fake linter: prints a finding, exits 1 (biome's findings code).
    writeFileSync(fakeBiome, '#!/bin/sh\necho "lint problem here"\nexit 1\n');
    chmodSync(fakeBiome, 0o755);
    const f = join(dir, 'a.ts');
    writeFileSync(f, 'const x = 1\n');
    const r = hook({ tool_input: { file_path: f } });
    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain('a.ts');
  });

  test('tool crash: local eslint exits 2 → hook exits 0 (fail-open, not treated as findings)', () => {
    const dir = repo();
    writeFileSync(join(dir, '.eslintrc.json'), '{}\n');
    const binDir = join(dir, 'node_modules', '.bin');
    mkdirSync(binDir, { recursive: true });
    const fakeEslint = join(binDir, 'eslint');
    // eslint exit >=2 = tool/config error, not lint findings → must fail open.
    writeFileSync(fakeEslint, '#!/bin/sh\necho "Error: cannot load config" >&2\nexit 2\n');
    chmodSync(fakeEslint, 0o755);
    const f = join(dir, 'a.ts');
    writeFileSync(f, 'const x = 1\n');
    expect(hook({ tool_input: { file_path: f } }).exitCode).toBe(0);
  });
});
