/**
 * bin/gstack-lane — pre-merge hardening suite (FIX-H: H1–H5, H7, H8, H10, H12–H17 + P3s).
 * Each case pins a reviewed failure scenario: repo-controlled code (hooks, filters, bun
 * preloads) never runs on the host, commit screening cannot be fooled by quoted names or
 * replace refs, the secret guard is precise, and lane state obeys event ordering.
 * Shares test/helpers/gstack-lane-harness.ts: STUB vendor CLIs only, first on a hermetic
 * PATH where the real ones cannot be found; git is real.
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { spawn, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { LANE, OK_CLAUDE, OK_GROK, OK_CODEX, FIX_GROK_NOAUTH, codexStep, sq, flagValue, waitGone, makeLaneHarness } from './helpers/gstack-lane-harness';

const H = makeLaneHarness('gstack-lane-hard');
const { mkSandbox, step, lane, freshOut, runArgs, run, calls, lanesOf, writeLanes, wtAdd, codexBase, sh, mkRepo } = H;

beforeAll(() => H.setup());
afterAll(() => H.teardown());

const headOf = (dir: string) => sh('git', ['rev-parse', 'HEAD'], dir);

describe('H1/V1: worktree lifecycle is inert', () => {
  test('an in-tree core.hooksPath post-checkout hook and a smudge/clean filter never run on worktree add (task + --detach) or rm', () => {
    const sb = mkSandbox();
    const hookMark = path.join(sb.dir, 'HOOK-RAN');
    const filterMark = path.join(sb.dir, 'FILTER-RAN');
    const repo = mkRepo(`h1-${path.basename(sb.dir)}`, {
      'a.txt': 'a\n', '.gitattributes': '*.txt filter=sm\n',
      '.githooks/post-checkout': `#!/bin/sh\ntouch ${sq(hookMark)}\n`,
    });
    fs.chmodSync(path.join(repo, '.githooks', 'post-checkout'), 0o755);
    sh('git', ['add', '.githooks/post-checkout'], repo);
    sh('git', ['commit', '-q', '-m', 'exec bit'], repo);
    sh('git', ['config', 'core.hooksPath', '.githooks'], repo);
    sh('git', ['config', 'filter.sm.smudge', `touch ${sq(filterMark)}; cat`], repo);
    sh('git', ['config', 'filter.sm.clean', `touch ${sq(filterMark)}; cat`], repo);
    const task = wtAdd(sb, 'task-h1', { repo });
    const snap = wtAdd(sb, 'gate-h1', { detach: true, repo });
    expect({ hook: fs.existsSync(hookMark), filter: fs.existsSync(filterMark) }).toEqual({ hook: false, filter: false });
    expect(fs.readFileSync(path.join(snap, 'a.txt'), 'utf8')).toBe('a\n');
    expect(fs.readFileSync(path.join(sb.run, 'wt-meta', 'task-h1.control'), 'utf8').split('\n').filter(Boolean).map((l) => l.split(' ')[0]))
      .toEqual(['config', 'hooks', 'info', 'config.worktree', 'hookspath']);
    // rm (no --force) checks for local changes — a dirty filtered file must not run the clean filter either
    fs.appendFileSync(path.join(task, 'a.txt'), 'dirty\n');
    expect(lane(sb, ['worktree', 'rm', '--run-dir', sb.run, '--task', 'task-h1', '--repo', repo]).code).toBe(1);
    expect(lane(sb, ['worktree', 'rm', '--run-dir', sb.run, '--task', 'gate-h1', '--repo', repo]).code).toBe(0);
    expect(fs.existsSync(hookMark)).toBe(false);
    expect(fs.existsSync(filterMark)).toBe(false);
  }, 30_000);

  test('V1: a filter that a conditional include defines ONLY inside linked worktrees (gitdir:**/worktrees/**) is enumerated in the new worktree and never smudges', () => {
    const sb = mkSandbox();
    const mark = path.join(sb.dir, 'GITDIR-SMUDGE-RAN');
    const repo = mkRepo(`v1g-${path.basename(sb.dir)}`, { 'a.txt': 'raw a\n', '.gitattributes': '* filter=x\n' });
    const inc = path.join(sb.dir, 'inc-gitdir.cfg');
    fs.writeFileSync(inc, `[filter "x"]\n\tsmudge = touch ${sq(mark)}; cat\n\tclean = touch ${sq(mark)}; cat\n`);
    sh('git', ['config', 'includeIf.gitdir:**/worktrees/**.path', inc], repo);
    const fromSource = spawnSync('git', ['config', '--name-only', '--get-regexp', '^filter\\.'], { cwd: repo, env: H.gitEnv(), encoding: 'utf8', timeout: 20_000 });
    expect(fromSource.stdout).toBe(''); // invisible from the source checkout
    const task = wtAdd(sb, 'task-v1g', { repo });
    const snap = wtAdd(sb, 'gate-v1g', { detach: true, repo });
    expect(fs.existsSync(mark)).toBe(false);
    for (const wt of [task, snap]) {
      expect(fs.readFileSync(path.join(wt, 'a.txt'), 'utf8')).toBe('raw a\n');
      expect(sh('git', ['-c', 'filter.x.clean=cat', '-c', 'filter.x.smudge=cat', 'status', '--porcelain'], wt)).toBe(''); // fully populated
    }
    expect(fs.existsSync(mark)).toBe(false);
  }, 30_000);

  test('V1: a repo config with an includeIf "onbranch:" section is refused (control_changed=includeif-onbranch); its payload never runs, nothing is created', () => {
    const sb = mkSandbox();
    const mark = path.join(sb.dir, 'ONBRANCH-SMUDGE-RAN');
    const repo = mkRepo(`v1o-${path.basename(sb.dir)}`, { 'a.txt': 'a\n', '.gitattributes': '* filter=x\n' });
    const inc = path.join(sb.dir, 'inc-onbranch.cfg');
    fs.writeFileSync(inc, `[filter "x"]\n\tsmudge = touch ${sq(mark)}; cat\n`);
    sh('git', ['config', 'includeIf.onbranch:ab/**.path', inc], repo);
    for (const detach of [false, true]) {
      const task = detach ? 'gate-v1o' : 'task-v1o';
      const r = lane(sb, ['worktree', 'add', '--run-dir', sb.run, '--task', task, ...(detach ? ['--detach'] : []), '--repo', repo]);
      expect({ detach, code: r.code, out: r.out.trim() }).toEqual({ detach, code: 1, out: 'control_changed=includeif-onbranch' });
      expect(r.err).toContain('onbranch');
      expect(fs.existsSync(path.join(sb.run, 'wt', task))).toBe(false);
    }
    expect(sh('git', ['branch', '--list', 'ab/*'], repo)).toBe('');
    expect(fs.existsSync(mark)).toBe(false);
  }, 30_000);
});

describe('H2: bun isolation', () => {
  test('a repo bunfig.toml preload, a .env and BUN_OPTIONS=--preload never run during probe/run/summary/commit/adjudicate', () => {
    const sb = mkSandbox();
    const mark = path.join(sb.dir, 'PRELOAD-RAN');
    const optMark = path.join(sb.dir, 'BUN-OPTIONS-RAN');
    const optPayload = path.join(sb.dir, 'opt-payload.ts');
    fs.writeFileSync(optPayload, `require('fs').writeFileSync(${JSON.stringify(optMark)}, 'x');\n`);
    const repo = mkRepo(`h2-${path.basename(sb.dir)}`, {
      'bunfig.toml': 'preload = ["./payload.ts"]\n',
      'payload.ts': `require('fs').writeFileSync(${JSON.stringify(mark)}, 'x');\n`,
      '.env': 'GSTACK_LANE_TEST_DOTENV=loaded\n',
    });
    const tmp = path.join(sb.dir, 'tmp'); // the helper's private bun cwd lands here and must be gone afterwards
    fs.mkdirSync(tmp);
    const env = { BUN_OPTIONS: `--preload ${optPayload}`, NODE_OPTIONS: `--require ${optPayload}`, TMPDIR: tmp };
    step(sb, 'codex', codexStep({ text: 'no [P1] issues found\nREVIEW_COMPLETE: findings=0' }));
    expect(lane(sb, ['probe', '--run-dir', sb.run, '--lanes', 'l3'], env, repo).code).toBe(0);
    const { args, out } = runArgs(sb, { lane: 'l3', mode: 'review', model: 'gpt-6.1-sol', effort: 'high', cwd: repo, out: freshOut(sb, 'gate-h2-codex') });
    expect(lane(sb, args, env, repo).code).toBe(0);
    expect(lane(sb, ['summary', '--out', out], env, repo).out).toContain('class=ok');
    expect({ bunfig: fs.existsSync(mark), bunOptions: fs.existsSync(optMark) }).toEqual({ bunfig: false, bunOptions: false });
    const adj = lane(sb, ['adjudicate', '--out', out, '--seat', 'codex', '--gate-class', 'ordinary', '--requested-model', 'gpt-6.1-sol',
      '--reviewed-sha', headOf(repo)], env, repo);
    expect({ code: adj.code, line: adj.out.trim() }).toEqual({ code: 0, line: 'VERDICT=PRESENT_CLEAN reason=no_p1 p1_count=0 runtime_model=gpt-6.1-sol' });
    fs.writeFileSync(path.join(repo, 'new.ts'), 'export {};\n');
    expect(lane(sb, ['commit', '--cwd', repo, '--base', headOf(repo), '-m', 'wip', '--out', out], env, repo).code).toBe(0);
    expect(JSON.parse(fs.readFileSync(`${out}.status.json`, 'utf8')).result_sha).toBe(headOf(repo));
    expect(fs.existsSync(mark)).toBe(false);
    expect(fs.existsSync(optMark)).toBe(false);
    expect(fs.readdirSync(tmp)).toEqual([]);
  }, 30_000);
});

describe('H3: per-worktree config is control state', () => {
  test('a clean filter added via config.worktree during a review ⇒ tainted, and the filter never executes', () => {
    const sb = mkSandbox();
    const mark = path.join(sb.dir, 'WT-FILTER-RAN');
    const repo = mkRepo(`h3-${path.basename(sb.dir)}`, { 'a.txt': 'a\n', '.gitattributes': '*.txt filter=wt\n' });
    sh('git', ['config', 'core.repositoryformatversion', '1'], repo);
    sh('git', ['config', 'extensions.worktreeConfig', 'true'], repo);
    // the reviewer defines the filter ONLY in its worktree's config.worktree, then dirties a matching file's stat
    step(sb, 'grok', `git config --worktree filter.wt.clean ${sq(`touch ${sq(mark)}; cat`)}\ntouch a.txt\n${OK_GROK}`);
    const r = run(sb, { lane: 'l4', mode: 'review', effort: 'high', cwd: wtAdd(sb, 'gate-h3', { detach: true, repo }) });
    expect(r.code).toBe(1);
    expect(r.status()).toMatchObject({ class: 'error', tainted: true });
    expect(r.status().taint_detail).toContain('control state changed');
    expect(fs.existsSync(mark)).toBe(false);
  }, 30_000);
});

describe('commit screening (H4, H5, H7, H8, H12, P3)', () => {
  test('H4: committed `dir<TAB>/auth.json` and a quote-bearing `q"x/.env` (clean index) are refused — NUL-delimited, never C-quoted', () => {
    const sb = mkSandbox();
    const repo = mkRepo(`h4-${path.basename(sb.dir)}`);
    const base = headOf(repo);
    const wt = wtAdd(sb, 'task-h4', { repo });
    for (const p of ['dir\t/auth.json', 'q"x/.env']) { fs.mkdirSync(path.dirname(path.join(wt, p)), { recursive: true }); fs.writeFileSync(path.join(wt, p), 'secret\n'); }
    sh('git', ['add', '-A'], wt);
    sh('git', ['commit', '-q', '-m', 'sneak'], wt);
    const sneak = headOf(wt);
    const r = lane(sb, ['commit', '--run-dir', sb.run, '--task', 'task-h4', '--base', base, '-m', 'feat']);
    expect(r.code).toBe(1);
    for (const l of [`secret_path=dir?/auth.json commit=${sneak}`, 'secret_path=dir?/auth.json commit=net', `secret_path=q"x/.env commit=${sneak}`, 'secret_path=q"x/.env commit=net']) {
      expect(r.out.split('\n')).toContain(l);
    }
    expect(r.out).not.toContain('result_sha=');
  }, 30_000);

  test('H5: a refs/replace substitute that hides an auth.json commit does not fool history/net/staged screening', () => {
    const sb = mkSandbox();
    const repo = mkRepo(`h5-${path.basename(sb.dir)}`);
    const base = headOf(repo);
    const wt = wtAdd(sb, 'task-h5', { repo });
    fs.writeFileSync(path.join(wt, 'auth.json'), '{"token":"x"}\n');
    fs.writeFileSync(path.join(wt, 'f.txt'), 'f\n');
    sh('git', ['add', '-A'], wt);
    sh('git', ['commit', '-q', '-m', 'A'], wt);
    const a = headOf(wt);
    sh('git', ['rm', '-q', '--cached', 'auth.json'], wt);
    fs.rmSync(path.join(wt, 'auth.json'));
    const clean = sh('git', ['commit-tree', sh('git', ['write-tree'], wt), '-p', base, '-m', 'A'], wt);
    sh('git', ['replace', a, clean], wt);
    expect(sh('git', ['show', '--name-only', '--format=', 'HEAD'], wt)).toBe('f.txt'); // what replace-honoring git sees
    const r = lane(sb, ['commit', '--run-dir', sb.run, '--task', 'task-h5', '--base', base, '-m', 'feat']);
    expect(r.code).toBe(1);
    for (const l of [`secret_path=auth.json commit=${a}`, 'secret_path=auth.json commit=net', 'secret_path=auth.json commit=staged']) expect(r.out.split('\n')).toContain(l);
    expect(headOf(wt)).toBe(a);
  }, 30_000);

  test('H7 (D9 IRON RULE): .env.example, .claude/settings.json, .claude/commands/*, a token-less .npmrc commit fine; id_ed25519, .netrc, an _authToken .npmrc are refused', () => {
    const sb = mkSandbox();
    const repo = mkRepo(`h7-${path.basename(sb.dir)}`);
    const wip = () => lane(sb, ['commit', '--cwd', repo, '--base', headOf(repo), '-m', 'wip']);
    const write = (files: Record<string, string>) => { for (const [f, c] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(repo, f)), { recursive: true }); fs.writeFileSync(path.join(repo, f), c); } };
    write({
      '.env.example': 'API_KEY=\n', '.env.sample': 'X=\n', '.env.template': 'Y=\n', 'config/.env.test.example': 'Z=\n',
      '.claude/settings.json': '{"permissions":{"allow":["Read"]}}\n', '.claude/commands/ship.md': 'ship it\n',
      '.npmrc': 'registry=https://registry.npmjs.org/\nalways-auth=false\n', '.yarnrc.yml': 'nodeLinker: node-modules\n',
    });
    const ok = wip();
    expect({ code: ok.code, out: ok.out.split('\n')[0] }).toEqual({ code: 0, out: `result_sha=${headOf(repo)}` });
    expect(sh('git', ['show', '--name-only', '--format=', 'HEAD'], repo).split('\n').sort()).toEqual(['.claude/commands/ship.md', '.claude/settings.json',
      '.env.example', '.env.sample', '.env.template', '.npmrc', '.yarnrc.yml', 'config/.env.test.example']);
    const before = headOf(repo);
    write({ 'deploy/id_ed25519': 'KEY\n', '.netrc': 'machine x login y password z\n', '.npmrc': '//registry.npmjs.org/:_authToken=npm_abc\n', '.pypirc': '[pypi]\nusername = __token__\npassword = pypi-x\n',
      // V3: direnv and kubeconfig shapes
      '.envrc': 'export AWS_SECRET_ACCESS_KEY=x\n', 'ops/kubeconfig': 'users: []\n', 'ops/prod.kubeconfig': 'users: []\n', 'home/.kube/config': 'users: []\n' });
    const bad = wip();
    expect(bad.code).toBe(1);
    expect(bad.out.trim().split('\n').sort()).toEqual(['secret_path=.envrc commit=staged', 'secret_path=.netrc commit=staged', 'secret_path=.npmrc commit=staged',
      'secret_path=.pypirc commit=staged', 'secret_path=deploy/id_ed25519 commit=staged', 'secret_path=home/.kube/config commit=staged',
      'secret_path=ops/kubeconfig commit=staged', 'secret_path=ops/prod.kubeconfig commit=staged']);
    expect(headOf(repo)).toBe(before);
  }, 30_000);

  test('H8: the operator\'s global core.excludesFile still applies on the inert commit path (no .DS_Store / *.junk in the commit)', () => {
    const sb = mkSandbox();
    fs.writeFileSync(path.join(sb.home, '.gitconfig'), '[core]\n\texcludesFile = ~/.gitignore_global\n');
    fs.writeFileSync(path.join(sb.home, '.gitignore_global'), '.DS_Store\n*.junk\n');
    const repo = mkRepo(`h8-${path.basename(sb.dir)}`);
    for (const f of ['.DS_Store', 'x.junk', 'real.ts']) fs.writeFileSync(path.join(repo, f), 'x\n');
    const r = lane(sb, ['commit', '--cwd', repo, '--base', headOf(repo), '-m', 'wip']);
    expect(r.code).toBe(0);
    expect(sh('git', ['show', '--name-only', '--format=', 'HEAD'], repo)).toBe('real.ts');
  }, 30_000);

  test('P3: commit --cwd over a repo config that enables log.showSignature + a gpg.program never runs that program', () => {
    const sb = mkSandbox();
    const mark = path.join(sb.dir, 'GPG-RAN');
    const repo = mkRepo(`p3gpg-${path.basename(sb.dir)}`);
    const base = headOf(repo);
    const signer = path.join(sb.dir, 'fake-signer.sh');
    fs.writeFileSync(signer, '#!/bin/sh\ncat >/dev/null\necho "-----BEGIN PGP SIGNATURE-----"\necho "ZmFrZQ=="\necho "-----END PGP SIGNATURE-----"\necho "[GNUPG:] SIG_CREATED D 1 8 00 1 X" >&2\n', { mode: 0o755 });
    fs.writeFileSync(path.join(repo, 'b.txt'), 'b\n');
    sh('git', ['add', 'b.txt'], repo);
    sh('git', ['-c', `gpg.program=${signer}`, '-c', 'user.signingkey=X', 'commit', '-q', '-S', '-m', 'signed'], repo);
    const verifier = path.join(sb.dir, 'verifier.sh');
    fs.writeFileSync(verifier, `#!/bin/sh\ntouch ${sq(mark)}\ncat >/dev/null\nexit 1\n`, { mode: 0o755 });
    sh('git', ['config', 'log.showSignature', 'true'], repo);   // a tampered common config (no fingerprint on the --cwd form)
    sh('git', ['config', 'gpg.program', verifier], repo);
    fs.writeFileSync(path.join(repo, 'c.txt'), 'c\n');
    const r = lane(sb, ['commit', '--cwd', repo, '--base', base, '-m', 'wip']);
    expect(r.code).toBe(0);
    expect(fs.existsSync(mark)).toBe(false);
  }, 30_000);

  test('P3: an exported CDPATH never redirects a relative --run-dir', () => {
    const sb = mkSandbox();
    fs.mkdirSync(path.join(sb.dir, 'decoy', 'run-cd'), { recursive: true });
    const r = lane(sb, ['worktree', 'add', '--run-dir', 'run-cd', '--task', 'cd1', '--detach', '--repo', H.repo()], { CDPATH: path.join(sb.dir, 'decoy') });
    expect(r.code).toBe(0);
    expect(r.out.split('\n')[0]).toBe(path.join(sb.dir, 'run-cd', 'wt', 'cd1'));
    expect(fs.readdirSync(path.join(sb.dir, 'decoy', 'run-cd'))).toEqual([]);
  }, 30_000);

  test('H12: commit --cwd refuses a worktree on an ab/*/* task branch even without --run-dir', () => {
    const sb = mkSandbox();
    const repo = mkRepo(`h12-${path.basename(sb.dir)}`);
    const base = headOf(repo);
    const t = wtAdd(sb, 'task-h12', { repo });
    fs.writeFileSync(path.join(t, 'f.txt'), 'f\n');
    const r = lane(sb, ['commit', '--cwd', t, '--base', base, '-m', 'x']);
    expect(r.code).toBe(1);
    expect(r.err).toContain('task branch');
    expect(headOf(t)).toBe(base);
  }, 30_000);
});

describe('lanes (H10, H13–H17, P3)', () => {
  test('H10: the codex thread id comes from a JSON parse — a reordered/spaced thread.started still finds the rollout', () => {
    const sb = mkSandbox();
    const thread = '01a1c0de-0000-7000-8000-00000000beef';
    const rollout = JSON.stringify({ type: 'turn_context', payload: { model: 'gpt-6.1-sol', effort: 'high' } });
    step(sb, 'codex', [
      'mkdir -p "$CODEX_HOME/sessions/2026/10/11"',
      `printf '%s\\n' ${sq(rollout)} > "$CODEX_HOME/sessions/2026/10/11/rollout-2026-10-11T00-00-00-${thread}.jsonl"`,
      `printf '%s\\n' ${sq(`{ "thread_id" : "${thread}", "type" : "thread.started" }`)}`,
      `printf '%s\\n' ${sq(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'done' } }))}`,
      `printf '%s\\n' ${sq(JSON.stringify({ type: 'turn.completed' }))}`, 'exit 0', ''].join('\n'));
    const r = run(sb, { lane: 'l3', mode: 'impl', model: 'gpt-6.1-sol', effort: 'high' });
    expect(r.code).toBe(0);
    expect(r.status()).toMatchObject({ runtime_model: 'gpt-6.1-sol', runtime_model_source: 'rollout', runtime_effort: 'high' });
  });

  test('H13: --schema reaches grok as --json-schema <schema json> (redacted in cmd_redacted)', () => {
    const sb = mkSandbox();
    step(sb, 'grok', OK_GROK);
    const schema = path.join(sb.dir, 'envelope.schema.json');
    fs.writeFileSync(schema, '{"type":"object","required":["status"]}');
    const r = run(sb, { lane: 'l4', mode: 'review', model: 'grok-4.7-build-fast', effort: 'low', schema, cwd: wtAdd(sb, 'gate-h13', { detach: true }) });
    expect(r.code).toBe(0);
    const [c] = calls(sb, 'grok');
    expect(flagValue(c.argv, '--json-schema')).toBe('{"type":"object","required":["status"]}');
    expect(c.argv.slice(-2)).toEqual(['--output-format', 'json']);
    expect(r.status().cmd_redacted).toContain('--json-schema <schema-file>');
    expect(r.status()).not.toHaveProperty('schema_applied');
  });

  test('H14: an IMPL timeout is final (no effort step-down below the routing floor); a review still steps down once', () => {
    const sb = mkSandbox();
    step(sb, 'codex', 'exit 124\n');
    const impl = run(sb, { lane: 'l3', mode: 'impl', model: 'gpt-6-astra', effort: 'xhigh', timeout: '5' });
    expect(impl.code).toBe(124);
    expect(impl.status()).toMatchObject({ class: 'timeout', effort: 'xhigh', timeout_retry: false });
    expect(impl.status().attempts.map((a: any) => a.effort)).toEqual(['xhigh']);
    const rev = run(sb, { lane: 'l3', mode: 'review', model: 'gpt-6-astra', effort: 'xhigh', timeout: '5' });
    expect(rev.status().attempts.map((a: any) => a.effort)).toEqual(['xhigh', 'medium']);
  });

  test('H15: the hermetic codex home carries the task identity — a sibling task with the same attempt id cannot collide', () => {
    const sb = mkSandbox();
    step(sb, 'codex', OK_CODEX);
    const out = freshOut(sb, 'task-b');
    const attempt = path.basename(path.dirname(out));
    // what task-a's in-flight invocation with the SAME attempt id would hold under the old <attempt>-inv<n> name
    fs.mkdirSync(path.join(codexBase(sb), `${attempt}-inv1`, 'config.toml'), { recursive: true });
    fs.mkdirSync(path.join(codexBase(sb), `task-a+${attempt}-inv1`, 'config.toml'), { recursive: true });
    const r = run(sb, { lane: 'l3', mode: 'impl', model: 'gpt-6.1-sol', effort: 'low', out });
    expect(r.code).toBe(0);
    expect(path.basename(calls(sb, 'codex')[0].env.CODEX_HOME)).toBe(`task-b+${attempt}-inv1`);
  });

  test('H16: a late probe failure never shortens a newer cooldown, never replaces absent, and a probe quota never overwrites a newer auth event', () => {
    const sb = mkSandbox();
    const future = () => new Date(Date.now() + 60_000).toISOString(); // stamped AFTER the probe began, even under load
    const until = new Date(Date.now() + 3 * 3600e3).toISOString().replace(/\.\d{3}Z$/, 'Z');
    const seed = (j: object) => { const f = path.join(sb.dir, 'seed.json'); fs.writeFileSync(f, JSON.stringify(j)); return f; };
    const probe = () => JSON.parse(lane(sb, ['probe', '--run-dir', sb.run, '--lanes', 'l3', '--json']).out).l3;
    // a task records a 3 h quota while the probe runs; the probe then errors (→ cooling-short)
    const cool = seed({ l3: { status: 'cooling', reason: 'quota (reset parsed from CLI output)', next_probe_at: until, last_event_at: future(), consecutive_quota: 1, throttle_count: 0 } });
    step(sb, 'codex', `cp ${sq(cool)} ${sq(path.join(sb.run, 'lanes.json'))}\nexit 2\n`);
    expect(probe()).toMatchObject({ status: 'cooling', next_probe_at: until, consecutive_quota: 1 });
    // an auth failure lands mid-probe; the probe then errors, or reports quota
    for (const body of ['exit 2\n', codexStep({ fail: "You've hit your usage limit." })]) {
      writeLanes(sb, {});
      const abs = seed({ l3: { status: 'absent', reason: 'auth: 401', next_probe_at: null, last_event_at: future(), consecutive_quota: 0, throttle_count: 0 } });
      step(sb, 'codex', `cp ${sq(abs)} ${sq(path.join(sb.run, 'lanes.json'))}\n${body}`);
      const l3 = probe();
      expect({ status: l3.status, next: l3.next_probe_at }).toEqual({ status: 'absent', next: null });
      expect(l3.reason).toContain('kept');
    }
  }, 30_000);

  test('V2: a late AUTH result never clears a quota cooldown recorded after the attempt began (run and probe)', () => {
    const sb = mkSandbox();
    const until = new Date(Date.now() + 3 * 3600e3).toISOString().replace(/\.\d{3}Z$/, 'Z');
    const seed = path.join(sb.dir, 'seed-cool.json');
    const plant = () => fs.writeFileSync(seed, JSON.stringify({ l3: { status: 'cooling', reason: 'quota (reset parsed from CLI output)', next_probe_at: until,
      last_event_at: new Date(Date.now() + 60_000).toISOString(), consecutive_quota: 1, throttle_count: 0 } }));
    step(sb, 'codex', `cp ${sq(seed)} ${sq(path.join(sb.run, 'lanes.json'))}\n${codexStep({ fail: 'unexpected status 401 Unauthorized' })}`);
    plant();
    const r = run(sb, { lane: 'l3', mode: 'impl', model: 'gpt-6.1-sol', effort: 'low' });
    expect(r.code).toBe(5); // the attempt itself is still class auth …
    expect(lanesOf(sb).l3).toMatchObject({ status: 'cooling', next_probe_at: until, consecutive_quota: 1 }); // … but the newer cooldown stands
    expect(lanesOf(sb).l3.reason).toContain('kept');
    writeLanes(sb, {});
    plant();
    expect(JSON.parse(lane(sb, ['probe', '--run-dir', sb.run, '--lanes', 'l3', '--json']).out).l3).toMatchObject({ status: 'cooling', next_probe_at: until });
  }, 30_000);

  test('H17: SIGTERM mid-invocation still writes a rotated token back and removes the per-invocation codex home', async () => {
    const sb = mkSandbox();
    step(sb, 'codex', `echo '{"tokens":{"access_token":"ROTATED-SIG","account_id":"acct-1"}}' > "$CODEX_HOME/auth.json"\necho $$ > "$STUB_DIR/sig.pid"\nsleep 30\n`);
    const p = spawn(LANE, runArgs(sb, { lane: 'l3', mode: 'impl', model: 'gpt-6.1-sol', effort: 'high', timeout: '30' }).args, { cwd: sb.dir, env: sb.env, stdio: 'ignore' });
    const exited = new Promise<number | null>((resolve) => p.on('exit', (code) => resolve(code)));
    const pidFile = path.join(sb.dir, 'sig.pid');
    const end = Date.now() + 8000;
    while (Date.now() < end && !fs.existsSync(pidFile)) await Bun.sleep(50);
    expect(fs.readdirSync(codexBase(sb))).toHaveLength(1); // the live home
    p.kill('SIGTERM');
    expect(await exited).toBe(143);
    expect(await waitGone([Number(fs.readFileSync(pidFile, 'utf8').trim())])).toEqual([]);
    expect(fs.readdirSync(codexBase(sb))).toEqual([]);
    expect(fs.readFileSync(path.join(sb.home, '.codex', 'auth.json'), 'utf8')).toContain('ROTATED-SIG');
  }, 30_000);

  test('P3: an L2 agent-ENDED run (error_max_turns) quoting "401 … log in" in its own prose is class error, never auth/absent', () => {
    const sb = mkSandbox();
    step(sb, 'claude', `echo '{"type":"result","subtype":"error_max_turns","is_error":true,"result":"I could not log in to the test DB (401 Unauthorized) and hit a rate limit."}'\nexit 1\n`);
    const r = run(sb, { lane: 'l2', mode: 'impl', model: 'claude-sonnet-5-5', effort: 'low', 'claude-dir': sb.claudeDir });
    expect(r.code).toBe(1);
    expect(r.status().class).toBe('error');
    expect(lanesOf(sb).l2.status).toBe('ok');
    step(sb, 'claude', OK_CLAUDE);
    expect(run(sb, { lane: 'l2', mode: 'impl', model: 'claude-sonnet-5-5', effort: 'low', 'claude-dir': sb.claudeDir }).code).toBe(0);
  });
});

describe('fix round 3 (F1–F3, F5, F7)', () => {
  test('F1: a secret introduced ONLY by a merge commit (then deleted) is refused; enumeration is merge-aware', () => {
    const sb = mkSandbox();
    const repo = mkRepo(`merge-${path.basename(sb.dir)}`);
    const base = sh('git', ['rev-parse', 'HEAD'], repo);
    const wt = wtAdd(sb, 'task-m', { repo });
    const branch = sh('git', ['symbolic-ref', '--short', 'HEAD'], wt);
    sh('git', ['checkout', '-q', '-b', `side-${path.basename(sb.dir)}`], wt);
    fs.writeFileSync(path.join(wt, 's.txt'), 's\n'); sh('git', ['add', 's.txt'], wt); sh('git', ['commit', '-q', '-m', 'side'], wt);
    sh('git', ['checkout', '-q', branch], wt);
    fs.writeFileSync(path.join(wt, 'm.txt'), 'm\n'); sh('git', ['add', 'm.txt'], wt); sh('git', ['commit', '-q', '-m', 'main'], wt);
    sh('git', ['merge', '-q', '--no-ff', '--no-commit', `side-${path.basename(sb.dir)}`], wt);
    fs.writeFileSync(path.join(wt, '.env.local'), 'TOKEN=x\n'); sh('git', ['add', '.env.local'], wt);
    sh('git', ['commit', '-q', '-m', 'merge side'], wt);
    const mergeSha = sh('git', ['rev-parse', 'HEAD'], wt);
    sh('git', ['rm', '-q', '.env.local'], wt); sh('git', ['commit', '-q', '-m', 'scrub'], wt);
    const head = sh('git', ['rev-parse', 'HEAD'], wt);
    const r = lane(sb, ['commit', '--run-dir', sb.run, '--task', 'task-m', '--base', base, '-m', 'feat']);
    expect(r.code).toBe(1);
    expect(r.out).toContain(`secret_path=.env.local commit=${mergeSha}`);
    expect(r.out).not.toContain('result_sha=');
    expect(sh('git', ['rev-parse', 'HEAD'], wt)).toBe(head);
  }, 30_000);

  test('F2: a hook added by the task ⇒ refused (control_changed=hooks) and never runs; a pre-existing filter never executes and its paths are refused, not stored raw', () => {
    const sb = mkSandbox();
    const repo = mkRepo(`inert-commit-${path.basename(sb.dir)}`, { 'a.txt': 'a\n', '.gitattributes': '*.txt filter=evil\n' });
    const base = sh('git', ['rev-parse', 'HEAD'], repo);
    const common = sh('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], repo);
    const marker = path.join(sb.dir, 'EXECUTED');
    // A filter configured BEFORE worktree add is part of the recorded fingerprint, but must still never run —
    // not on the checkout that worktree add implies (smudge, H1), not on git add (clean).
    sh('git', ['config', 'filter.evil.clean', `touch ${sq(marker)}; cat`], repo);
    sh('git', ['config', 'filter.evil.smudge', `touch ${sq(marker)}; cat`], repo);
    const wt = wtAdd(sb, 'task-f', { repo });
    fs.writeFileSync(path.join(wt, 'x.txt'), 'raw content\n');
    const filtered = lane(sb, ['commit', '--run-dir', sb.run, '--task', 'task-f', '--base', base, '-m', 'feat']);
    expect(filtered.code).toBe(1); // the pass-through would store x.txt RAW (LFS binary / git-crypt plaintext)
    expect(filtered.out.trim()).toBe('filter_path=x.txt filter=evil');
    expect(fs.existsSync(marker)).toBe(false);
    expect(sh('git', ['diff', '--cached', '--name-only'], wt)).toBe('');
    fs.rmSync(path.join(wt, 'x.txt'));
    fs.writeFileSync(path.join(wt, 'x.md'), 'unfiltered\n');
    const ok = lane(sb, ['commit', '--run-dir', sb.run, '--task', 'task-f', '--base', base, '-m', 'feat']);
    expect(ok.code).toBe(0);
    expect(fs.existsSync(marker)).toBe(false);
    expect(sh('git', ['show', 'HEAD:x.md'], wt)).toBe('unfiltered');
    // The task plants an executable pre-commit hook in the shared git dir.
    fs.writeFileSync(path.join(common, 'hooks', 'pre-commit'), `#!/bin/sh\ntouch ${sq(marker)}\n`, { mode: 0o755 });
    fs.writeFileSync(path.join(wt, 'y.txt'), 'more\n');
    const head = sh('git', ['rev-parse', 'HEAD'], wt);
    const r = lane(sb, ['commit', '--run-dir', sb.run, '--task', 'task-f', '--base', base, '-m', 'feat 2']);
    expect(r.code).toBe(1);
    expect(r.out.trim()).toBe('control_changed=hooks');
    expect(fs.existsSync(marker)).toBe(false);
    expect(sh('git', ['rev-parse', 'HEAD'], wt)).toBe(head);
    expect(sh('git', ['diff', '--cached', '--name-only'], wt)).toBe(''); // nothing was even staged
  }, 30_000);

  test('F3: commit --task requires --base equal to the recorded base, an ancestor of HEAD, and the record itself', () => {
    const sb = mkSandbox();
    const repo = mkRepo(`base-${path.basename(sb.dir)}`);
    const add = lane(sb, ['worktree', 'add', '--run-dir', sb.run, '--task', 'task-z', '--repo', repo]);
    const [wt, baseLine] = add.out.trim().split('\n');
    const base = baseLine.replace('base_sha=', '');
    expect(base).toBe(sh('git', ['rev-parse', 'HEAD'], repo));
    fs.writeFileSync(path.join(wt, 'f.txt'), 'f\n'); sh('git', ['add', 'f.txt'], wt); sh('git', ['commit', '-q', '-m', 'one'], wt);
    const later = sh('git', ['rev-parse', 'HEAD'], wt);
    const c = (extra: string[]) => lane(sb, ['commit', '--run-dir', sb.run, '--task', 'task-z', '-m', 'x', ...extra]);
    expect(c([]).code).toBe(2); // --base missing
    expect(c(['--base', later]).code).toBe(1); // differs from the record (a task rewriting HEAD as "base")
    const side = mkRepo(`base-side-${path.basename(sb.dir)}`, { 'q.txt': 'other\n' });
    expect(c(['--base', sh('git', ['rev-parse', 'HEAD'], side)]).code).toBe(1); // not a commit here / not an ancestor
    fs.writeFileSync(path.join(sb.run, 'wt-meta', 'task-z.base'), `${later}\n`); // record rewritten to HEAD
    const tampered = c(['--base', base]);
    expect(tampered.code).toBe(1);
    expect(tampered.err).toContain('differs from the base recorded');
    fs.rmSync(path.join(sb.run, 'wt-meta', 'task-z.base'));
    const missing = c(['--base', base]);
    expect(missing.code).toBe(1);
    expect(missing.err).toContain('wt-meta missing');
  }, 30_000);

  test('F7: the REAL grok not-signed-in output ⇒ auth (lane absent); structured rate/usage errors map via the classifier', () => {
    const sb = mkSandbox();
    step(sb, 'grok', FIX_GROK_NOAUTH, 1);
    step(sb, 'grok', `echo '{"type":"error","message":"Rate limit exceeded. Please try again later."}'\nexit 1\n`, 2);
    step(sb, 'grok', `echo '{"type":"error","message":"You have reached your usage limit for this period."}'\nexit 1\n`, 3);
    const wt = wtAdd(sb, 'gate-f7', { detach: true });
    const a = run(sb, { lane: 'l4', mode: 'review', model: 'grok-4.7', effort: 'low', cwd: wt });
    expect(a.code).toBe(5);
    expect(a.status().class).toBe('auth');
    expect(a.status().class_detail).toContain('Not signed in');
    expect(lanesOf(sb).l4.status).toBe('absent');
    writeLanes(sb, {});
    expect(run(sb, { lane: 'l4', mode: 'review', model: 'grok-4.7', effort: 'low', cwd: wt }).status().class).toBe('throttle');
    expect(run(sb, { lane: 'l4', mode: 'review', model: 'grok-4.7', effort: 'low', cwd: wt }).status().class).toBe('quota');
  }, 30_000);
});

describe('symlinked hooks (Astra F2/F5 follow-up)', () => {
  test('commit: an edit/chmod inside a symlinked hooks dir or a symlinked core.hooksPath target — or retargeting it — is refused', () => {
    const sb = mkSandbox();
    const repo = mkRepo(`symcommit-${path.basename(sb.dir)}`);
    const base = sh('git', ['rev-parse', 'HEAD'], repo);
    const common = sh('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], repo);
    const hooksTarget = path.join(sb.dir, 'ext-hooks');
    const hpTarget = path.join(sb.dir, 'hp-target');
    const hpOther = path.join(sb.dir, 'hp-other');
    for (const d of [hooksTarget, hpTarget, hpOther]) { fs.mkdirSync(d); fs.writeFileSync(path.join(d, 'pre-commit'), '#!/bin/sh\nexit 0\n', { mode: 0o644 }); }
    fs.rmSync(path.join(common, 'hooks'), { recursive: true, force: true });
    fs.symlinkSync(hooksTarget, path.join(common, 'hooks'));
    const hpLink = path.join(sb.dir, 'hp-link');
    fs.symlinkSync(hpTarget, hpLink);
    sh('git', ['config', 'core.hooksPath', hpLink], repo);
    const wt = wtAdd(sb, 'task-s', { repo });
    const commit = () => lane(sb, ['commit', '--run-dir', sb.run, '--task', 'task-s', '--base', base, '-m', 'feat']);
    fs.writeFileSync(path.join(wt, 'f.txt'), 'f\n');
    fs.chmodSync(path.join(hooksTarget, 'pre-commit'), 0o755);           // chmod inside the symlinked .git/hooks target
    expect(commit().out.trim()).toBe('control_changed=hooks');
    fs.chmodSync(path.join(hooksTarget, 'pre-commit'), 0o644);
    fs.appendFileSync(path.join(hpTarget, 'pre-commit'), 'touch /tmp/x\n'); // content edit inside the symlinked hooksPath target
    expect(commit().out.trim()).toBe('control_changed=hookspath');
    fs.writeFileSync(path.join(hpTarget, 'pre-commit'), '#!/bin/sh\nexit 0\n');
    fs.rmSync(hpLink); fs.symlinkSync(hpOther, hpLink);                  // retarget the hooksPath link
    const r = commit();
    expect(r.code).toBe(1);
    expect(r.out.trim()).toBe('control_changed=hookspath');
    fs.rmSync(hpLink); fs.symlinkSync(hpTarget, hpLink);                 // restored exactly → commit proceeds
    expect(commit().code).toBe(0);
  }, 30_000);
});

describe('invariants across every recorded invocation', () => {
  test('no stub invocation ever received --always-approve; grok never got the prompt text in argv; codex always ran with --json', () => {
    expect(H.checkInvariants()).toBeGreaterThan(10);
  });
});
