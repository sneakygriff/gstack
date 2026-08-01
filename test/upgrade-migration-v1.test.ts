/**
 * gstack-upgrade/migrations/v1.0.0.0.sh — writing style notice.
 *
 * The original pending-prompt plumbing was removed with the #48 preamble
 * carve (the prompt never fired in production — see the migration's header
 * comment). The migration is now a one-time printed notice.
 *
 * Coverage:
 * - Fresh state: prints the notice, sets the prompted flag, cleans up any
 *   stale pending flag from the old plumbing
 * - Idempotent: second run is a silent no-op
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawnSync } from 'child_process';

const ROOT = path.resolve(import.meta.dir, '..');
const MIGRATION = path.join(ROOT, 'gstack-upgrade', 'migrations', 'v1.0.0.0.sh');

let tmpHome: string;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'gstack-mig-test-'));
});

afterEach(() => {
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

function run(): { stdout: string; stderr: string; status: number } {
  // Override HOME too — the migration reads `${HOME}/.claude/skills/gstack/bin/gstack-config`,
  // and the developer's real config may have `explain_level` set, which the
  // migration interprets as "user already decided" and short-circuits without
  // writing the pending-prompt flag (breaking these tests).
  const res = spawnSync('bash', [MIGRATION], {
    encoding: 'utf-8',
    env: { ...process.env, GSTACK_HOME: tmpHome, HOME: tmpHome },
  });
  return {
    stdout: (res.stdout ?? '').trim(),
    stderr: (res.stderr ?? '').trim(),
    status: res.status ?? -1,
  };
}

describe('v1.0.0.0 upgrade migration', () => {
  test('migration file exists and is executable', () => {
    expect(fs.existsSync(MIGRATION)).toBe(true);
    const stat = fs.statSync(MIGRATION);
    // Owner execute bit should be set
    expect(stat.mode & 0o100).toBeGreaterThan(0);
  });

  test('fresh state: prints the notice with the terse opt-out and sets the prompted flag', () => {
    const result = run();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('gstack-config set explain_level terse');
    expect(fs.existsSync(path.join(tmpHome, '.writing-style-prompted'))).toBe(true);
    // The old pending-prompt plumbing is gone — the flag must never be written.
    expect(fs.existsSync(path.join(tmpHome, '.writing-style-prompt-pending'))).toBe(false);
  });

  test('cleans up a stale pending flag left by the old plumbing', () => {
    fs.writeFileSync(path.join(tmpHome, '.writing-style-prompt-pending'), '');
    const result = run();
    expect(result.status).toBe(0);
    expect(fs.existsSync(path.join(tmpHome, '.writing-style-prompt-pending'))).toBe(false);
  });

  test('idempotent: second run is a silent no-op', () => {
    run();
    const result = run();
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
  });
});
