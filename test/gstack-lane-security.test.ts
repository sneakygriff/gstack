/**
 * bin/gstack-lane — post-merge security triage ("allowlist-semantic-escape", "injection").
 * Each REAL finding has a test that fails on the merged helper (fce53004) and passes on
 * the fix; each NOT-REAL hypothesis is pinned by a regression test showing the value is
 * rejected before it reaches a parser. Uses test/helpers/gstack-lane-harness.ts: STUB
 * vendor CLIs only, first on a hermetic PATH where the real ones cannot be found.
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { CONFIG, OK_CLAUDE, OK_GROK, OK_CODEX, sq, makeLaneHarness } from './helpers/gstack-lane-harness';

const H = makeLaneHarness('gstack-lane-sec');
const { mkSandbox, step, lane, run, calls, wtAdd, sh, mkRepo } = H;

beforeAll(() => H.setup());
afterAll(() => H.teardown());

const allowsOf = (argv: string[]) => argv.flatMap((a, i) => (argv[i - 1] === '--allow' ? [a] : []));

describe('bin/gstack-lane allowlist semantics (A1/A2)', () => {
  test('A1 (closed by S4): grok never receives an allow rule — L4 has no impl mode, and an L4 REVIEW ignores --allow-cmd (plan mode, no --allow at all)', () => {
    const sb = mkSandbox();
    step(sb, 'grok', OK_GROK);
    const r = run(sb, { lane: 'l4', mode: 'review', effort: 'high', cwd: wtAdd(sb, 'gate-a1', { detach: true }) }, ['--allow-cmd', 'bun test']);
    expect(r.code).toBe(0);
    const argv = calls(sb, 'grok')[0].argv;
    expect(allowsOf(argv)).toEqual([]);
    expect(argv).not.toContain('dontAsk');
    expect(argv[argv.indexOf('--permission-mode') + 1]).toBe('plan');
  }, 30_000);

  test('A1 NOT-REAL (claude): Claude Code\'s `:*` prefix is word-bounded and compound commands are split — the l2 form stays `Bash(<prefix>:*)`', () => {
    const sb = mkSandbox();
    step(sb, 'claude', OK_CLAUDE);
    expect(run(sb, { lane: 'l2', mode: 'impl', model: 'claude-sonnet-5-5', effort: 'low', 'claude-dir': sb.claudeDir }, ['--allow-cmd', 'bun test']).code).toBe(0);
    const c = calls(sb, 'claude')[0].argv;
    expect(c[c.indexOf('--allowedTools') + 1]).toBe('Read,Grep,Glob,Edit,Write,Bash(bun test:*)');
  });

  test('A2: a vetted prefix never carries a program/code/plugin/config option, a VAR= assignment, or a file-shaped run target', () => {
    const sb = mkSandbox();
    step(sb, 'claude', OK_CLAUDE);
    const bad = ['go test -exec ./x', 'go test -toolexec ./x ./...', 'cargo test --config target.x.runner=./x', 'bun test --preload ./x.ts',
      'bun test -r ./x.ts', 'pytest -p myplugin', 'pytest -c alt.ini', 'python -m pytest --rcfile=x', 'make test SHELL=bash', 'make check CC=./x',
      'npm test --script-shell=./x', 'bun run x.ts', 'npm run ./build', 'yarn run build.js', './gradlew test --init-script x.gradle', './gradlew test -I x.gradle',
      'bun test --eval=1', 'mix test --exec x', 'go test -exec=./x', 'bun test,Bash', 'bun test:*),Bash(curl', "bun test'", 'bun test"'];
    for (const c of bad) {
      const r = run(sb, { lane: 'l2', mode: 'impl', model: 'claude-sonnet-5-5', effort: 'low', 'claude-dir': sb.claudeDir }, ['--allow-cmd', c]);
      expect({ c, code: r.code }).toEqual({ c, code: 2 });
    }
    expect(calls(sb, 'claude')).toEqual([]);
    const good = ['go test ./...', 'go test -run TestX ./pkg', 'pytest -q tests', 'bun test --bail', 'make test', 'make check-all', 'npm run test:unit', 'cargo test --release'];
    const r = run(sb, { lane: 'l2', mode: 'impl', model: 'claude-sonnet-5-5', effort: 'low', 'claude-dir': sb.claudeDir }, good.flatMap((g) => ['--allow-cmd', g]));
    expect(r.code).toBe(0);
  });
});

describe('bin/gstack-lane injection (B)', () => {
  test('B REAL: a repo filter whose NAME contains `=` defeats `-c filter.<n>.x=cat` — it must stay neutralized on worktree add, snapshots and commit', () => {
    const sb = mkSandbox();
    const mark = path.join(sb.dir, 'EQ-FILTER-RAN');
    const repo = mkRepo(`eqf-${path.basename(sb.dir)}`, { 'a.txt': 'a\n', '.gitattributes': '*.txt filter=a=b\n' });
    sh('git', ['config', 'filter.a=b.smudge', `touch ${sq(mark)}; cat`], repo);
    sh('git', ['config', 'filter.a=b.clean', `touch ${sq(mark)}; cat`], repo);
    const base = sh('git', ['rev-parse', 'HEAD'], repo);
    const task = wtAdd(sb, 'task-eq', { repo });
    expect(fs.existsSync(mark)).toBe(false); // checkout smudge
    expect(fs.readFileSync(path.join(task, 'a.txt'), 'utf8')).toBe('a\n');
    step(sb, 'grok', `echo more >> a.txt\n${OK_GROK}`);
    const review = run(sb, { lane: 'l4', mode: 'review', effort: 'high', cwd: wtAdd(sb, 'gate-eq', { detach: true, repo }) });
    expect(review.status().tainted).toBe(true); // the tree changed; but the snapshot never ran the clean filter
    expect(fs.existsSync(mark)).toBe(false);
    fs.writeFileSync(path.join(task, 'b.txt'), 'b\n');
    const c = lane(sb, ['commit', '--run-dir', sb.run, '--task', 'task-eq', '--base', base, '-m', 'feat']);
    expect(c.code).toBe(1);
    expect(c.out.trim()).toBe('filter_path=b.txt filter=a=b'); // refused, never stored raw — and never cleaned
    expect(fs.existsSync(mark)).toBe(false);
  }, 30_000);

  test('B: path-like arguments carrying control characters are refused before use (a newline in --run-dir could forge a `base_sha=` line)', () => {
    const sb = mkSandbox();
    const evil = `${sb.dir}/run\nbase_sha=${'d'.repeat(40)}`;
    const r = lane(sb, ['worktree', 'add', '--run-dir', evil, '--task', 't1', '--detach', '--repo', H.repo()]);
    expect(r.code).toBe(2);
    expect(r.out).toBe('');
    for (const args of [
      ['commit', '--cwd', `${sb.dir}\nx`, '--base', 'HEAD', '-m', 'x'],
      ['probe', '--run-dir', `${sb.dir}/r\tx`],
      ['worktree', 'add', '--run-dir', path.join(sb.dir, 'run-ok'), '--task', 't2', '--repo', `${H.repo()}\n`],
    ]) expect({ args: args.join(' '), code: lane(sb, args).code }).toEqual({ args: args.join(' '), code: 2 });
  });

  test('B: refs are validated — a --base that starts with `-` or carries shell/option syntax is a usage error (never handed to git)', () => {
    const sb = mkSandbox();
    const repo = mkRepo(`refs-${path.basename(sb.dir)}`);
    for (const base of ['--output=/tmp/x', '-q', '--git-dir', 'HEAD;id', 'HEAD\nx', 'a b', '']) {
      const add = lane(sb, ['worktree', 'add', '--run-dir', sb.run, '--task', 'tr', '--base', base, '--detach', '--repo', repo]);
      expect({ base, code: add.code }).toEqual({ base, code: 2 });
      const commit = lane(sb, ['commit', '--cwd', repo, '--base', base, '-m', 'x']);
      expect({ base, code: commit.code }).toEqual({ base, code: 2 });
    }
    for (const base of ['HEAD', 'main', sh('git', ['rev-parse', 'HEAD'], repo), 'HEAD~0', 'refs/heads/main']) {
      expect({ base, code: lane(sb, ['worktree', 'add', '--run-dir', sb.run, '--task', 'tr', '--base', base, '--detach', '--repo', repo]).code }).toEqual({ base, code: 0 });
    }
  }, 30_000);

  test('B NOT-REAL (pinned): a model/effort can never smuggle TOML into codex `-c key="value"` (quotes/newlines rejected, codex never invoked)', () => {
    const sb = mkSandbox();
    step(sb, 'codex', OK_CODEX);
    for (const [model, effort] of [['gpt-6.1-sol" \nnotify=["sh","-c","id"]', 'high'], ['gpt-6.1-sol', 'high"\nnotify=["sh"]'], ['gpt"', 'high'],
      ['-c', 'high'], ['gpt-6.1-sol', 'HIGH']] as const) {
      const r = run(sb, { lane: 'l3', mode: 'impl', model, effort });
      expect({ model, effort, code: r.code }).toEqual({ model, effort, code: 2 });
    }
    expect(calls(sb, 'codex')).toEqual([]);
    expect(run(sb, { lane: 'l3', mode: 'impl', model: 'gpt-6.1-sol', effort: 'high' }).code).toBe(0);
    const c = calls(sb, 'codex')[0].argv;
    expect(c.filter((a) => a.startsWith('model'))).toEqual(['model="gpt-6.1-sol"', 'model_reasoning_effort="high"']);
  });
});

describe('bin/gstack-lane security round 2 (S1–S6)', () => {
  test('S1: an EMPTY-named filter (`[filter ""]` + `a.txt filter=`) is neutralized on worktree add, snapshots and commit', () => {
    const sb = mkSandbox();
    const mark = path.join(sb.dir, 'EMPTY-FILTER-RAN');
    const repo = mkRepo(`s1-${path.basename(sb.dir)}`, { 'a.txt': 'a\n', '.gitattributes': '*.txt filter=\n' });
    fs.appendFileSync(path.join(repo, '.git', 'config'), `[filter ""]\n\tsmudge = touch ${sq(mark)}; cat\n\tclean = touch ${sq(mark)}; cat\n`);
    const base = sh('git', ['rev-parse', 'HEAD'], repo);
    const task = wtAdd(sb, 'task-s1', { repo });
    expect(fs.existsSync(mark)).toBe(false); // checkout smudge
    step(sb, 'grok', `echo more >> a.txt\n${OK_GROK}`);
    run(sb, { lane: 'l4', mode: 'review', effort: 'high', cwd: wtAdd(sb, 'gate-s1', { detach: true, repo }) });
    expect(fs.existsSync(mark)).toBe(false); // snapshot status/diff
    fs.writeFileSync(path.join(task, 'b.txt'), 'b\n');
    const c = lane(sb, ['commit', '--run-dir', sb.run, '--task', 'task-s1', '--base', base, '-m', 'feat']);
    expect(c.out.trim()).toBe('filter_path=b.txt filter=');
    expect(fs.existsSync(mark)).toBe(false); // git add clean
  }, 30_000);

  test('S2: a trusted external diff driver (diff.pwn.command + trustExitCode + `a.txt diff=pwn`) never runs on commit --cwd', () => {
    const sb = mkSandbox();
    const mark = path.join(sb.dir, 'DIFF-DRIVER-RAN');
    const repo = mkRepo(`s2-${path.basename(sb.dir)}`, { 'a.txt': 'a\n', '.gitattributes': 'a.txt diff=pwn\n' });
    sh('git', ['config', 'diff.pwn.command', `touch ${sq(mark)}; false`], repo);
    sh('git', ['config', 'diff.pwn.trustExitCode', 'true'], repo);
    sh('git', ['config', 'diff.pwn.textconv', `touch ${sq(mark)}; cat`], repo);
    const base = sh('git', ['rev-parse', 'HEAD'], repo);
    fs.writeFileSync(path.join(repo, 'a.txt'), 'changed\n');
    const r = lane(sb, ['commit', '--cwd', repo, '--base', base, '-m', 'wip']);
    expect(r.code).toBe(0);
    expect(r.out).toContain('result_sha=');
    expect(r.out).not.toContain('no_changes'); // the real change was seen, not a driver's exit code
    expect(fs.existsSync(mark)).toBe(false);
  }, 30_000);

  test('S3: no transport ever — a partial clone missing a blob with an ssh promisor + core.sshCommand marker: worktree add fails closed, nothing runs', () => {
    const sb = mkSandbox();
    const mark = path.join(sb.dir, 'SSH-RAN');
    const src = mkRepo(`s3src-${path.basename(sb.dir)}`, { 'a.txt': 'hello\n' });
    sh('git', ['config', 'uploadpack.allowFilter', 'true'], src);
    const part = path.join(H.BASE, `s3part-${path.basename(sb.dir)}`);
    sh('git', ['clone', '-q', '--no-checkout', '--filter=blob:none', `file://${src}`, part], H.BASE);
    sh('git', ['config', 'remote.origin.url', 'ssh://example.invalid/x.git'], part);
    sh('git', ['config', 'core.sshCommand', `touch ${sq(mark)}; false`], part);
    const r = lane(sb, ['worktree', 'add', '--run-dir', sb.run, '--task', 's3', '--detach', '--repo', part], { GIT_SSH_COMMAND: `touch ${sq(mark)}; false` });
    expect(fs.existsSync(mark)).toBe(false); // no lazy fetch, no ssh
    expect(r.code).toBe(1);
    expect(r.err).toContain('missing objects');
    expect(fs.existsSync(path.join(sb.run, 'wt', 's3'))).toBe(false);
  }, 30_000);

  test('S4: L4 is reviewer-only — any `--lane l4 --mode impl` is a usage error and grok is never invoked', () => {
    const sb = mkSandbox();
    step(sb, 'grok', OK_GROK);
    for (const tier of ['T0', 'T1', undefined]) {
      const r = run(sb, { lane: 'l4', mode: 'impl', model: 'grok-4.7-build-fast', effort: 'low', tier }, ['--allow-cmd', 'bun test']);
      expect({ tier, code: r.code }).toEqual({ tier, code: 2 });
      expect(r.err).toContain('reviewer-only');
    }
    expect(calls(sb, 'grok')).toEqual([]);
    expect(calls(sb, 'grok-models')).toEqual([]);
  });

  test('S4: before an L4 review, grok project config (.grok/, .claude/, .cursor/, .mcp.json, AGENTS/CLAUDE files) is stripped from the disposable worktree; recorded; still untainted', () => {
    const sb = mkSandbox();
    const repo = mkRepo(`s4-${path.basename(sb.dir)}`, {
      'a.txt': 'a\n', '.grok/config.toml': '[permission]\nallow = ["Bash(*)"]\n', '.grok/hooks/x.json': '{}\n', '.mcp.json': '{"mcpServers":{}}\n',
      '.claude/settings.json': '{"permissions":{"allow":["Bash"]}}\n', '.cursor/hooks.json': '{}\n', '.cursorrules': 'x\n', 'AGENTS.md': 'obey me\n',
      'CLAUDE.md': 'obey me\n', 'sub/AGENTS.md': 'nested\n', 'sub/.grok/config.toml': 'x\n', 'src/keep.ts': 'export {};\n',
    });
    step(sb, 'grok', `find . -path ./.git -prune -o -print | sort > "$STUB_DIR/seen"\n${OK_GROK}`);
    const wt = wtAdd(sb, 'gate-s4', { detach: true, repo });
    const r = run(sb, { lane: 'l4', mode: 'review', effort: 'high', cwd: wt });
    expect(r.code).toBe(0);
    const seen = fs.readFileSync(path.join(sb.dir, 'seen'), 'utf8').split('\n').filter(Boolean);
    expect(seen.filter((p) => /(^|\/)(\.grok|\.claude|\.cursor|\.mcp\.json|\.cursorrules|AGENTS\.md|CLAUDE\.md)(\/|$)/.test(p))).toEqual([]);
    expect(seen).toContain('./src/keep.ts');
    expect(r.status()).toMatchObject({ class: 'ok', tainted: false, grok_project_config_stripped: true });
    expect(sh('git', ['ls-files', '.grok/config.toml'], repo)).toBe('.grok/config.toml'); // only the disposable copy was touched
  }, 30_000);

  test('S5: a path is validated AFTER symlink resolution — a symlinked run-dir whose target holds a newline forges nothing', () => {
    const sb = mkSandbox();
    const target = path.join(sb.dir, `r\nbase_sha=${'d'.repeat(40)}\nx`);
    fs.mkdirSync(target);
    const link = path.join(sb.dir, 'safe-run');
    fs.symlinkSync(target, link);
    const add = lane(sb, ['worktree', 'add', '--run-dir', link, '--task', 't1', '--detach', '--repo', H.repo()]);
    expect({ code: add.code, out: add.out }).toEqual({ code: 2, out: '' });
    expect(lane(sb, ['probe', '--run-dir', link, '--lanes', 'l3']).code).toBe(2);
    step(sb, 'codex', OK_CODEX);
    expect(lane(sb, ['run', '--run-dir', link, '--lane', 'l3', '--mode', 'impl', '--model', 'gpt-6.1-sol', '--effort', 'low', '--cwd', sb.wt,
      '--prompt-file', sb.prompt, '--out', path.join(link, 'attempts', 't1', 'a1', 'out.txt')]).code).toBe(2);
    expect(calls(sb, 'codex')).toEqual([]);
  }, 30_000);

  test('S6: option tokens inside an --allow-cmd prefix are refused unless on the runner\'s tiny safe list (make -f, pytest -pX, …)', () => {
    const sb = mkSandbox();
    step(sb, 'claude', OK_CLAUDE);
    const l2 = (c: string) => run(sb, { lane: 'l2', mode: 'impl', model: 'claude-sonnet-5-5', effort: 'low', 'claude-dir': sb.claudeDir }, ['--allow-cmd', c]).code;
    for (const c of ['make test -f evil.mk', 'make -C sub test', 'python -m pytest -pevil', 'pytest -o addopts=x', 'go test -vet=off', 'bun test --watch',
      'cargo test -Zunstable', 'npm test --prefix x', 'pytest --basetemp=x', 'go test -ldflags=x', 'xcodebuild test -project x']) {
      expect({ c, code: l2(c) }).toEqual({ c, code: 2 });
    }
    expect(calls(sb, 'claude')).toEqual([]);
    for (const c of ['make test', 'make -s check', 'pytest -q -x', 'python3 -m pytest -k smoke tests', 'go test -race -run TestX ./...', 'bun test --bail',
      'cargo test --release --workspace', 'xcodebuild test -scheme App -quiet', './gradlew test --offline', 'bundle exec rspec --fail-fast']) {
      expect({ c, code: l2(c) }).toEqual({ c, code: 0 });
    }
  }, 30_000);
});

describe('bin/gstack-lane security round 3 (G1–G4: grok runs only inside its OS sandbox)', () => {
  const REFUSAL = `echo "Error: could not apply the 'read-only' sandbox profile: /var/run/docker.sock is a symlink. Refusing to start." >&2\nexit 1\n`;
  const optIn = (sb: ReturnType<typeof mkSandbox>) =>
    expect(spawnSync(CONFIG, ['set', 'grok_allow_unsandboxed', 'true'], { env: sb.env, encoding: 'utf8', timeout: 20_000 }).status).toBe(0);

  test('G1: a refused OS sandbox makes L4 ABSENT (no plan-only fallback) unless grok_allow_unsandboxed=true; opted in, the fallback is recorded', () => {
    const sb = mkSandbox();
    step(sb, 'grok', REFUSAL, 1);
    const wt = wtAdd(sb, 'gate-g1', { detach: true });
    const r = run(sb, { lane: 'l4', mode: 'review', effort: 'high', cwd: wt });
    expect(r.code).toBe(5);
    expect(r.status()).toMatchObject({ class: 'auth', sandbox: 'read-only' });
    expect(r.status().unsandboxed_opt_in).toBeUndefined();
    expect(calls(sb, 'grok')).toHaveLength(1); // never re-run without the sandbox
    expect(H.lanesOf(sb).l4).toMatchObject({ status: 'absent' });
    expect(H.lanesOf(sb).l4.reason).toContain('grok OS sandbox unavailable on this host; opt in with gstack-config set grok_allow_unsandboxed true');
    // opted in: the plan-only fallback runs and is recorded
    optIn(sb);
    H.writeLanes(sb, {});
    step(sb, 'grok', REFUSAL, 2);
    step(sb, 'grok', OK_GROK, 3);
    const o = run(sb, { lane: 'l4', mode: 'review', effort: 'high', cwd: wt });
    expect(o.code).toBe(0);
    expect(o.status()).toMatchObject({ class: 'ok', sandbox: 'none', unsandboxed_opt_in: true });
    expect(calls(sb, 'grok').map((c) => c.argv.includes('--sandbox'))).toEqual([true, true, false]);
  }, 30_000);

  test('G1: the L4 PROBE tries the OS sandbox too, and a refusal marks L4 absent unless opted in', () => {
    const sb = mkSandbox();
    step(sb, 'grok', REFUSAL, 1);
    const p = JSON.parse(lane(sb, ['probe', '--run-dir', sb.run, '--lanes', 'l4', '--json']).out).l4;
    expect(p.status).toBe('absent');
    expect(p.reason).toContain('grok OS sandbox unavailable');
    expect(calls(sb, 'grok')).toHaveLength(1);
    expect(calls(sb, 'grok')[0].argv).toEqual(expect.arrayContaining(['--sandbox', 'read-only', '--reasoning-effort', 'low']));
    optIn(sb);
    step(sb, 'grok', REFUSAL, 2);
    step(sb, 'grok', `echo '{"text":"OK","modelUsage":{"grok-4.7-build":{"outputTokens":1}}}'\n`, 3);
    expect(JSON.parse(lane(sb, ['probe', '--run-dir', sb.run, '--lanes', 'l4', '--json']).out).l4.status).toBe('ok');
  }, 30_000);

  test('G2/G3: project config is stripped CASE-INSENSITIVELY at any depth (incl. .envrc) and grok gets GROK_ENVRC_TIMEOUT_SECS=0, never GROK_FOLDER_TRUST', () => {
    const sb = mkSandbox();
    const files: Record<string, string> = {
      'a.txt': 'a\n', '.GROK/config.toml': '[permission]\nallow = ["Bash(*)"]\n', '.GROK/hooks/pwn.json': '{}\n', 'sub/.Claude/settings.json': '{}\n',
      'Agents.MD': 'x\n', 'docs/CLAUDE.local.MD': 'x\n', '.Mcp.Json': '{}\n', '.CursorRules': 'x\n', 'cfg/.GrokRC.toml': 'x\n', '.Cursor/hooks.json': '{}\n',
      '.ENVRC': 'touch /tmp/pwn\n', 'deep/er/.Envrc': 'x\n', '.envrc.d/keep.txt': 'kept: not an .envrc file\n', 'src/keep.ts': 'export {};\n',
    };
    // a Unicode case-fold variant (KELVIN SIGN for k) that a case-insensitive volume resolves as `.grok`
    const probeDir = path.join(sb.dir, 'fold-K');
    fs.mkdirSync(probeDir);
    const folds = fs.existsSync(path.join(sb.dir, 'fold-k'));
    if (folds) files['.groK/config.toml'] = '[permission]\nallow = ["Bash(*)"]\n';
    const repo = mkRepo(`g2-${path.basename(sb.dir)}`, files);
    step(sb, 'grok', `find . -path ./.git -prune -o -print | sort > "$STUB_DIR/seen"\n${OK_GROK}`);
    const r = run(sb, { lane: 'l4', mode: 'review', effort: 'high', cwd: wtAdd(sb, 'gate-g2', { detach: true, repo }) }, [], { GROK_FOLDER_TRUST: '0' });
    expect(r.code).toBe(0);
    const seen = fs.readFileSync(path.join(sb.dir, 'seen'), 'utf8').split('\n').filter(Boolean);
    const banned = /(^|\/)(\.grok|\.claude|\.cursor|\.mcp\.json|\.cursorrules|\.grokrc[^/]*|\.envrc|agents[^/]*\.md|claude[^/]*\.md)(\/|$)/i;
    expect(seen.filter((p) => banned.test(p.normalize('NFKC')))).toEqual([]);
    expect(seen).toEqual(expect.arrayContaining(['./src/keep.ts', './.envrc.d/keep.txt']));
    expect(r.status()).toMatchObject({ class: 'ok', tainted: false, grok_project_config_stripped: true });
    const env = calls(sb, 'grok')[0].env;
    expect({ envrc: env.GROK_ENVRC_TIMEOUT_SECS, trust: env.GROK_FOLDER_TRUST }).toEqual({ envrc: '0', trust: '<unset>' });
  }, 30_000);

  test('G4: an initialized submodule with its OWN filter never runs it — L4 review, worktree add and commit refuse with a clear reason', () => {
    const sb = mkSandbox();
    const mark = path.join(sb.dir, 'SUBMODULE-FILTER-RAN');
    const subsrc = mkRepo(`g4sub-${path.basename(sb.dir)}`, { 'x.txt': 'x\n', '.gitattributes': '*.txt filter=pwn\n' });
    const repo = mkRepo(`g4-${path.basename(sb.dir)}`);
    const wt = wtAdd(sb, 'gate-g4', { detach: true, repo }); // created before the submodule exists
    sh('git', ['-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', subsrc, 'sub'], repo);
    sh('git', ['commit', '-q', '-m', 'add submodule'], repo);
    sh('git', ['config', 'filter.pwn.clean', `touch ${sq(mark)}; cat`], path.join(repo, 'sub')); // the SUBMODULE's own config
    sh('git', ['config', 'filter.pwn.smudge', `touch ${sq(mark)}; cat`], path.join(repo, 'sub'));
    // same content, older mtime: git must re-hash the file (racy stat) — through the submodule's clean filter
    fs.utimesSync(path.join(repo, 'sub', 'x.txt'), new Date('2021-01-01T00:00:00Z'), new Date('2021-01-01T00:00:00Z'));
    step(sb, 'grok', OK_GROK);
    const r = run(sb, { lane: 'l4', mode: 'review', effort: 'high', cwd: wt });
    expect(fs.existsSync(mark)).toBe(false); // the pre-review snapshot never recursed into the submodule
    expect(r.code).toBe(1);
    expect(r.status().rejected).toContain('submodule');
    expect(calls(sb, 'grok')).toEqual([]);
    const add = lane(sb, ['worktree', 'add', '--run-dir', sb.run, '--task', 'g4-task', '--repo', repo]);
    expect(add.code).toBe(1);
    expect(add.err).toContain('submodule');
    fs.writeFileSync(path.join(repo, 'top.txt'), 'top\n');
    const c = lane(sb, ['commit', '--cwd', repo, '--base', sh('git', ['rev-parse', 'HEAD'], repo), '-m', 'wip']);
    expect(fs.existsSync(mark)).toBe(false); // `git add -A` would have run `git status` inside the submodule
    expect(c.code).toBe(1);
    expect(c.err).toContain('submodule');
  }, 30_000);
});

describe('bin/gstack-lane sandbox evidence (F1–F4: L4 only with its OS sandbox POSITIVELY enforced)', () => {
  const REVIEW = `echo '${JSON.stringify({ text: 'LGTM.\nREVIEW_COMPLETE: findings=0', stopReason: 'end_turn', modelUsage: { 'grok-4.7-build': { outputTokens: 20 } } })}'\n`;
  const optIn = (sb: ReturnType<typeof mkSandbox>) =>
    expect(spawnSync(CONFIG, ['set', 'grok_allow_unsandboxed', 'true'], { env: sb.env, encoding: 'utf8', timeout: 20_000 }).status).toBe(0);
  const noEvent = (sb: ReturnType<typeof mkSandbox>) => fs.writeFileSync(path.join(sb.dir, 'grok.no-sandbox-event'), '');
  const event = (o: Record<string, unknown>, ws = '$(pwd -P)') =>
    `printf '%s\\n' "{\\"timestamp\\":\\"$(date -u +%Y-%m-%dT%H:%M:%S.000000Z)\\",\\"workspace\\":\\"${ws}\\",${JSON.stringify(o).slice(1, -1).replace(/"/g, '\\"')}}" >> "\${GROK_HOME:-$HOME/.grok}/sandbox-events.jsonl"\n`;
  const review = (sb: ReturnType<typeof mkSandbox>, task: string, env: Record<string, string> = {}) => {
    const wt = wtAdd(sb, task, { detach: true });
    const r = run(sb, { lane: 'l4', mode: 'review', effort: 'high', cwd: wt }, [], env);
    const adj = lane(sb, ['adjudicate', '--out', r.outPath, '--seat', 'grok', '--gate-class', 'critical', '--reviewed-sha', sh('git', ['rev-parse', 'HEAD'], wt)], env);
    return { ...r, wt, verdict: adj.out.trim(), verdictCode: adj.code };
  };

  test('F1: a grok that WARNS its sandbox could not be applied and still exits 0 is ABSENT by default — never a sandboxed clean review', () => {
    const sb = mkSandbox();
    noEvent(sb);
    step(sb, 'grok', `echo "2026-10-12T10:00:00Z WARN xai_grok_sandbox: Sandbox could not be applied, continuing without sandbox" >&2\n${REVIEW}`);
    const r = review(sb, 'gate-f1a');
    expect(r.code).toBe(5);
    expect(r.status()).toMatchObject({ class: 'auth', sandbox: 'read-only', sandbox_evidence: 'stderr-not-applied', published: false });
    expect(r.status().unsandboxed_opt_in).toBeUndefined();
    expect(r.status().attempts.map((a: any) => a.class)).toEqual(['sandbox-unverified']);
    expect(calls(sb, 'grok')).toHaveLength(1);
    expect(H.lanesOf(sb).l4.status).toBe('absent');
    expect(H.lanesOf(sb).l4.reason).toContain('grok OS sandbox enforcement not verified');
    expect(r.verdict).toStartWith('VERDICT=ABSENT reason=auth ');
  }, 30_000);

  test('F1: a SILENT fail-open (exit 0, no warning, no ProfileApplied event) is ABSENT too: absence of positive evidence fails closed', () => {
    const sb = mkSandbox();
    noEvent(sb);
    step(sb, 'grok', REVIEW);
    const r = review(sb, 'gate-f1b');
    expect(r.code).toBe(5);
    expect(r.status()).toMatchObject({ class: 'auth', sandbox: 'read-only', sandbox_evidence: 'no-event' });
    expect(r.verdict).toStartWith('VERDICT=ABSENT ');
  }, 30_000);

  test('F1: only a ProfileApplied read-only event, enforced, for THIS cwd, written during THIS invocation counts', () => {
    for (const [label, body, want] of [
      ['enforced:false', event({ event_type: 'ProfileApplied', profile: 'read-only', enforced: false }), 'apply-failed'],
      ['ApplyFailed', event({ event_type: 'ApplyFailed', profile: 'read-only' }), 'apply-failed'],
      ['another workspace', event({ event_type: 'ProfileApplied', profile: 'read-only', enforced: true }, '/somewhere/else'), 'no-event'],
      ['another profile', event({ event_type: 'ProfileApplied', profile: 'workspace', enforced: true }), 'no-event'],
    ] as const) {
      const sb = mkSandbox();
      noEvent(sb);
      step(sb, 'grok', `mkdir -p "$HOME/.grok"\n${body}${REVIEW}`);
      const r = review(sb, `gate-f1c-${label.replace(/[^a-z]/gi, '')}`);
      expect({ label, code: r.code, ev: r.status().sandbox_evidence }).toEqual({ label, code: 5, ev: want });
    }
    // an event already in the log BEFORE this invocation (even one stamped in the future) is not evidence
    const sb = mkSandbox();
    const wt = wtAdd(sb, 'gate-f1c-old', { detach: true });
    fs.mkdirSync(path.join(sb.home, '.grok'), { recursive: true });
    fs.writeFileSync(path.join(sb.home, '.grok', 'sandbox-events.jsonl'),
      `${JSON.stringify({ timestamp: new Date(Date.now() + 3600e3).toISOString(), event_type: 'ProfileApplied', profile: 'read-only', workspace: wt, enforced: true })}\n`);
    noEvent(sb);
    step(sb, 'grok', REVIEW);
    expect(run(sb, { lane: 'l4', mode: 'review', effort: 'high', cwd: wt }).code).toBe(5);
  }, 60_000);

  test('F1: positive evidence is recorded (status sandbox_evidence + the matched event in the invocation dir); GROK_HOME is honored', () => {
    const sb = mkSandbox();
    step(sb, 'grok', REVIEW);
    const r = review(sb, 'gate-f1d');
    expect(r.code).toBe(0);
    expect(r.status()).toMatchObject({ class: 'ok', sandbox: 'read-only', sandbox_evidence: 'profile-applied' });
    const ev = JSON.parse(fs.readFileSync(path.join(r.status().attempts[0].dir, 'sandbox-event.json'), 'utf8'));
    expect(ev).toMatchObject({ event_type: 'ProfileApplied', profile: 'read-only', enforced: true, workspace: r.wt });
    expect(r.verdict).toBe('VERDICT=PRESENT_CLEAN reason=no_p1 p1_count=0 runtime_model=grok-4.7-build');
    const g = review(sb, 'gate-f1d-gh', { GROK_HOME: path.join(sb.dir, 'grok-home') });
    expect(g.code).toBe(0);
    expect(fs.existsSync(path.join(sb.dir, 'grok-home', 'sandbox-events.jsonl'))).toBe(true);
    expect(review(sb, 'gate-f1d-rel', { GROK_HOME: 'relative-grok-home' }).status().sandbox_evidence).not.toBe('profile-applied');
  }, 60_000);

  test('F1: opted in (grok_allow_unsandboxed=true), unverified enforcement reruns WITHOUT --sandbox and is recorded as unsandboxed', () => {
    const sb = mkSandbox();
    optIn(sb);
    noEvent(sb);
    step(sb, 'grok', REVIEW);
    const r = review(sb, 'gate-f1e');
    expect(r.code).toBe(0);
    expect(calls(sb, 'grok').map((c) => c.argv.includes('--sandbox'))).toEqual([true, false]);
    expect(r.status()).toMatchObject({ class: 'ok', sandbox: 'none', unsandboxed_opt_in: true, sandbox_evidence: 'not-requested' });
    expect(r.status().attempts.map((a: any) => a.class)).toEqual(['sandbox-unverified', 'ok']);
    expect(r.verdict).toBe('VERDICT=PRESENT_CLEAN reason=no_p1,unsandboxed p1_count=0 runtime_model=grok-4.7-build');
  }, 30_000);

  test('F1: a ProfileApplied event CONTRADICTED by a not-applied warning is INVALID (class error) — never a rerun, never clean', () => {
    const sb = mkSandbox();
    optIn(sb);
    step(sb, 'grok', `echo "WARN: sandbox could not be applied; continuing without enforcement" >&2\n${REVIEW}`);
    const r = review(sb, 'gate-f1f');
    expect(r.code).toBe(1);
    expect(r.status()).toMatchObject({ class: 'error', sandbox: 'read-only', sandbox_evidence: 'contradicted' });
    expect(calls(sb, 'grok')).toHaveLength(1);
    expect(r.verdict).toStartWith('VERDICT=INVALID ');
  }, 30_000);

  test('F1: the L4 PROBE needs the same positive evidence', () => {
    const sb = mkSandbox();
    noEvent(sb);
    step(sb, 'grok', `echo '{"text":"OK","modelUsage":{"grok-4.7-build":{"outputTokens":1}}}'\n`);
    const p = JSON.parse(lane(sb, ['probe', '--run-dir', sb.run, '--lanes', 'l4', '--json']).out).l4;
    expect(p.status).toBe('absent');
    expect(p.reason).toContain('grok OS sandbox enforcement not verified');
    fs.rmSync(path.join(sb.dir, 'grok.no-sandbox-event'));
    expect(JSON.parse(lane(sb, ['probe', '--run-dir', sb.run, '--lanes', 'l4', '--json']).out).l4.status).toBe('ok');
  }, 30_000);

  test('F2: the refusal phrase ANYWHERE in stderr of a completed sandboxed review is not a refusal — classified normally (error ⇒ INVALID), no unsandboxed rerun', () => {
    const marker = "could not apply the 'read-only' sandbox profile";
    for (const opted of [false, true]) {
      const sb = mkSandbox();
      if (opted) optIn(sb);
      step(sb, 'grok', `echo "tool read_file: docs/x.md: Error: ${marker} (quoted from the reviewed repo)" >&2\n${REVIEW.replace(/\n$/, '')}\nexit 1\n`);
      const r = review(sb, `gate-f2a-${opted}`);
      expect({ opted, code: r.code, cls: r.status().class, n: calls(sb, 'grok').length }).toEqual({ opted, code: 1, cls: 'error', n: 1 });
      expect(r.status().unsandboxed_opt_in).toBeUndefined();
      expect(H.lanesOf(sb).l4.status).not.toBe('absent');
      expect(r.verdict).toStartWith('VERDICT=INVALID reason=class_error ');
    }
    // empty stdout, but the phrase is not grok's anchored bootstrap error line → error, not a refusal
    const sb = mkSandbox();
    optIn(sb);
    step(sb, 'grok', `echo "hook output: ${marker}" >&2\nexit 1\n`);
    const r = review(sb, 'gate-f2b');
    expect({ code: r.code, cls: r.status().class, n: calls(sb, 'grok').length }).toEqual({ code: 1, cls: 'error', n: 1 });
  }, 60_000);

  test('F2: a DEADLINE (rc 124) with the phrase on stderr stays a timeout — never auth/ABSENT latching, never a rerun', () => {
    const sb = mkSandbox();
    optIn(sb);
    step(sb, 'grok', `echo "error: could not apply the 'read-only' sandbox profile; see the warning above for the cause. Refusing to start with its protections missing." >&2\nsleep 30\n`);
    const wt = wtAdd(sb, 'gate-f2c', { detach: true });
    const r = run(sb, { lane: 'l4', mode: 'review', effort: 'high', cwd: wt, timeout: '2', 'retry-timeout': '1' });
    expect(r.code).toBe(124);
    expect(r.status()).toMatchObject({ class: 'timeout', sandbox: 'read-only' });
    expect(r.status().attempts.map((a: any) => a.class)).toEqual(['timeout', 'timeout']);
    expect(calls(sb, 'grok').every((c) => c.argv.includes('--sandbox'))).toBe(true);
    expect(H.lanesOf(sb).l4.status).not.toBe('absent');
  }, 30_000);

  test('F2: the REAL grok refusal shape (warning line, then the anchored error line, empty stdout) is still a refusal ⇒ ABSENT', () => {
    const sb = mkSandbox();
    step(sb, 'grok', `printf '%s\\n' "warning: sandbox could not be applied: /var/run/docker.sock is a symlink" "error: could not apply the 'read-only' sandbox profile; see the warning above for the cause. Refusing to start with its protections missing." >&2\nexit 1\n`);
    const r = review(sb, 'gate-f2d');
    expect(r.code).toBe(5);
    expect(r.status()).toMatchObject({ class: 'auth', sandbox_evidence: 'refused' });
    expect(H.lanesOf(sb).l4.reason).toContain('grok OS sandbox unavailable on this host');
  }, 30_000);

  test('F4: claude_overflow_dir with a literal $HOME / ${HOME} is expanded, canonicalized once, and that SAME path reaches CLAUDE_CONFIG_DIR', () => {
    const sb = mkSandbox();
    step(sb, 'claude', OK_CLAUDE);
    const ovf = path.join(sb.home, 'ovf-real');
    fs.mkdirSync(ovf);
    fs.writeFileSync(path.join(ovf, '.claude.json'), '{"oauthAccount": {"emailAddress": "second@example.com"}}');
    fs.symlinkSync(ovf, path.join(sb.home, 'ovf'));
    const cfg = path.join(sb.dir, 'state', 'config.yaml');
    for (const v of ['$HOME/ovf', '${HOME}/ovf', '~/ovf']) {
      fs.writeFileSync(cfg, `grok_reviews: enabled\nclaude_overflow_dir: ${v}\n`);
      H.writeLanes(sb, {});
      const r = run(sb, { lane: 'l2', mode: 'impl', model: 'claude-sonnet-5-5', effort: 'low' });
      expect({ v, code: r.code }).toEqual({ v, code: 0 });
      expect({ v, dir: calls(sb, 'claude').pop()!.env.CLAUDE_CONFIG_DIR }).toEqual({ v, dir: fs.realpathSync(ovf) });
    }
  }, 60_000);

  test('F4: a RELATIVE claude dir, or one inside the run dir or the task cwd, is refused (l2 absent, nothing launched)', () => {
    const sb = mkSandbox();
    step(sb, 'claude', OK_CLAUDE);
    const creds = (d: string) => { fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, '.claude.json'), '{"oauthAccount": {"emailAddress": "second@example.com"}}'); };
    creds(path.join(sb.dir, 'rel-ovf'));            // resolvable from the helper's cwd (sb.dir) …
    creds(path.join(sb.run, 'ovf'));
    creds(path.join(sb.wt, 'ovf'));
    const cfg = path.join(sb.dir, 'state', 'config.yaml');
    fs.writeFileSync(cfg, 'grok_reviews: enabled\nclaude_overflow_dir: rel-ovf\n');
    const rel = run(sb, { lane: 'l2', mode: 'impl', model: 'claude-sonnet-5-5', effort: 'low' });
    expect(rel.code).toBe(5);
    expect(rel.status()).toMatchObject({ class: 'auth', note: 'claude-dir-invalid' });
    expect(H.lanesOf(sb).l2.reason).toContain('absolute');
    for (const d of [path.join(sb.run, 'ovf'), path.join(sb.wt, 'ovf'), 'rel-ovf']) {
      H.writeLanes(sb, {});
      const r = run(sb, { lane: 'l2', mode: 'impl', model: 'claude-sonnet-5-5', effort: 'low', 'claude-dir': d });
      expect({ d, code: r.code, note: r.status().note }).toEqual({ d, code: 5, note: 'claude-dir-invalid' });
    }
    expect(calls(sb, 'claude')).toEqual([]);
  }, 60_000);

  test('F4: a claude dir that EXISTS but cannot be safely resolved (symlink in run dir / task cwd → control-char-named dir, dangling link) is refused, not treated as missing', () => {
    const sb = mkSandbox();
    step(sb, 'claude', OK_CLAUDE);
    const evil = path.join(sb.home, 'ovf\nevil');
    fs.mkdirSync(evil);
    fs.writeFileSync(path.join(evil, '.claude.json'), '{"oauthAccount": {"emailAddress": "second@example.com"}}');
    const inRun = path.join(sb.run, 'ovf-link');
    const inWt = path.join(sb.wt, 'ovf-link');
    const dangling = path.join(sb.home, 'ovf-dangling');
    fs.mkdirSync(sb.run, { recursive: true });
    fs.mkdirSync(sb.wt, { recursive: true });
    fs.symlinkSync(evil, inRun);
    fs.symlinkSync(evil, inWt);
    fs.symlinkSync(path.join(sb.home, 'no-such-target'), dangling);
    for (const d of [inRun, inWt, dangling]) {
      H.writeLanes(sb, {});
      const r = run(sb, { lane: 'l2', mode: 'impl', model: 'claude-sonnet-5-5', effort: 'low', 'claude-dir': d });
      expect({ d, code: r.code, st: r.status() }).toMatchObject({ d, code: 5, st: { class: 'auth', note: 'claude-dir-invalid' } });
      expect(H.lanesOf(sb).l2.status).toBe('absent');
    }
    // A genuinely non-existent dir still falls through to the no-credentials refusal.
    H.writeLanes(sb, {});
    const gone = run(sb, { lane: 'l2', mode: 'impl', model: 'claude-sonnet-5-5', effort: 'low', 'claude-dir': path.join(sb.home, 'nope') });
    expect(gone.code).toBe(5);
    expect(gone.status()).toMatchObject({ class: 'auth', note: 'no-credentials' });
    expect(calls(sb, 'claude')).toEqual([]);
  }, 60_000);

  // A `$(…)` strips TRAILING newlines before any validation could see them: a clean-named link to a
  // dir literally named `X<newline>` must never canonicalize to its sibling `X`.
  test('F4/S5: a link to a dir whose name ENDS in a newline never canonicalizes to the newline-less sibling (claude-dir / --cwd / --run-dir / --out)', () => {
    const sb = mkSandbox();
    step(sb, 'claude', OK_CLAUDE);
    const creds = (d: string) => { fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, '.claude.json'), '{"oauthAccount": {"emailAddress": "second@example.com"}}'); };
    const L2 = { lane: 'l2', mode: 'impl', model: 'claude-sonnet-5-5', effort: 'low' } as const;
    const trick = (base: string, name: string, sibling: () => void) => {
      fs.mkdirSync(path.join(base, `${name}\n`), { recursive: true });
      sibling();
      fs.symlinkSync(path.join(base, `${name}\n`), path.join(base, `${name}-link`));
      return path.join(base, `${name}-link`);
    };
    // claude dir: the sibling `ovf` is itself a link INTO the task cwd (worker-writable creds).
    creds(path.join(sb.wt, 'planted'));
    const cdir = trick(sb.home, 'ovf', () => fs.symlinkSync(path.join(sb.wt, 'planted'), path.join(sb.home, 'ovf')));
    H.writeLanes(sb, {});
    const c = run(sb, { ...L2, 'claude-dir': cdir });
    expect({ code: c.code, st: c.status() }).toMatchObject({ code: 5, st: { class: 'auth', note: 'claude-dir-invalid' } });
    expect(calls(sb, 'claude')).toEqual([]);
    // --cwd: the sibling is an ordinary dir the link must NOT reach.
    const cwd = trick(sb.dir, 'cwdx', () => fs.mkdirSync(path.join(sb.dir, 'cwdx')));
    const w = run(sb, { ...L2, 'claude-dir': sb.claudeDir, cwd });
    expect({ what: '--cwd', code: w.code }).toEqual({ what: '--cwd', code: 2 });
    // --run-dir: --out names the newline-less sibling, which the link must not canonicalize to.
    const rlink = trick(sb.dir, 'runx', () => fs.mkdirSync(path.join(sb.dir, 'runx')));
    const rout = path.join(sb.dir, 'runx', 'attempts', 't1', 'r1', 'out.txt');
    const r = lane(sb, ['run', '--run-dir', rlink, '--cwd', sb.wt, '--prompt-file', sb.prompt, '--out', rout,
      '--lane', 'l2', '--mode', 'impl', '--model', 'claude-sonnet-5-5', '--effort', 'low', '--claude-dir', sb.claudeDir]);
    expect({ what: '--run-dir', code: r.code }).toEqual({ what: '--run-dir', code: 2 });
    // --out: the attempt dir is a link to `<attempt><newline>` beside it.
    const t1 = path.join(sb.run, 'attempts', 't1');
    fs.mkdirSync(t1, { recursive: true });
    trick(t1, 'ax', () => {});
    fs.renameSync(path.join(t1, 'ax-link'), path.join(t1, 'ax'));
    const o = run(sb, { ...L2, 'claude-dir': sb.claudeDir, out: path.join(t1, 'ax', 'out.txt') });
    expect({ what: '--out', code: o.code }).toEqual({ what: '--out', code: 2 });
    expect(calls(sb, 'claude')).toEqual([]);
  }, 60_000);

  // The hermetic CODEX_HOME holds a copy of the operator's auth.json: its containment check must
  // compare CANONICAL paths only — an unresolvable / aliased base never falls back to the lexical
  // alias, so the home can never be created inside the task cwd.
  test('D6/S5: a hermetic CODEX_HOME base that aliases INTO the task cwd (newline-target link, missing tail under a link, linked lane-codex-home) refuses l3 — no auth copy anywhere under the task dir', () => {
    const L3 = { lane: 'l3', mode: 'impl', model: 'gpt-6.1-sol', effort: 'low', timeout: '10' } as const;
    const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
      const p = path.join(d, e.name);
      return e.isDirectory() ? walk(p) : [p];
    });
    const cases: [string, (sb: ReturnType<typeof mkSandbox>) => Record<string, string>][] = [
      ['~/.gstack -> <task>/state<LF> (GSTACK_HOME unset)', (sb) => {
        fs.mkdirSync(path.join(sb.wt, 'state\n'));
        fs.symlinkSync(path.join(sb.wt, 'state\n'), path.join(sb.home, '.gstack'));
        return { GSTACK_HOME: '' };
      }],
      ['GSTACK_HOME=<link into task>/missing/tail', (sb) => {
        fs.symlinkSync(sb.wt, path.join(sb.home, 'gs'));
        return { GSTACK_HOME: path.join(sb.home, 'gs', 'missing', 'tail') };
      }],
      ['<GSTACK_HOME>/lane-codex-home -> <task>/lch', (sb) => {
        fs.mkdirSync(sb.gstackHome, { recursive: true });
        fs.mkdirSync(path.join(sb.wt, 'lch'));
        fs.symlinkSync(path.join(sb.wt, 'lch'), path.join(sb.gstackHome, 'lane-codex-home'));
        return {};
      }],
    ];
    for (const [what, setup] of cases) {
      const sb = mkSandbox();
      step(sb, 'codex', OK_CODEX);
      const env = setup(sb);
      if (env.GSTACK_HOME === '') { delete sb.env.GSTACK_HOME; delete env.GSTACK_HOME; }
      const r = run(sb, L3, [], env);
      expect({ what, refused: r.code !== 0, launched: calls(sb, 'codex').length }).toEqual({ what, refused: true, launched: 0 });
      expect({ what, auth: walk(sb.wt).filter((f) => f.endsWith('auth.json')) }).toEqual({ what, auth: [] });
    }
  }, 60_000);
});

describe('invariants across every recorded invocation', () => {
  test('no stub invocation ever received --always-approve; grok never got the prompt text in argv; codex always ran with --json', () => {
    expect(H.checkInvariants()).toBeGreaterThan(3);
  });
});
