/**
 * gstack-config default-table completeness (gate, free).
 *
 * Skill preambles read configuration with
 *
 *     VAR=$(gstack-config get <key> 2>/dev/null || echo "<default>")
 *
 * and that fallback only fires on a NON-ZERO exit. `get` used to answer a key
 * it did not know with "" and exit 0, so VAR came back empty and the default
 * written right there in the preamble was unreachable. The skill then branched
 * on a value it never specified -- "skip entirely if QUESTION_TUNING is false"
 * reached with QUESTION_TUNING="".
 *
 * Four keys skills actually read had no entry in lookup_default and took that
 * path: question_tuning, repo_mode, team_mode, transcript_ingest_mode.
 *
 * Three invariants are pinned so the class cannot reopen:
 *
 *   1. every key read anywhere in the tree is matched by an arm of the DEFAULTS
 *      table. Add a `gstack-config get some_new_key` to a preamble without
 *      adding its default and this test fails. Checked by parsing the case arms
 *      rather than shelling out per key, which keeps it fast and makes the
 *      failure name the key.
 *   2. a genuinely unknown key exits non-zero, so the caller fallback fires.
 *   3. a known key whose default is intentionally empty still exits 0 --
 *      cross_project_learnings ("unset triggers the first-time prompt") and
 *      redact_repo_visibility ("empty falls through to gh/glab detection")
 *      depend on receiving "" successfully.
 */

import { describe, test, expect } from 'bun:test';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const ROOT = path.resolve(import.meta.dir, '..');
const CONFIG_BIN = path.join(ROOT, 'bin', 'gstack-config');
const SELF = 'gstack-config-defaults.test.ts';

// Isolated state dir, so a value the developer happens to have set in their own
// ~/.gstack/config.yaml cannot mask a missing default.
const STATE = fs.mkdtempSync(path.join(os.tmpdir(), 'gstack-config-test-'));

function get(key: string): { out: string; code: number } {
  const r = spawnSync('bash', [CONFIG_BIN, 'get', key], {
    encoding: 'utf-8',
    timeout: 30_000,
    env: { ...process.env, GSTACK_STATE_ROOT: STATE },
  });
  return { out: r.stdout ?? '', code: r.status ?? -1 };
}

/** Case-arm patterns of lookup_default, in order, excluding the catch-all. */
function defaultArms(): string[] {
  const src = fs.readFileSync(CONFIG_BIN, 'utf-8');
  const body = src.slice(src.indexOf('lookup_default()'));
  const end = body.indexOf('\n}');
  const arms: string[] = [];
  // e.g. `    proactive) echo "true" ;;` or `    user_slug_at_*) echo "" ;;`
  for (const m of body.slice(0, end).matchAll(/^\s{4}([a-zA-Z0-9_*]+)\)/gm)) {
    if (m[1] !== '*') arms.push(m[1]);
  }
  return arms;
}

function isCovered(key: string, arms: string[]): boolean {
  return arms.some((a) =>
    a.endsWith('*') ? key.startsWith(a.slice(0, -1)) : key === a,
  );
}

const SKIP_DIRS = new Set(['node_modules', '.git', '.context', 'dist', 'build', '.next']);

/** Every `gstack-config get <key>` call site in the tree. */
function keysReadInTree(root = ROOT): string[] {
  const keys = new Set<string>();
  // [ \t]+ rather than \s+: \s crosses newlines and would pair a trailing
  // "gstack-config get" with the first word of the next line.
  const re = /gstack-config["']?[ \t]+get[ \t]+([a-zA-Z0-9_]+)/g;
  const stack = [root];
  while (stack.length) {
    const cur = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      if (SKIP_DIRS.has(ent.name) || ent.isSymbolicLink()) continue;
      const full = path.join(cur, ent.name);
      if (ent.isDirectory()) {
        stack.push(full);
        continue;
      }
      // Skip this file: its own prose cites example keys.
      if (ent.name === SELF || ent.name === 'CHANGELOG.md') continue;
      if (!/\.(md|ts|sh)$|^gstack-[a-z-]+$/.test(ent.name)) continue;
      let text: string;
      try {
        text = fs.readFileSync(full, 'utf-8');
      } catch {
        continue;
      }
      for (const m of text.matchAll(re)) keys.add(m[1]);
    }
  }
  return [...keys].sort();
}

describe('gstack-config defaults (gate, free)', () => {
  test('retired checkpoint keys have no defaults or advertised configuration', () => {
    expect(fs.readFileSync(CONFIG_BIN, 'utf8')).not.toMatch(/checkpoint/i);
    for (const key of ['checkpoint_mode', 'checkpoint_push']) {
      expect(defaultArms()).not.toContain(key);
      expect(get(key)).toEqual({ out: '', code: 1 });
    }
    for (const command of ['list', 'defaults']) {
      const result = spawnSync('bash', [CONFIG_BIN, command], {
        encoding: 'utf8', timeout: 30_000,
        env: { PATH: process.env.PATH, HOME: STATE, GSTACK_STATE_ROOT: STATE },
      });
      expect(result.status).toBe(0);
      expect(result.stdout).not.toMatch(/checkpoint_mode|checkpoint_push/);
    }
  });

  test('workspace history does not add call sites to the source census', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gstack-config-census-'));
    try {
      fs.mkdirSync(path.join(root, '.context', 'old-checkout'), { recursive: true });
      fs.writeFileSync(path.join(root, 'active.md'), 'gstack-config get question_tuning\n');
      fs.writeFileSync(path.join(root, '.context', 'old-checkout', 'old.md'), 'gstack-config get retired_workspace_key\n');
      fs.writeFileSync(path.join(root, 'CHANGELOG.md'), 'Previously used gstack-config get retired_release_key\n');
      expect(keysReadInTree(root)).toEqual(['question_tuning']);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test('every key read in the tree is covered by the DEFAULTS table', () => {
    const arms = defaultArms();
    expect(arms.length).toBeGreaterThan(10); // the parse actually found the table
    const uncovered = keysReadInTree().filter((k) => !isCovered(k, arms));
    expect(uncovered).toEqual([]);
  });

  test('an unknown key exits non-zero, so the caller fallback fires', () => {
    const r = get('definitely_not_a_gstack_key_9f3a');
    expect(r.code).not.toBe(0);
    expect(r.out).toBe('');
  });

  test('a known key whose default is intentionally empty still exits 0', () => {
    // repo_mode is in this class BY CONTRACT: gstack-repo-mode treats any
    // non-empty answer as a user override and skips classification, so a
    // synthesized "unknown" default would turn the classifier into dead code
    // (caught live by test/gstack-repo-mode.test.ts during the wave).
    for (const key of ['cross_project_learnings', 'salience_allowlist', 'redact_repo_visibility', 'repo_mode']) {
      expect({ key, ...get(key) }).toEqual({ key, out: '', code: 0 });
    }
  });

  test('the regressed keys resolve to the values their callers assume', () => {
    expect(get('question_tuning').out).toBe('false');
    expect(get('team_mode').out).toBe('false');
    expect(get('transcript_ingest_mode').out).toBe('off');
  });
});

describe('design_detector (auto|off, rejecting validator)', () => {
  test('defaults to auto', () => {
    expect(get('design_detector')).toEqual({ out: 'auto', code: 0 });
  });

  test('set to an invalid value exits 1 and leaves the file unchanged', () => {
    const file = path.join(STATE, 'config.yaml');
    const before = fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : null;
    const r = spawnSync('bash', [CONFIG_BIN, 'set', 'design_detector', 'maybe'], {
      encoding: 'utf-8', timeout: 30_000, env: { ...process.env, GSTACK_STATE_ROOT: STATE },
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("design_detector 'maybe' not recognized");
    const after = fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : null;
    expect(after).toBe(before);
    expect(get('design_detector').out).toBe('auto');
  });

  test('list and defaults enumerate design_detector', () => {
    for (const verb of ['list', 'defaults']) {
      const r = spawnSync('bash', [CONFIG_BIN, verb], { encoding: 'utf-8', timeout: 30_000, env: { ...process.env, GSTACK_STATE_ROOT: STATE } });
      expect(r.status).toBe(0);
      expect(r.stdout).toMatch(/design_detector:\s+auto/);
    }
  });

  test('set off / set auto round-trip', () => {
    spawnSync('bash', [CONFIG_BIN, 'set', 'design_detector', 'off'], { encoding: 'utf-8', timeout: 30_000, env: { ...process.env, GSTACK_STATE_ROOT: STATE } });
    expect(get('design_detector').out).toBe('off');
    spawnSync('bash', [CONFIG_BIN, 'set', 'design_detector', 'auto'], { encoding: 'utf-8', timeout: 30_000, env: { ...process.env, GSTACK_STATE_ROOT: STATE } });
    expect(get('design_detector').out).toBe('auto');
  });
});

describe('design_detector_install_prompted (true|false, rejecting validator)', () => {
  const env = { ...process.env, GSTACK_STATE_ROOT: STATE };
  test('defaults to false, rejects a typo with the file unchanged, round-trips true/false, and is enumerated', () => {
    expect(get('design_detector_install_prompted')).toEqual({ out: 'false', code: 0 });
    const file = path.join(STATE, 'config.yaml');
    const before = fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : null;
    const bad = spawnSync('bash', [CONFIG_BIN, 'set', 'design_detector_install_prompted', 'yes'], { encoding: 'utf-8', timeout: 30_000, env });
    expect(bad.status).toBe(1);
    expect(bad.stderr).toContain("design_detector_install_prompted 'yes' not recognized");
    expect(fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : null).toBe(before);
    spawnSync('bash', [CONFIG_BIN, 'set', 'design_detector_install_prompted', 'true'], { encoding: 'utf-8', timeout: 30_000, env });
    expect(get('design_detector_install_prompted').out).toBe('true');
    spawnSync('bash', [CONFIG_BIN, 'set', 'design_detector_install_prompted', 'false'], { encoding: 'utf-8', timeout: 30_000, env });
    expect(get('design_detector_install_prompted').out).toBe('false');
    for (const verb of ['list', 'defaults']) {
      const r = spawnSync('bash', [CONFIG_BIN, verb], { encoding: 'utf-8', timeout: 30_000, env });
      expect(r.stdout).toMatch(/design_detector_install_prompted:\s+false/);
    }
  });
});

describe('autobuilder lane keys (bin/gstack-lane, /autobuilder-loop v1.7.0)', () => {
  // A fresh state dir per test: these keys are written, and the shared STATE above
  // must not leak values between describe blocks.
  const fresh = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gstack-config-ab-'));
    const env = { ...process.env, GSTACK_STATE_ROOT: dir, HOME: dir };
    const run = (args: string[]) => {
      const r = spawnSync('bash', [CONFIG_BIN, ...args], { encoding: 'utf-8', timeout: 30_000, env });
      return { code: r.status ?? -1, out: r.stdout ?? '', err: r.stderr ?? '' };
    };
    return { dir, run };
  };

  test('claude_overflow_dir defaults to $HOME/.claude-overflow and round-trips a path', () => {
    const { dir, run } = fresh();
    try {
      expect(run(['get', 'claude_overflow_dir'])).toMatchObject({ code: 0, out: `${dir}/.claude-overflow` });
      expect(run(['set', 'claude_overflow_dir', '/srv/claude-two']).code).toBe(0);
      expect(run(['get', 'claude_overflow_dir']).out).toBe('/srv/claude-two');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('autobuilder_max_parallel defaults to 6, accepts 1..16, and REJECTS anything else with the value preserved', () => {
    const { dir, run } = fresh();
    try {
      expect(run(['get', 'autobuilder_max_parallel'])).toMatchObject({ code: 0, out: '6' });
      for (const ok of ['1', '8', '16']) {
        expect(run(['set', 'autobuilder_max_parallel', ok]).code).toBe(0);
        expect(run(['get', 'autobuilder_max_parallel']).out).toBe(ok);
      }
      const file = path.join(dir, 'config.yaml');
      const before = fs.readFileSync(file, 'utf-8');
      // Multi-line values used to slip past the line-oriented grep (Astra P2): '99\n6'
      // matched on its 2nd line and then persisted its 1st line, 99.
      for (const bad of ['0', '17', '99', '-1', '6.5', 'six', '06', '1e1', ' 4', '99\n6', '6\n99', '6\r', '\n6']) {
        const r = run(['set', 'autobuilder_max_parallel', bad]);
        expect({ bad, code: r.code }).toEqual({ bad, code: 1 });
        expect(r.err).toContain('Existing value left unchanged');
      }
      expect(fs.readFileSync(file, 'utf-8')).toBe(before);
      expect(run(['get', 'autobuilder_max_parallel']).out).toBe('16');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('panel_budget_usd (the other numeric key) also rejects multi-line values whole', () => {
    const { dir, run } = fresh();
    try {
      expect(run(['set', 'panel_budget_usd', '2.25']).code).toBe(0);
      const before = fs.readFileSync(path.join(dir, 'config.yaml'), 'utf-8');
      for (const bad of ['abc\n2', '2\nabc', '2.5\r', '1.50\n']) {
        const r = run(['set', 'panel_budget_usd', bad]);
        expect({ bad, code: r.code }).toEqual({ bad, code: 1 });
        expect(r.err).toContain('Existing value left unchanged');
      }
      expect(fs.readFileSync(path.join(dir, 'config.yaml'), 'utf-8')).toBe(before);
      expect(run(['get', 'panel_budget_usd']).out).toBe('2.25');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('grok_allow_unsandboxed defaults to false, accepts exactly true/false, and REJECTS anything else with the value preserved', () => {
    const { dir, run } = fresh();
    try {
      expect(run(['get', 'grok_allow_unsandboxed'])).toMatchObject({ code: 0, out: 'false' });
      for (const ok of ['true', 'false', 'true']) {
        expect(run(['set', 'grok_allow_unsandboxed', ok]).code).toBe(0);
        expect(run(['get', 'grok_allow_unsandboxed']).out).toBe(ok);
      }
      for (const bad of ['yes', '1', 'TRUE', 'on', ' true', 'true\nfalse', 'false\ntrue']) {
        const r = run(['set', 'grok_allow_unsandboxed', bad]);
        expect({ bad, code: r.code }).toEqual({ bad, code: 1 });
        expect(r.err).toContain('not recognized');
      }
      expect(run(['get', 'grok_allow_unsandboxed']).out).toBe('true');
      for (const verb of ['list', 'defaults']) expect(run([verb]).out).toMatch(/grok_allow_unsandboxed:\s+(false|true)/);
      const yaml = fs.readFileSync(path.join(dir, 'config.yaml'), 'utf-8');
      expect(yaml).toContain('# grok_allow_unsandboxed: false');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('both keys are enumerated by list/defaults and documented in the annotated header', () => {
    const { dir, run } = fresh();
    try {
      for (const verb of ['list', 'defaults']) {
        const r = run([verb]);
        expect(r.code).toBe(0);
        expect(r.out).toMatch(/autobuilder_max_parallel:\s+6/);
        expect(r.out).toMatch(new RegExp(`claude_overflow_dir:\\s+${dir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/\\.claude-overflow`));
      }
      run(['set', 'telemetry', 'off']); // first set writes the header
      const yaml = fs.readFileSync(path.join(dir, 'config.yaml'), 'utf-8');
      expect(yaml).toContain('# claude_overflow_dir: $HOME/.claude-overflow');
      expect(yaml).toContain('# autobuilder_max_parallel: 6');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
