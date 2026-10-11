/**
 * Shared harness for the bin/gstack-lane suites (test/gstack-lane.test.ts and
 * test/gstack-lane-isolation.test.ts).
 *
 * Every vendor CLI is a STUB: `codex`, `claude` and `grok` are one bash script
 * (symlinked per name) placed FIRST on a hermetic PATH that contains only the stub
 * dir, a `bun` symlink and the system dirs — the real vendor CLIs are not reachable
 * at all (setup() asserts it), so no test can spend quota. Each stub invocation
 * records argv (NUL-separated), selected env, the NAMES of every ANTHROPIC_* /
 * CLAUDE_CODE_* variable, cwd, stdin and (codex) its CODEX_HOME config + modes under
 * $STUB_DIR/calls/<name>.<n>.<pid>/ (published atomically), then sources a scripted
 * step ($STUB_DIR/<name>.step.<n>, else <name>.step). The codex stub speaks
 * `codex exec --json` (JSONL events) and writes a session rollout into its
 * CODEX_HOME; the real captured samples live in test/fixtures/gstack-lane/ (the
 * rollout is a sanitized reduction). `grok models` is answered by the stub itself
 * (recorded as `grok-models`). git is real (temp repos).
 */
import { expect } from 'bun:test';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export const ROOT = path.resolve(import.meta.dir, '..', '..');
export const LANE = path.join(ROOT, 'bin', 'gstack-lane');
export const CONFIG = path.join(ROOT, 'bin', 'gstack-config');
export const FIX = path.join(ROOT, 'test', 'fixtures', 'gstack-lane');

const STUB = `#!/bin/bash
name=$(basename "$0")
d="\${STUB_DIR:?}"
if [ "$name" = grok ] && [ "\${1:-}" = models ]; then name=grok-models; fi
n=$(( $(cat "$d/$name.count" 2>/dev/null || echo 0) + 1 )); echo "$n" > "$d/$name.count"
final="$d/calls/$name.$n.$$"; rec="$d/calls/.tmp.$name.$n.$$"; mkdir -p "$rec"
printf '%s\\0' "$@" > "$rec/argv"
{ echo "CODEX_HOME=\${CODEX_HOME-<unset>}"
  echo "CLAUDE_CONFIG_DIR=\${CLAUDE_CONFIG_DIR-<unset>}"; } > "$rec/env"
compgen -e | grep -E '^(ANTHROPIC_|CLAUDE_CODE_)' > "$rec/envnames" || true
if [ -n "\${CODEX_HOME:-}" ] && [ -d "$CODEX_HOME" ]; then
  cp "$CODEX_HOME/config.toml" "$rec/codex-config.toml" 2>/dev/null
  cp "$CODEX_HOME/auth.json" "$rec/codex-auth.json" 2>/dev/null
  # Detect the stat dialect ONCE (GNU \`stat -f\` means filesystem status, so a BSD-first
  # fallback chain prints garbage there): GNU -c '%a', else BSD -f '%Lp'.
  if stat -c '%a' / >/dev/null 2>&1; then smode() { stat -c '%a' "$1"; }; else smode() { stat -f '%Lp' "$1"; }; fi
  for f in "$CODEX_HOME" "$CODEX_HOME/auth.json" "$CODEX_HOME/config.toml"; do smode "$f"; done > "$rec/codex-modes"
fi
pwd > "$rec/cwd"
cat > "$rec/stdin" 2>/dev/null || true
mv "$rec" "$final"   # publish the record atomically (readers never see a half-written one)
if [ "$name" = grok-models ] && [ ! -f "$d/grok-models.step" ]; then
  echo "You are logged in with grok.com"; echo "Default model: \${STUB_GROK_DEFAULT:-grok-4.7-build}"; echo "Available models:"; exit 0
fi
if [ -f "$d/$name.step.$n" ]; then . "$d/$name.step.$n"; elif [ -f "$d/$name.step" ]; then . "$d/$name.step"; fi
exit 0
`;

export interface Sandbox {
  dir: string; bin: string; home: string; run: string; wt: string; prompt: string;
  claudeDir: string; gstackHome: string; env: Record<string, string>;
}
export interface Call { n: number; argv: string[]; env: Record<string, string>; envnames: string[]; cwd: string; stdin: string; rec: string }
export type RunOpts = Record<string, string | undefined> & { out?: string; cwd?: string; prompt?: string };
export interface CodexOpts { text?: string | null; model?: string | null; effort?: string; fail?: string; completed?: boolean; rc?: number; stderr?: string; pre?: string; transient?: string[] }

export const sq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
export const flagValue = (argv: string[], flag: string) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : undefined; };
export const real = (p: string) => fs.realpathSync(p);
export const mode = (p: string) => fs.statSync(p).mode & 0o777;
export const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
export async function waitGone(pids: number[], ms = 3000) {
  const end = Date.now() + ms;
  while (Date.now() < end && pids.some(alive)) await Bun.sleep(50);
  return pids.filter(alive);
}

export const OK_CLAUDE = `echo '{"type":"result","is_error":false,"result":"done","modelUsage":{"claude-haiku-5-5-20261001":{"outputTokens":3,"costUSD":0.0001},"claude-sonnet-5-5-20261001":{"outputTokens":900,"costUSD":0.02}}}'\nexit 0\n`;
export const OK_GROK = `echo '{"text":"LGTM: no issues.","stopReason":"end_turn","modelUsage":{"grok-4.7-build":{"inputTokens":10,"outputTokens":20}}}'\nexit 0\n`;
// The REAL captured `codex exec --json` streams (test/fixtures/gstack-lane/).
export const FIX_OK = `cat "${FIX}/ok.stdout.jsonl"\nmkdir -p "$CODEX_HOME/sessions/2026/10/10"\ncp "${FIX}/ok.rollout.jsonl" "$CODEX_HOME/sessions/2026/10/10/rollout-2026-10-10T22-33-24-01a127f3-1280-7661-97b2-d3421d31d94f.jsonl"\nexit 0\n`;
export const FIX_NOAUTH = `cat "${FIX}/noauth.stdout.jsonl"\ncat "${FIX}/noauth.stderr.txt" >&2\nexit 1\n`;
// The REAL captured grok not-signed-in output (F7).
export const FIX_GROK_NOAUTH = `cat "${FIX}/grok-noauth.stdout.json"\ncat "${FIX}/grok-noauth.stderr.txt" >&2\nexit 1\n`;

let threadSeq = 0;
/** A `codex exec --json` stub step: JSONL events on stdout + a rollout in its CODEX_HOME. */
export function codexStep(o: CodexOpts = {}): string {
  threadSeq += 1;
  const thread = `01a1c0de-0000-7000-8000-${String(threadSeq).padStart(12, '0')}`;
  const lines: string[] = [];
  if (o.pre) lines.push(o.pre);
  if (o.model !== null) {
    const rollout = JSON.stringify({ timestamp: '2026-10-11T00:00:00.000Z', type: 'turn_context', payload: { model: o.model ?? 'gpt-6.1-sol', effort: o.effort ?? 'high' } });
    lines.push('mkdir -p "$CODEX_HOME/sessions/2026/10/11"', `printf '%s\\n' ${sq(rollout)} > "$CODEX_HOME/sessions/2026/10/11/rollout-2026-10-11T00-00-00-${thread}.jsonl"`);
  }
  const ev: object[] = [{ type: 'thread.started', thread_id: thread }, { type: 'turn.started' }];
  for (const t of o.transient ?? []) ev.push({ type: 'error', message: t });
  if (o.text !== null) ev.push({ type: 'item.completed', item: { id: 'item_0', type: 'agent_message', text: o.text ?? 'final message' } });
  if (o.fail) ev.push({ type: 'turn.failed', error: { message: o.fail } });
  else if (o.completed !== false) ev.push({ type: 'turn.completed', usage: { input_tokens: 1, output_tokens: 1 } });
  for (const e of ev) lines.push(`printf '%s\\n' ${sq(JSON.stringify(e))}`);
  if (o.stderr) lines.push(`printf '%s\\n' ${sq(o.stderr)} >&2`);
  lines.push(`exit ${o.rc ?? (o.fail ? 1 : 0)}`, '');
  return lines.join('\n');
}
export const OK_CODEX = codexStep();

/** One harness per test file: its own temp base, tools dir and shared git repo. */
export function makeLaneHarness(tag: string) {
  const BASE = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `${tag}-`)));
  const TOOLS = path.join(BASE, 'tools');
  const SYS_PATH = `${TOOLS}:/usr/bin:/bin:/usr/sbin:/sbin`;
  let REPO = '';
  let sbCount = 0;
  let attemptSeq = 0;

  function gitEnv(): Record<string, string> {
    return {
      // bun test pins its own clock to UTC; give the helper the same zone so local-time
      // reset parsing ("try again at 3:04 PM") is compared like for like.
      TZ: 'UTC',
      PATH: SYS_PATH, HOME: BASE, GIT_CONFIG_NOSYSTEM: '1',
      GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com',
    };
  }
  function sh(cmd: string, args: string[], cwd: string, env?: Record<string, string>) {
    const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', env: env ?? gitEnv(), timeout: 20_000 });
    if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed: ${r.stderr}`);
    return r.stdout.trim();
  }
  function mkRepo(name: string, files: Record<string, string> = { 'a.txt': 'a\n' }): string {
    const repo = path.join(BASE, name);
    fs.mkdirSync(repo);
    sh('git', ['init', '-q', '-b', 'main'], repo);
    for (const [f, c] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(repo, f)), { recursive: true }); fs.writeFileSync(path.join(repo, f), c); }
    sh('git', ['add', '-A'], repo);
    sh('git', ['commit', '-q', '-m', 'init'], repo);
    return repo;
  }
  function mkSandbox(opts: { stubs?: string[]; grok?: 'enabled' | 'disabled' } = {}): Sandbox {
    sbCount += 1;
    const dir = path.join(BASE, `sb${sbCount}`);
    const bin = path.join(dir, 'bin');
    const home = path.join(dir, 'home');
    const run = path.join(dir, `run-${sbCount}`);
    const wt = path.join(dir, 'wt');
    const claudeDir = path.join(dir, 'claude-overflow');
    const gstackHome = path.join(dir, 'gstack-home');
    const state = path.join(dir, 'state');
    for (const d of [bin, path.join(home, '.codex'), wt, claudeDir, state]) fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(bin, 'stub'), STUB, { mode: 0o755 });
    for (const n of opts.stubs ?? ['codex', 'claude', 'grok']) fs.symlinkSync('stub', path.join(bin, n));
    // The operator's real-looking codex home: auth + a config WITH remote MCP servers
    // (the stall source) that must NOT leak into the hermetic home.
    fs.writeFileSync(path.join(home, '.codex', 'auth.json'), '{"tokens":{"access_token":"SECRET-TOKEN-123","account_id":"acct-1"}}');
    fs.writeFileSync(path.join(home, '.codex', 'config.toml'), '[mcp_servers.neon]\ncommand = "npx"\n[plugins.x]\n');
    fs.writeFileSync(path.join(claudeDir, '.claude.json'), '{"oauthAccount": {"emailAddress": "second@example.com"}}');
    fs.writeFileSync(path.join(state, 'config.yaml'), `grok_reviews: ${opts.grok ?? 'enabled'}\n`);
    const prompt = path.join(dir, 'prompt.txt');
    fs.writeFileSync(prompt, 'Implement task T7: add the widget.\n');
    const env: Record<string, string> = {
      ...gitEnv(),
      PATH: `${bin}:${SYS_PATH}`,
      HOME: home,
      STUB_DIR: dir,
      GSTACK_STATE_ROOT: state,
      GSTACK_HOME: gstackHome,
      GSTACK_LANE_KILL_GRACE_S: '1',
      GSTACK_LANE_BACKOFF_MS: '200',
      GSTACK_LANE_THROTTLE_RETRIES: '0',
    };
    return { dir, bin, home, run, wt, prompt, claudeDir, gstackHome, env };
  }
  function step(sb: Sandbox, name: string, body: string, n?: number) {
    fs.writeFileSync(path.join(sb.dir, n ? `${name}.step.${n}` : `${name}.step`), body);
  }
  function lane(sb: Sandbox, args: string[], extraEnv: Record<string, string> = {}, cwd?: string) {
    const t0 = Date.now();
    const r = spawnSync(LANE, args, { cwd: cwd ?? sb.dir, encoding: 'utf8', env: { ...sb.env, ...extraEnv }, timeout: 25_000 });
    return { code: r.status ?? -1, out: r.stdout ?? '', err: r.stderr ?? '', ms: Date.now() - t0 };
  }
  function freshOut(sb: Sandbox, task = 't1'): string {
    attemptSeq += 1;
    return path.join(sb.run, 'attempts', task, `a${attemptSeq}`, 'out.txt');
  }
  function runArgs(sb: Sandbox, o: RunOpts, extra: string[] = []) {
    const out = o.out ?? freshOut(sb);
    const a = ['run', '--run-dir', sb.run, '--cwd', o.cwd ?? sb.wt, '--prompt-file', o.prompt ?? sb.prompt, '--out', out];
    for (const [k, v] of Object.entries(o)) if (v !== undefined && !['out', 'cwd', 'prompt'].includes(k)) a.push(`--${k}`, v);
    return { args: [...a, ...extra], out };
  }
  function run(sb: Sandbox, o: RunOpts, extra: string[] = [], env: Record<string, string> = {}) {
    const { args, out } = runArgs(sb, o, extra);
    const r = lane(sb, args, env);
    return { ...r, outPath: out, status: () => JSON.parse(fs.readFileSync(`${out}.status.json`, 'utf8')) };
  }
  function calls(sb: Sandbox, name: string): Call[] {
    const d = path.join(sb.dir, 'calls');
    if (!fs.existsSync(d)) return [];
    return fs.readdirSync(d).filter((f) => !f.startsWith('.') && f.split('.')[0] === name).map((f) => {
      const rec = path.join(d, f);
      const argv = fs.readFileSync(path.join(rec, 'argv'), 'utf8').split('\0');
      argv.pop();
      const env: Record<string, string> = {};
      for (const l of fs.readFileSync(path.join(rec, 'env'), 'utf8').trim().split('\n')) {
        const i = l.indexOf('=');
        env[l.slice(0, i)] = l.slice(i + 1);
      }
      const envnames = fs.readFileSync(path.join(rec, 'envnames'), 'utf8').split('\n').filter(Boolean);
      return { n: Number(f.split('.')[1]), argv, env, envnames, cwd: fs.readFileSync(path.join(rec, 'cwd'), 'utf8').trim(), stdin: fs.readFileSync(path.join(rec, 'stdin'), 'utf8'), rec };
    }).sort((a, b) => a.n - b.n);
  }
  const lanesOf = (sb: Sandbox) => JSON.parse(fs.readFileSync(path.join(sb.run, 'lanes.json'), 'utf8'));
  const writeLanes = (sb: Sandbox, j: unknown) => { fs.mkdirSync(sb.run, { recursive: true }); fs.writeFileSync(path.join(sb.run, 'lanes.json'), JSON.stringify(j)); };
  function wtAdd(sb: Sandbox, task: string, opts: { detach?: boolean; repo?: string } = {}): string {
    const r = lane(sb, ['worktree', 'add', '--run-dir', sb.run, '--task', task, ...(opts.detach ? ['--detach'] : []), '--repo', opts.repo ?? REPO]);
    expect(r.code).toBe(0);
    const [wtPath, baseLine] = r.out.trim().split('\n');
    expect(baseLine).toMatch(/^base_sha=[0-9a-f]{40}$/); // F3: worktree add prints the base for `commit --base`
    return wtPath;
  }
  const codexBase = (sb: Sandbox) => path.join(sb.gstackHome, 'lane-codex-home', path.basename(sb.run));

  function setup() {
    fs.mkdirSync(TOOLS, { recursive: true });
    fs.symlinkSync(process.execPath, path.join(TOOLS, 'bun'));
    REPO = mkRepo('repo');
    // Precondition: the hermetic PATH cannot reach any real vendor CLI.
    for (const c of ['codex', 'claude', 'grok']) {
      const r = spawnSync('bash', ['-c', `command -v ${c}`], { env: { PATH: SYS_PATH }, encoding: 'utf8', timeout: 10_000 });
      expect(r.stdout.trim()).toBe('');
    }
  }
  function teardown() { fs.rmSync(BASE, { recursive: true, force: true }); }
  /** Invariants over every stub invocation this file recorded. Returns how many were checked. */
  function checkInvariants(): number {
    let seen = 0;
    for (const d of fs.readdirSync(BASE).filter((f) => f.startsWith('sb'))) {
      const callsDir = path.join(BASE, d, 'calls');
      if (!fs.existsSync(callsDir)) continue;
      for (const rec of fs.readdirSync(callsDir).filter((f) => !f.startsWith('.'))) {
        const argv = fs.readFileSync(path.join(callsDir, rec, 'argv'), 'utf8').split('\0');
        expect(argv).not.toContain('--always-approve');
        if (rec.startsWith('grok.')) expect(argv.join('\n')).not.toContain('add the widget');
        if (rec.startsWith('codex.')) expect(argv.slice(0, 2)).toEqual(['exec', '--json']);
        seen += 1;
      }
    }
    return seen;
  }

  return {
    BASE, repo: () => REPO, setup, teardown, checkInvariants, gitEnv, sh, mkRepo, mkSandbox, step, lane, freshOut, runArgs, run,
    calls, lanesOf, writeLanes, wtAdd, codexBase,
  };
}
