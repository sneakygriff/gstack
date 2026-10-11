/**
 * bin/gstack-lane — isolation suite: l4 grok containment + taint snapshots, commit (secret
 * refusal, --cwd form) and worktree add/rm (docs/designs/AUTOBUILDER_LANES.md + D1–D9,
 * E1–E10). Siblings: test/gstack-lane.test.ts (core lanes/classification),
 * test/gstack-lane-process.test.ts (deadlines, reaping, kernel lock),
 * test/gstack-lane-hardening.test.ts (FIX-H + fix rounds 3/symlinked hooks),
 * test/gstack-lane-adjudicate.test.ts. All use test/helpers/gstack-lane-harness.ts: STUB
 * vendor CLIs only, first on a hermetic PATH where the real ones cannot be found.
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { CONFIG, OK_GROK, OK_CODEX, codexStep, real, makeLaneHarness } from './helpers/gstack-lane-harness';

const H = makeLaneHarness('gstack-lane-iso');
const { mkSandbox, step, lane, freshOut, run, calls, lanesOf, wtAdd, sh, mkRepo, gitEnv, repo } = H;

beforeAll(() => H.setup());
afterAll(() => H.teardown());

describe('bin/gstack-lane l4 grok review', () => {
  test('D4: default model resolved via `grok models` and passed as -m; prompt via --prompt-file; reviewed_sha; untainted', () => {
    const sb = mkSandbox();
    step(sb, 'grok', OK_GROK);
    const wt = wtAdd(sb, 'gate-m1-grok', { detach: true });
    const r = run(sb, { lane: 'l4', mode: 'review', effort: 'high', timeout: '600', cwd: wt, out: freshOut(sb, 'gate-m1') });
    expect(r.code).toBe(0);
    expect(calls(sb, 'grok-models')).toHaveLength(1);
    const [c] = calls(sb, 'grok');
    expect(c.argv).toEqual(['--prompt-file', real(sb.prompt), '-m', 'grok-4.7-build', '--reasoning-effort', 'high', '--sandbox', 'read-only',
      '--permission-mode', 'plan', '--output-format', 'json']);
    expect(c.stdin).toBe('');
    expect(r.status()).toMatchObject({ class: 'ok', requested_model: 'grok-4.7-build', requested_model_source: 'grok-default',
      runtime_model: 'grok-4.7-build', model_mismatch: false, sandbox: 'read-only', tainted: false, taint_checked: true, reviewed_sha: sh('git', ['rev-parse', 'HEAD'], repo()) });
  }, 30_000);

  test('model family mismatch is recorded (not a failure); an unresolvable default model refuses to run', () => {
    const sb = mkSandbox();
    step(sb, 'grok', `echo '{"text":"ok","modelUsage":{"grok-4.6-build":{"outputTokens":5}}}'\n`);
    const wt = wtAdd(sb, 'gate-mm', { detach: true });
    const r = run(sb, { lane: 'l4', mode: 'review', effort: 'low', cwd: wt });
    expect(r.code).toBe(0);
    expect(r.status()).toMatchObject({ class: 'ok', requested_model: 'grok-4.7-build', runtime_model: 'grok-4.6-build', model_mismatch: true });
    step(sb, 'grok-models', 'echo "Available models: grok-4.7-build"\n');
    const x = run(sb, { lane: 'l4', mode: 'review', effort: 'low', cwd: wt });
    expect(x.code).toBe(5); // availability problem → auth / lane absent, never class error
    expect(x.status()).toMatchObject({ class: 'auth', note: 'grok-model-unresolved' });
    expect(lanesOf(sb).l4.status).toBe('absent');
    expect(calls(sb, 'grok')).toHaveLength(1);
  });

  test('OPTED-IN sandbox refusal (grok_allow_unsandboxed=true) → plan-only (sandbox none, recorded); the step-down retry skips the doomed sandbox', () => {
    const sb = mkSandbox();
    expect(spawnSync(CONFIG, ['set', 'grok_allow_unsandboxed', 'true'], { env: sb.env, encoding: 'utf8', timeout: 20_000 }).status).toBe(0); // G1: default is ABSENT
    step(sb, 'grok', `echo "Error: could not apply the 'read-only' sandbox profile: /var/run/docker.sock is a symlink. Refusing to start." >&2\nexit 1\n`, 1);
    step(sb, 'grok', 'exit 124\n', 2);
    step(sb, 'grok', OK_GROK, 3);
    const wt = wtAdd(sb, 'gate-m2-grok', { detach: true });
    const r = run(sb, { lane: 'l4', mode: 'review', model: 'grok-4.7', effort: 'xhigh', timeout: '900', cwd: wt });
    expect(r.code).toBe(0);
    expect(calls(sb, 'grok').map((c) => c.argv.includes('--sandbox'))).toEqual([true, false, false]);
    const s = r.status();
    expect(s).toMatchObject({ class: 'ok', sandbox: 'none', unsandboxed_opt_in: true, effort: 'medium', timeout_retry: true });
    expect(s.attempts.map((a: any) => a.class)).toEqual(['sandbox-refused', 'timeout', 'ok']);
    expect(s.attempts[2].timeout_s).toBe(420);
  }, 30_000);

  test('D5: only a registered detached linked worktree under <run-dir>/wt is accepted for review', () => {
    const sb = mkSandbox();
    step(sb, 'grok', OK_GROK);
    const other = mkRepo(`detached-primary-${path.basename(sb.dir)}`);
    sh('git', ['checkout', '-q', '--detach'], other);
    const outside = path.join(sb.dir, 'outside-wt');
    sh('git', ['worktree', 'add', '-q', '--detach', outside, 'HEAD'], repo());
    fs.mkdirSync(path.join(sb.run, 'wt', 'plain'), { recursive: true });
    const branchWt = wtAdd(sb, 'branch-wt');
    for (const cwd of [repo(), other, outside, path.join(sb.run, 'wt', 'plain'), branchWt]) {
      const r = run(sb, { lane: 'l4', mode: 'review', effort: 'high', cwd });
      expect({ cwd, code: r.code }).toEqual({ cwd, code: 1 });
      expect(r.status().rejected).toContain('DETACHED');
    }
    expect(calls(sb, 'grok')).toEqual([]);
    sh('git', ['worktree', 'remove', '--force', outside], repo());
  }, 30_000);

  test('grok_reviews=disabled makes l4 ABSENT for run and probe without invoking grok at all', () => {
    const sb = mkSandbox({ grok: 'disabled' });
    step(sb, 'grok', OK_GROK);
    const r = run(sb, { lane: 'l4', mode: 'review', effort: 'low', cwd: wtAdd(sb, 'gate-dis', { detach: true }) });
    expect(r.code).toBe(5);
    expect(r.status()).toMatchObject({ class: 'auth', note: 'grok-disabled' });
    expect(lanesOf(sb).l4.reason).toContain('disabled by grok_reviews');
    expect(JSON.parse(lane(sb, ['probe', '--run-dir', sb.run, '--lanes', 'l4', '--json']).out).l4.status).toBe('absent');
    expect(calls(sb, 'grok')).toEqual([]);
    expect(calls(sb, 'grok-models')).toEqual([]);
  });

  test('L4 is reviewer-only (impl is a usage error); review efforts outside low|medium|high|xhigh refused; a missing CLI is absent', () => {
    const sb = mkSandbox();
    step(sb, 'grok', OK_GROK);
    for (const tier of ['T0', 'T1', 'T2', undefined]) expect(run(sb, { lane: 'l4', mode: 'impl', model: 'grok-4.7', effort: 'low', tier }).code).toBe(2);
    const wt = wtAdd(sb, 'gate-eff', { detach: true });
    for (const effort of ['max', 'minimal']) expect(run(sb, { lane: 'l4', mode: 'review', model: 'grok-4.7', effort, cwd: wt }).status().rejected).toContain('low|medium|high|xhigh');
    expect(calls(sb, 'grok')).toEqual([]);
    const sb2 = mkSandbox({ stubs: ['codex', 'claude'] });
    const m = run(sb2, { lane: 'l4', mode: 'review', model: 'grok-4.7', effort: 'low', cwd: wtAdd(sb2, 'gate-nocli', { detach: true }) });
    expect(m.code).toBe(5);
    expect(m.status()).toMatchObject({ class: 'auth', note: 'cli-missing' });
  }, 30_000);
});

describe('bin/gstack-lane summary + commit (D1, D2, E7, addendum c/e)', () => {
  test('summary prints ONE compact line (never the transcript) and exits with the recorded code', () => {
    const sb = mkSandbox();
    step(sb, 'codex', codexStep({ stderr: 'SECRET TRANSCRIPT LINE' }));
    const r = run(sb, { lane: 'l3', mode: 'impl', model: 'gpt-6.1-sol', effort: 'low' });
    const s = lane(sb, ['summary', '--out', r.outPath]);
    expect(s.code).toBe(0);
    expect(s.out).toMatch(new RegExp(`^attempt_id=${path.basename(path.dirname(r.outPath))} lane=l3 model=gpt-6.1-sol runtime_model=gpt-6.1-sol class=ok exit=0 duration=\\d+s result_sha=-\\n$`));
    expect(s.out).not.toContain('SECRET');
    const missing = lane(sb, ['summary', '--out', path.join(sb.dir, 'nope.txt')]);
    expect(missing.code).toBe(1);
    expect(missing.out).toContain('class=missing');
  });

  test('commit --task: secret paths in staged changes, in ANY earlier task commit (even deleted later), or hidden by a rename are refused', () => {
    const sb = mkSandbox();
    const repo = mkRepo(`commit-${path.basename(sb.dir)}`, { 'a.txt': 'a\n', 'auth.json': '{"seeded":"secret"}\n' });
    const base = sh('git', ['rev-parse', 'HEAD'], repo);
    const wt = wtAdd(sb, 'task-a', { repo });
    step(sb, 'codex', OK_CODEX);
    const r = run(sb, { lane: 'l3', mode: 'impl', model: 'gpt-6.1-sol', effort: 'low', cwd: wt, out: freshOut(sb, 'task-a') });
    const commit = (extra: string[] = []) => lane(sb, ['commit', '--run-dir', sb.run, '--task', 'task-a', '--base', base, '-m', 'feat: widget', ...extra]);
    // staged secrets of every shape (H7 adds the modern key / credential-file names), reported in one refusal
    const bads = ['.env', '.env.local', 'config/auth.json', 'keys/server.pem', 'tls/x.key', 'id_rsa', 'id_ed25519', 'ssh/id_ecdsa', '.netrc',
      '.git-credentials', 'certs/a.p12', 'certs/b.pfx', 'jvm/c.keystore', 'jvm/d.jks', '.pgpass', '.claude/api-token.txt', '.claude-overflow/x.key',
      'lane-codex-home/y', 'sub/.credentials.json'];
    for (const bad of bads) { fs.mkdirSync(path.dirname(path.join(wt, bad)), { recursive: true }); fs.writeFileSync(path.join(wt, bad), 'secret\n'); }
    fs.writeFileSync(path.join(wt, 'feature.ts'), 'export const x = 1;\n');
    const refused = commit();
    expect(refused.code).toBe(1);
    for (const bad of bads) expect(refused.out).toContain(`secret_path=${bad} commit=staged`);
    expect(refused.err).not.toContain('feature.ts');
    expect(sh('git', ['rev-parse', 'HEAD'], wt)).toBe(base);
    expect(sh('git', ['diff', '--cached', '--name-only'], wt)).toBe('');
    for (const d of ['.env', '.env.local', 'id_rsa', 'id_ed25519', 'ssh', '.netrc', '.git-credentials', 'certs', 'jvm', '.pgpass', '.claude', '.claude-overflow',
      'lane-codex-home', 'config', 'keys', 'tls', 'sub']) fs.rmSync(path.join(wt, d), { recursive: true, force: true });
    // a STAGED rename of a tracked secret: pre-image auth.json → post-image notes.txt
    sh('git', ['mv', 'auth.json', 'notes.txt'], wt);
    const ren = commit();
    expect(ren.code).toBe(1);
    expect(ren.out).toContain('secret_path=auth.json commit=staged');
    sh('git', ['reset', '-q', '--hard'], wt);
    // E7: the agent committed a secret itself, then deleted it in a later commit
    fs.writeFileSync(path.join(wt, 'id_rsa'), 'KEY\n');
    sh('git', ['add', 'id_rsa'], wt);
    sh('git', ['commit', '-q', '-m', 'oops'], wt);
    const leaked = sh('git', ['rev-parse', 'HEAD'], wt);
    sh('git', ['rm', '-q', 'id_rsa'], wt);
    sh('git', ['commit', '-q', '-m', 'cover it up'], wt);
    const head = sh('git', ['rev-parse', 'HEAD'], wt);
    fs.writeFileSync(path.join(wt, 'feature.ts'), 'export const x = 2;\n');
    const hist = commit(['--out', r.outPath]);
    expect(hist.code).toBe(1);
    expect(hist.out.trim().split('\n')).toEqual([`secret_path=id_rsa commit=${head}`, `secret_path=id_rsa commit=${leaked}`]);
    expect(hist.out).not.toContain('result_sha=');
    expect(sh('git', ['rev-parse', 'HEAD'], wt)).toBe(head); // nothing new committed
    expect(JSON.parse(fs.readFileSync(`${r.outPath}.status.json`, 'utf8')).result_sha).toBe(null);
  }, 30_000);

  test('commit --task happy path stamps --out; no_changes; detached snapshot refused', () => {
    const sb = mkSandbox();
    const repo = mkRepo(`commit-ok-${path.basename(sb.dir)}`);
    const base = sh('git', ['rev-parse', 'HEAD'], repo);
    const wt = wtAdd(sb, 'task-b', { repo });
    step(sb, 'codex', OK_CODEX);
    const r = run(sb, { lane: 'l3', mode: 'impl', model: 'gpt-6.1-sol', effort: 'low', cwd: wt, out: freshOut(sb, 'task-b') });
    fs.writeFileSync(path.join(wt, 'feature.ts'), 'export const x = 1;\n');
    const c = lane(sb, ['commit', '--run-dir', sb.run, '--task', 'task-b', '--base', base, '-m', 'feat: widget', '--out', r.outPath]);
    expect(c.code).toBe(0);
    const head = sh('git', ['rev-parse', 'HEAD'], wt);
    expect(c.out.trim().split('\n')).toEqual([`result_sha=${head}`, `base_sha=${base}`]);
    expect(lane(sb, ['summary', '--out', r.outPath]).out).toContain(`result_sha=${head}`);
    expect(lane(sb, ['commit', '--run-dir', sb.run, '--task', 'task-b', '--base', base, '-m', 'noop']).out).toContain('no_changes=true');
    const snap = wtAdd(sb, 'gate-c', { detach: true, repo });
    fs.writeFileSync(path.join(snap, 'x.txt'), 'x\n');
    expect(lane(sb, ['commit', '--run-dir', sb.run, '--task', 'gate-c', '--base', base, '-m', 'no']).code).toBe(1);
  }, 30_000);

  test('addendum e: commit --cwd <milestone worktree> --base <sha> gives the WIP commit the same refusal', () => {
    const sb = mkSandbox();
    const repo = mkRepo(`milestone-${path.basename(sb.dir)}`);
    const base = sh('git', ['rev-parse', 'HEAD'], repo);
    const wip = (extra: string[]) => lane(sb, ['commit', '--cwd', repo, '-m', 'wip: milestone 1', ...extra]);
    expect(wip([]).code).toBe(2); // --base is required
    expect(lane(sb, ['commit', '--cwd', repo, '--task', 't', '--base', base, '-m', 'x']).code).toBe(2);
    fs.writeFileSync(path.join(repo, 'm1.ts'), 'export {};\n');
    fs.writeFileSync(path.join(repo, '.env.production'), 'K=V\n');
    const bad = wip(['--base', base]);
    expect(bad.code).toBe(1);
    expect(bad.out.trim()).toBe('secret_path=.env.production commit=staged');
    expect(sh('git', ['rev-parse', 'HEAD'], repo)).toBe(base);
    fs.rmSync(path.join(repo, '.env.production'));
    const ok = wip(['--base', base]);
    expect(ok.code).toBe(0);
    const head = sh('git', ['rev-parse', 'HEAD'], repo);
    expect(ok.out.trim().split('\n')).toEqual([`result_sha=${head}`, `base_sha=${base}`]);
    // a base that is not an ancestor, a subdirectory, and a task worktree of the run are refused
    const side = mkRepo(`side-${path.basename(sb.dir)}`, { 'other.txt': 'unrelated history\n' });
    expect(wip(['--base', sh('git', ['rev-parse', 'HEAD'], side)]).code).toBe(1);
    fs.mkdirSync(path.join(repo, 'sub'));
    expect(lane(sb, ['commit', '--cwd', path.join(repo, 'sub'), '--base', base, '-m', 'x']).code).toBe(1);
    const t = wtAdd(sb, 'task-c', { repo });
    expect(lane(sb, ['commit', '--cwd', t, '--run-dir', sb.run, '--base', base, '-m', 'x']).code).toBe(1);
  }, 30_000);
});

describe('bin/gstack-lane worktree add|rm (real git)', () => {
  test('branch worktree ab/<run-id>/<task>; rm deletes a merged branch, keeps an unmerged one unless --force', () => {
    const sb = mkSandbox();
    const runId = path.basename(sb.run);
    const wt = wtAdd(sb, 't1');
    expect(wt).toBe(path.join(real(sb.run), 'wt', 't1'));
    expect(sh('git', ['symbolic-ref', '--short', 'HEAD'], wt)).toBe(`ab/${runId}/t1`);
    expect(fs.readFileSync(path.join(sb.run, 'wt-meta', 't1.base'), 'utf8').trim()).toBe(sh('git', ['rev-parse', 'HEAD'], repo()));
    expect(lane(sb, ['worktree', 'add', '--run-dir', sb.run, '--task', 't1', '--repo', repo()]).code).toBe(1);
    expect(lane(sb, ['worktree', 'rm', '--run-dir', sb.run, '--task', 't1', '--repo', repo()]).code).toBe(0);
    expect(fs.existsSync(wt)).toBe(false);
    const wt2 = wtAdd(sb, 't2');
    fs.writeFileSync(path.join(wt2, 'b.txt'), 'b\n');
    sh('git', ['add', 'b.txt'], wt2);
    sh('git', ['commit', '-q', '-m', 'work'], wt2);
    fs.writeFileSync(path.join(wt2, 'dirty.txt'), 'x\n');
    expect(lane(sb, ['worktree', 'rm', '--run-dir', sb.run, '--task', 't2', '--repo', repo()]).code).toBe(1);
    fs.rmSync(path.join(wt2, 'dirty.txt'));
    const rm2 = lane(sb, ['worktree', 'rm', '--run-dir', sb.run, '--task', 't2', '--repo', repo()]);
    expect(rm2.code).toBe(0);
    expect(rm2.err).toContain('not fully merged');
    expect(spawnSync('git', ['show-ref', '--verify', '--quiet', `refs/heads/ab/${runId}/t2`], { cwd: repo(), env: gitEnv(), timeout: 20_000 }).status).toBe(0);
    expect(lane(sb, ['worktree', 'rm', '--run-dir', sb.run, '--task', 't2', '--force', '--repo', repo()]).code).toBe(1); // already removed
  }, 30_000);

  test('--detach --base <sha> snapshot (cwd repo default); hostile task ids are refused; rm only removes this run\'s worktrees', () => {
    const sb = mkSandbox();
    const sha = sh('git', ['rev-parse', 'HEAD'], repo());
    const add = lane(sb, ['worktree', 'add', '--run-dir', sb.run, '--task', 'gate-m1', '--base', sha, '--detach'], {}, repo());
    expect(add.code).toBe(0);
    const wt = add.out.trim().split('\n')[0];
    expect(add.out.trim().split('\n')[1]).toBe(`base_sha=${sha}`);
    expect(sh('git', ['rev-parse', 'HEAD'], wt)).toBe(sha);
    expect(lane(sb, ['worktree', 'rm', '--run-dir', sb.run, '--task', 'gate-m1'], {}, repo()).code).toBe(0);
    expect(fs.existsSync(wt)).toBe(false);
    const victim = wtAdd(sb, 'victim', { detach: true });
    fs.mkdirSync(path.join(sb.run, 'wt', 'ok'), { recursive: true });
    for (const task of ['ok\n/../victim', 'ok\n', '../evil', 'a/b', '.hidden', 'x'.repeat(65)]) {
      for (const verb of ['add', 'rm']) {
        const r = lane(sb, ['worktree', verb, '--run-dir', sb.run, '--task', task, ...(verb === 'rm' ? ['--force'] : []), '--repo', repo()]);
        expect({ task, verb, code: r.code }).toEqual({ task, verb, code: 2 });
      }
    }
    expect(fs.existsSync(victim)).toBe(true);
    expect(lane(sb, ['worktree', 'rm', '--run-dir', sb.run, '--task', 'ok', '--force', '--repo', repo()]).code).toBe(1);
  });

  test('add --detach re-points an existing DETACHED snapshot at the new base; a branch worktree is never replaced', () => {
    const sb = mkSandbox();
    const repo = mkRepo(`repoint-${path.basename(sb.dir)}`);
    const first = sh('git', ['rev-parse', 'HEAD'], repo);
    const wt = wtAdd(sb, 'gate-m1-codex', { detach: true, repo });
    fs.writeFileSync(path.join(repo, 'b.txt'), 'b\n');
    sh('git', ['add', 'b.txt'], repo);
    sh('git', ['commit', '-q', '-m', 'fix round'], repo);
    const second = sh('git', ['rev-parse', 'HEAD'], repo);
    expect(second).not.toBe(first);
    const again = lane(sb, ['worktree', 'add', '--run-dir', sb.run, '--task', 'gate-m1-codex', '--detach', '--base', second, '--repo', repo]);
    expect(again.code).toBe(0);
    expect(again.out.trim().split('\n')).toEqual([wt, `base_sha=${second}`]);
    expect(sh('git', ['rev-parse', 'HEAD'], wt)).toBe(second);
    const task = wtAdd(sb, 'task-x', { repo });
    expect(lane(sb, ['worktree', 'add', '--run-dir', sb.run, '--task', 'task-x', '--detach', '--repo', repo]).code).toBe(1);
    expect(sh('git', ['symbolic-ref', '--short', 'HEAD'], task)).toBe(`ab/${path.basename(sb.run)}/task-x`);
  }, 30_000);
});

describe('invariants across every recorded invocation', () => {
  test('no stub invocation ever received --always-approve; grok never got the prompt text in argv; codex always ran with --json', () => {
    expect(H.checkInvariants()).toBeGreaterThan(10);
  });
});
