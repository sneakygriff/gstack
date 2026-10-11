/**
 * bin/gstack-lane — core suite: usage, the l3 codex / l2 claude lanes, classification,
 * quota cooling and probes (docs/designs/AUTOBUILDER_LANES.md + D1–D9, E1–E10).
 * Deadlines/reaping/kernel lock: test/gstack-lane-process.test.ts; grok containment/taint,
 * commit and worktree: test/gstack-lane-isolation.test.ts; FIX-H hardening:
 * test/gstack-lane-hardening.test.ts; adjudicate: test/gstack-lane-adjudicate.test.ts. All
 * use test/helpers/gstack-lane-harness.ts: STUB vendor CLIs only, first on a hermetic PATH
 * where the real ones cannot be found.
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { spawn, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import {
  LANE, CONFIG, OK_CLAUDE, OK_CODEX, FIX_OK, FIX_NOAUTH, codexStep, flagValue, real, mode, makeLaneHarness,
} from './helpers/gstack-lane-harness';

const H = makeLaneHarness('gstack-lane');
const { mkSandbox, step, lane, freshOut, runArgs, run, calls, lanesOf, writeLanes, wtAdd, codexBase, sh, repo } = H;

beforeAll(() => H.setup());
afterAll(() => H.teardown());

describe('static + usage', () => {
  test('bash -n passes; header documents subcommands, exit codes, files and residual risks', () => {
    expect(spawnSync('bash', ['-n', LANE], { timeout: 20_000 }).status).toBe(0);
    const src = fs.readFileSync(LANE, 'utf8');
    for (const s of ['gstack-lane probe --run-dir', 'gstack-lane run --run-dir', 'gstack-lane summary --out', 'gstack-lane commit --run-dir',
      'gstack-lane commit --cwd', 'gstack-lane worktree add', 'gstack-lane worktree rm', 'EXIT CODES', 'FILES WRITTEN', 'RESIDUAL RISKS',
      '124 timeout', 'lane-codex-home', 'codex exec --json', 'lanes.lock', 'lanes.json.hashes']) {
      expect(src).toContain(s);
    }
    expect(src).not.toMatch(/_gl_add[^\n]*--always-approve/);
  });

  test('malformed invocations exit 2 and invoke nothing', () => {
    const sb = mkSandbox();
    expect(lane(sb, []).code).toBe(2);
    expect(lane(sb, ['run', '--lane', 'l3']).code).toBe(2);
    expect(run(sb, { lane: 'l9', mode: 'impl', model: 'm', effort: 'low' }).code).toBe(2);
    expect(run(sb, { lane: 'l3', mode: 'impl', effort: 'low' }).code).toBe(2); // l3 needs --model
    expect(calls(sb, 'codex')).toEqual([]);
  });

  test('D3: --out must be <run-dir>/attempts/<task>/<attempt>/<file>, fresh, and match --task/--attempt-id', () => {
    const sb = mkSandbox();
    step(sb, 'codex', OK_CODEX);
    const base = { lane: 'l3', mode: 'impl', model: 'gpt-6.1-sol', effort: 'low' };
    for (const out of [path.join(sb.dir, 'out.txt'), path.join(sb.run, 'out.txt'), path.join(sb.run, 'attempts', 't1', 'out.txt'),
      `${sb.run}/attempts/t1/a/../b/out.txt`, path.join(sb.run, 'attempts', 't1', 'a1\nx', 'out.txt'),
      path.join(sb.dir, 'other', 'attempts', 't1', 'a1', 'out.txt')]) {
      expect({ out, code: run(sb, { ...base, out }).code }).toEqual({ out, code: 2 });
    }
    const odd = run(sb, { ...base, out: path.join(sb.run, 'attempts', 't 1', 'try 1', 'out.txt') });
    expect(odd.code).toBe(0);
    expect(odd.status().task).toBe(null);
    expect(odd.status().attempt_id).toMatch(/^a-l3-/);
    const ok = run(sb, base);
    expect(ok.code).toBe(0);
    expect(ok.status()).toMatchObject({ task: 't1', attempt_id: path.basename(path.dirname(ok.outPath)) });
    const before = fs.readFileSync(`${ok.outPath}.status.json`, 'utf8');
    expect(run(sb, { ...base, out: ok.outPath }).code).toBe(2);
    expect(fs.readFileSync(`${ok.outPath}.status.json`, 'utf8')).toBe(before);
    const out2 = freshOut(sb, 'gate-m1');
    fs.mkdirSync(path.dirname(out2), { recursive: true });
    const prompt = path.join(path.dirname(out2), 'prompt.md');
    fs.writeFileSync(prompt, 'review it\n');
    expect(run(sb, { ...base, out: out2, prompt, task: 'other' }).code).toBe(2);
    expect(run(sb, { ...base, out: out2, prompt, 'attempt-id': 'nope' }).code).toBe(2);
    const r2 = run(sb, { ...base, out: out2, prompt, task: 'gate-m1', 'attempt-id': path.basename(path.dirname(out2)) });
    expect(r2.code).toBe(0);
    expect(r2.status().task).toBe('gate-m1');
    expect(mode(path.dirname(ok.outPath))).toBe(0o700);
    for (const f of [`${ok.outPath}.status.json`, `${ok.outPath}.stderr.log`, `${ok.outPath}.logs/inv-1/stdout`, ok.outPath]) expect(mode(f)).toBe(0o600);
  }, 30_000);

  test('E10: --allow-cmd accepts exactly the table of runner + subcommand pairs (each one), and rejects everything else', () => {
    const sb = mkSandbox();
    step(sb, 'claude', OK_CLAUDE);
    for (const bad of ['bash -c', 'sh', 'env FOO=1 bun test', 'npm', 'bun', 'bun -e x', 'bun x foo', 'npx vitest', 'npm exec bash',
      'bundle exec bash', 'bundle exec /bin/sh', 'bundle exec', 'make /bin/sh', 'make', 'make sh', 'npm run', 'npm run bash', 'cargo run',
      'go run x', 'yarn dlx x', 'python -c x', 'python3 script.py', 'node -e 1', 'perl -e 1', 'curl http://x', 'wget x',
      'make; rm', 'bun test && rm', 'go test | sh', 'eval x', 'git diff', 'bun test /etc/passwd', 'pytest ../x', 'bun test ./node_modules/.bin/sh',
      'bun test x/../../y', '/bin/sh', './sh test', 'bun test  x', ' bun test', 'bun test ']) {
      const r = run(sb, { lane: 'l2', mode: 'impl', model: 'claude-sonnet-5-5', effort: 'low', 'claude-dir': sb.claudeDir }, ['--allow-cmd', bad]);
      expect({ bad, code: r.code }).toEqual({ bad, code: 2 });
    }
    expect(calls(sb, 'claude')).toEqual([]);
    const good = ['bun test', 'bun run build', 'npm test', 'npm run test', 'pnpm test', 'pnpm run lint', 'yarn test', 'yarn run test',
      'make test', 'cargo test', 'cargo build', 'go test ./...', 'pytest', 'pytest -q', 'python -m pytest', 'python3 -m pytest tests',
      'uv run pytest', 'swift test', 'xcodebuild test', './gradlew test', 'gradle test', 'mvn test', 'dotnet test', 'mix test',
      'bundle exec rspec', 'rspec', 'bun test test/unit.test.ts'];
    const r = run(sb, { lane: 'l2', mode: 'impl', model: 'claude-sonnet-5-5', effort: 'low', 'claude-dir': sb.claudeDir }, good.flatMap((g) => ['--allow-cmd', g]));
    expect(r.code).toBe(0);
    const allowed = flagValue(calls(sb, 'claude')[0].argv, '--allowedTools')!.split(',');
    for (const g of good) expect(allowed).toContain(`Bash(${g}:*)`);
  }, 30_000);
});

describe('l3 codex (E1–E4, addendum b)', () => {
  test('exact `codex exec --json` argv; FRESH per-invocation CODEX_HOME (0700/0600, fixed verified config) removed afterwards; runtime model from the rollout', () => {
    const sb = mkSandbox();
    step(sb, 'codex', OK_CODEX);
    const r = run(sb, { lane: 'l3', mode: 'impl', model: 'gpt-6.1-sol', effort: 'high', timeout: '10' });
    expect(r.code).toBe(0);
    expect(r.out + r.err).not.toContain('SECRET-TOKEN-123');
    const [c] = calls(sb, 'codex');
    expect(c.argv).toEqual(['exec', '--json', '-C', real(sb.wt), '-s', 'workspace-write', '-c', 'approval_policy="never"', '-c', 'service_tier="default"',
      '-c', 'model="gpt-6.1-sol"', '-c', 'model_reasoning_effort="high"', '-']);
    expect(c.stdin).toBe('Implement task T7: add the widget.\n'); // stdin = the prompt FILE (EOF, never an open pipe)
    const attempt = path.basename(path.dirname(r.outPath));
    const home = path.join(codexBase(sb), `t1+${attempt}-inv1`); // H15: <task>+<attempt>-inv<n>
    expect(c.env.CODEX_HOME).toBe(home);
    expect(home.startsWith(sb.run)).toBe(false);
    expect(fs.readFileSync(path.join(c.rec, 'codex-modes'), 'utf8').trim().split('\n')).toEqual(['700', '600', '600']);
    expect(fs.readFileSync(path.join(c.rec, 'codex-auth.json'), 'utf8')).toBe(fs.readFileSync(path.join(sb.home, '.codex', 'auth.json'), 'utf8'));
    expect(fs.readFileSync(path.join(c.rec, 'codex-config.toml'), 'utf8').split('\n').filter((l) => l && !l.startsWith('#')))
      .toEqual(['approval_policy = "never"', 'service_tier = "default"']);
    expect(fs.existsSync(home)).toBe(false); // removed after the invocation
    expect(fs.readFileSync(r.outPath, 'utf8')).toBe('final message\n');
    const s = r.status();
    expect(s).toMatchObject({ lane: 'l3', mode: 'impl', task: 't1', requested_model: 'gpt-6.1-sol', requested_model_source: 'argument', effort: 'high',
      runtime_model: 'gpt-6.1-sol', runtime_model_source: 'rollout', runtime_effort: 'high', model_mismatch: false, exit: 0, class: 'ok', exit_code: 0,
      sandbox: 'workspace-write', timeout_retry: false, lane_update: 'applied', reviewed_sha: null, tainted: false, taint_checked: false,
      throttle_count: 0, result_sha: null, published: true });
    expect(s.cmd_redacted).toContain('codex exec --json');
    expect(s.cmd_redacted).toContain('< <prompt-file>');
    expect(s.cmd_redacted).not.toContain('add the widget');
    expect(JSON.stringify(s)).not.toContain('SECRET-TOKEN-123');
    expect(lanesOf(sb).l3).toMatchObject({ status: 'ok', runtime_model: 'gpt-6.1-sol', consecutive_quota: 0, throttle_count: 0, next_probe_at: null });
  });

  test('the REAL captured samples: ok stream → ok with runtime model/effort from the rollout; no-auth stream → auth (lane absent)', () => {
    const sb = mkSandbox();
    step(sb, 'codex', FIX_OK, 1);
    step(sb, 'codex', FIX_NOAUTH, 2);
    const ok = run(sb, { lane: 'l3', mode: 'impl', model: 'gpt-6-luna', effort: 'low' });
    expect(ok.code).toBe(0);
    expect(ok.status()).toMatchObject({ class: 'ok', runtime_model: 'gpt-6-luna', runtime_effort: 'low', runtime_model_source: 'rollout', model_mismatch: false });
    expect(fs.readFileSync(ok.outPath, 'utf8')).toBe('OK\n');
    const bad = run(sb, { lane: 'l3', mode: 'impl', model: 'gpt-6-luna', effort: 'low' });
    expect(bad.code).toBe(5);
    expect(bad.status().class).toBe('auth');
    expect(bad.status().class_detail).toContain('401 Unauthorized');
    expect(bad.status().published).toBe(false);
    expect(fs.existsSync(bad.outPath)).toBe(false);
    expect(lanesOf(sb).l3.status).toBe('absent');
  }, 30_000);

  test('no rollout → runtime_model null (source none); a cwd that contains the hermetic home is refused', () => {
    const sb = mkSandbox();
    step(sb, 'codex', codexStep({ model: null }));
    const r = run(sb, { lane: 'l3', mode: 'impl', model: 'gpt-6.1-sol', effort: 'low' });
    expect(r.code).toBe(0);
    expect(r.status()).toMatchObject({ runtime_model: null, runtime_model_source: 'none', runtime_effort: null, model_mismatch: false });
    fs.mkdirSync(sb.gstackHome, { recursive: true });
    for (const cwd of [sb.gstackHome, sb.dir]) {
      const x = run(sb, { lane: 'l3', mode: 'impl', model: 'gpt-6.1-sol', effort: 'low', cwd });
      expect(x.code).toBe(1);
      expect(x.status().rejected).toContain('CODEX_HOME');
    }
    expect(calls(sb, 'codex')).toHaveLength(1);
  });

  test('review: -s read-only, --output-schema, reviewed_sha; an empty review body is class error and nothing is published', () => {
    const sb = mkSandbox();
    const wt = wtAdd(sb, 'rev-l3', { detach: true });
    const schema = path.join(sb.dir, 'schema.json');
    fs.writeFileSync(schema, '{"type":"object"}');
    step(sb, 'codex', codexStep({ text: '{"verdict":"PASS"}' }), 1);
    step(sb, 'codex', codexStep({ text: '  \n' }), 2);
    const r = run(sb, { lane: 'l3', mode: 'review', model: 'gpt-6.1-sol', effort: 'xhigh', schema, cwd: wt });
    expect(r.code).toBe(0);
    const [c] = calls(sb, 'codex');
    expect(flagValue(c.argv, '-s')).toBe('read-only');
    expect(flagValue(c.argv, '--output-schema')).toBe(real(schema));
    expect(r.status()).toMatchObject({ class: 'ok', sandbox: 'read-only', reviewed_sha: sh('git', ['rev-parse', 'HEAD'], repo()) });
    expect(fs.readFileSync(r.outPath, 'utf8')).toBe('{"verdict":"PASS"}\n');
    const empty = run(sb, { lane: 'l3', mode: 'review', model: 'gpt-6.1-sol', effort: 'xhigh', cwd: wt });
    expect(empty.code).toBe(1);
    expect(empty.status()).toMatchObject({ class: 'error', class_detail: 'empty review body', exit: 0, published: false });
    expect(fs.existsSync(empty.outPath)).toBe(false);
  });

  test('E3: a step-down retry that produces no body never publishes the earlier invocation\'s output; each invocation has its own home + files', () => {
    const sb = mkSandbox();
    step(sb, 'codex', codexStep({ text: 'EARLY REVIEW BODY', completed: false, rc: 124 }), 1);
    step(sb, 'codex', codexStep({ text: null }), 2);
    step(sb, 'codex', codexStep({ text: 'EARLY REVIEW BODY', completed: false, rc: 124 }), 3);
    step(sb, 'codex', codexStep({ text: 'LATE REVIEW BODY' }), 4);
    const wt = wtAdd(sb, 'rev-e3', { detach: true });
    const r = run(sb, { lane: 'l3', mode: 'review', model: 'gpt-6.1-sol', effort: 'high', cwd: wt });
    expect(r.code).toBe(1);
    expect(r.status()).toMatchObject({ class: 'error', class_detail: 'empty review body', timeout_retry: true, published: false });
    expect(fs.existsSync(r.outPath)).toBe(false);
    expect(fs.readFileSync(`${r.outPath}.logs/inv-1/out`, 'utf8')).toBe('EARLY REVIEW BODY\n');
    expect(r.status().attempts.map((a: any) => path.basename(a.dir))).toEqual(['inv-1', 'inv-2']);
    const homes = calls(sb, 'codex').map((c) => path.basename(c.env.CODEX_HOME));
    expect(homes).toEqual([`t1+${path.basename(path.dirname(r.outPath))}-inv1`, `t1+${path.basename(path.dirname(r.outPath))}-inv2`]);
    const r2 = run(sb, { lane: 'l3', mode: 'review', model: 'gpt-6.1-sol', effort: 'high', cwd: wt });
    expect(r2.code).toBe(0);
    expect(fs.readFileSync(r2.outPath, 'utf8')).toBe('LATE REVIEW BODY\n');
  }, 30_000);

  test('E4: a config that cannot be installed refuses the launch — first invocation and the (review) step-down retry alike', () => {
    const sb = mkSandbox();
    step(sb, 'codex', OK_CODEX);
    const out = freshOut(sb);
    fs.mkdirSync(path.join(codexBase(sb), `t1+${path.basename(path.dirname(out))}-inv1`, 'config.toml'), { recursive: true });
    const r = run(sb, { lane: 'l3', mode: 'impl', model: 'gpt-6.1-sol', effort: 'high', out });
    expect(r.code).toBe(1);
    expect(r.status()).toMatchObject({ class: 'error', class_detail: 'hermetic codex config not installed', note: 'codex-config-not-installed' });
    expect(calls(sb, 'codex')).toEqual([]);
    // Retry path (reviews only, H14): the first invocation times out after planting a blocker where inv2's home goes.
    step(sb, 'codex', 'mkdir -p "${CODEX_HOME%-inv1}-inv2/config.toml"\nexit 124\n', 1);
    const r2 = run(sb, { lane: 'l3', mode: 'review', model: 'gpt-6.1-sol', effort: 'high' });
    expect(r2.code).toBe(1);
    expect(r2.status()).toMatchObject({ class: 'error', class_detail: 'hermetic codex config not installed', timeout_retry: true });
    expect(calls(sb, 'codex')).toHaveLength(1);
  }, 30_000);

  test('addendum b: a same-account token rotation is written back atomically; another account or a concurrently changed source is not', () => {
    const sb = mkSandbox();
    const src = path.join(sb.home, '.codex', 'auth.json');
    const orig = fs.readFileSync(src, 'utf8');
    step(sb, 'codex', `echo '{"tokens":{"access_token":"ROTATED-1","account_id":"acct-1"}}' > "$CODEX_HOME/auth.json"\n${OK_CODEX}`, 1);
    step(sb, 'codex', `echo '{"tokens":{"access_token":"OTHER","account_id":"acct-2"}}' > "$CODEX_HOME/auth.json"\n${OK_CODEX}`, 2);
    step(sb, 'codex', `echo '{"tokens":{"access_token":"CONCURRENT","account_id":"acct-1"}}' > "$HOME/.codex/auth.json"\necho '{"tokens":{"access_token":"ROTATED-3","account_id":"acct-1"}}' > "$CODEX_HOME/auth.json"\n${OK_CODEX}`, 3);
    expect(run(sb, { lane: 'l3', mode: 'impl', model: 'gpt-6.1-sol', effort: 'low' }).code).toBe(0);
    expect(fs.readFileSync(src, 'utf8')).toContain('ROTATED-1');
    expect(mode(src)).toBe(0o600);
    expect(orig).not.toContain('ROTATED');
    expect(run(sb, { lane: 'l3', mode: 'impl', model: 'gpt-6.1-sol', effort: 'low' }).code).toBe(0);
    expect(fs.readFileSync(src, 'utf8')).toContain('ROTATED-1'); // other account: not written
    expect(run(sb, { lane: 'l3', mode: 'impl', model: 'gpt-6.1-sol', effort: 'low' }).code).toBe(0);
    expect(fs.readFileSync(src, 'utf8')).toContain('CONCURRENT'); // compare-and-swap lost: newer source kept
    expect(fs.readdirSync(codexBase(sb))).toEqual([]); // every per-invocation home removed
  }, 30_000);

  test('l3 refuses ultra and max (class error, exit 1) without invoking codex', () => {
    const sb = mkSandbox();
    for (const effort of ['ultra', 'max']) {
      const r = run(sb, { lane: 'l3', mode: 'impl', model: 'gpt-6-astra', effort });
      expect(r.code).toBe(1);
      expect(r.status().rejected).toContain(effort);
      expect(r.status().class_detail).toMatch(/^rejected: /);
    }
    expect(calls(sb, 'codex')).toEqual([]);
  });
});

describe('l2 claude', () => {
  test('impl (D8): isolation flags, explicit tools, vetted Bash only, every account token unset', () => {
    const sb = mkSandbox();
    step(sb, 'claude', OK_CLAUDE);
    const schema = path.join(sb.dir, 'schema.json');
    fs.writeFileSync(schema, '{"type":"object","properties":{"ok":{"type":"boolean"}}}');
    const r = run(sb, { lane: 'l2', mode: 'impl', model: 'claude-sonnet-5-5', effort: 'medium', tier: 'T1', 'claude-dir': sb.claudeDir, schema },
      ['--allow-cmd', 'bun test'], { ANTHROPIC_API_KEY: 'sk-ant-api-should-not-leak', ANTHROPIC_AUTH_TOKEN: 'tok', CLAUDE_CODE_OAUTH_TOKEN: 'acct1',
        CLAUDE_CODE_SESSION_ACCESS_TOKEN: 'x', CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR: '3', CLAUDE_CODE_USE_BEDROCK: '0' });
    expect(r.code).toBe(0);
    const [c] = calls(sb, 'claude');
    expect(c.env.CLAUDE_CONFIG_DIR).toBe(sb.claudeDir);
    expect(c.envnames.sort()).toEqual(['CLAUDE_CODE_USE_BEDROCK']);
    expect(c.argv).toEqual(['-p', '--restricted', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--settings', '{"disableAllHooks":true}',
      '--model', 'claude-sonnet-5-5', '--effort', 'medium', '--permission-mode', 'dontAsk', '--tools', 'Read,Grep,Glob,Edit,Write,Bash',
      '--allowedTools', 'Read,Grep,Glob,Edit,Write,Bash(bun test:*)', '--output-format', 'json', '--json-schema', fs.readFileSync(schema, 'utf8')]);
    const s = r.status();
    expect(s).toMatchObject({ lane: 'l2', class: 'ok', tier: 'T1', runtime_model: 'claude-sonnet-5-5-20261001', runtime_model_source: 'modelUsage', model_mismatch: false, published: true });
    expect(s.cmd_redacted).toContain('<schema-file>');
    expect(s.cmd_redacted).not.toMatch(/sk-ant-api|acct1/);
    expect(JSON.parse(fs.readFileSync(r.outPath, 'utf8')).result).toBe('done');
  });

  test('review (H20): EXACT argv — the same isolation prefix as impl (--restricted ignores project .claude/settings.json), plan mode, EXACTLY Read,Grep,Glob, no Bash', () => {
    const sb = mkSandbox();
    step(sb, 'claude', OK_CLAUDE);
    expect(run(sb, { lane: 'l2', mode: 'review', model: 'claude-opus-5-5', effort: 'high', 'claude-dir': sb.claudeDir }, ['--allow-cmd', 'bun test']).code).toBe(0);
    const [c] = calls(sb, 'claude');
    expect(c.argv).toEqual(['-p', '--restricted', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--settings', '{"disableAllHooks":true}',
      '--model', 'claude-opus-5-5', '--effort', 'high', '--permission-mode', 'plan', '--tools', 'Read,Grep,Glob', '--allowedTools', 'Read,Grep,Glob',
      '--output-format', 'json']);
    expect(c.argv.join(' ')).not.toContain('Bash');
  });

  test('Fable needs --allow-credit-billing; no credentials → absent (dir from gstack-config); a probe clears absent', () => {
    const sb = mkSandbox();
    step(sb, 'claude', OK_CLAUDE);
    for (const model of ['claude-fable-5-1', 'fable']) {
      const r = run(sb, { lane: 'l2', mode: 'impl', model, effort: 'high', 'claude-dir': sb.claudeDir });
      expect(r.code).toBe(1);
      expect(r.status().rejected).toContain('--allow-credit-billing');
    }
    expect(calls(sb, 'claude')).toEqual([]);
    expect(run(sb, { lane: 'l2', mode: 'impl', model: 'claude-fable-5-1', effort: 'high', 'claude-dir': sb.claudeDir }, ['--allow-credit-billing']).code).toBe(0);
    const empty = path.join(sb.dir, 'empty-claude');
    fs.mkdirSync(empty);
    expect(spawnSync(CONFIG, ['set', 'claude_overflow_dir', empty], { env: sb.env, encoding: 'utf8', timeout: 20_000 }).status).toBe(0);
    const r = run(sb, { lane: 'l2', mode: 'impl', model: 'claude-sonnet-5-5', effort: 'medium' });
    expect(r.code).toBe(5);
    expect(lanesOf(sb).l2.status).toBe('absent');
    spawnSync(CONFIG, ['set', 'claude_overflow_dir', sb.claudeDir], { env: sb.env, encoding: 'utf8', timeout: 20_000 });
    expect(lane(sb, ['probe', '--run-dir', sb.run, '--lanes', 'l2']).code).toBe(0);
    expect(lanesOf(sb).l2.status).toBe('ok');
  }, 30_000);

  test('same-account guard: L2 that logs into the ROOT session account is absent (no launch); a different or unknown id proceeds', () => {
    const sb = mkSandbox();
    step(sb, 'claude', OK_CLAUDE);
    const acct = (id: string | null) => JSON.stringify({ oauthAccount: id ? { accountUuid: id, emailAddress: 'x@example.com' } : { emailAddress: 'x@example.com' } });
    const l2 = (env: Record<string, string> = {}, dir = sb.claudeDir) => run(sb, { lane: 'l2', mode: 'impl', model: 'claude-sonnet-5-5', effort: 'low', 'claude-dir': dir }, [], env);
    // root id from the ENV (what the desktop session exports)
    fs.writeFileSync(path.join(sb.claudeDir, '.claude.json'), acct('11111111-aaaa-bbbb-cccc-000000000001'));
    const same = l2({ CLAUDE_CODE_ACCOUNT_UUID: '11111111-aaaa-bbbb-cccc-000000000001' });
    expect(same.code).toBe(5);
    expect(same.status()).toMatchObject({ class: 'auth', note: 'same-account' });
    expect(lanesOf(sb).l2.reason).toContain('same account as the root session');
    expect(same.out + same.err).not.toContain('x@example.com');
    expect(calls(sb, 'claude')).toEqual([]);
    // root id from $HOME/.claude.json when the env is absent; probe applies the same guard
    fs.writeFileSync(path.join(sb.home, '.claude.json'), acct('11111111-aaaa-bbbb-cccc-000000000001'));
    expect(JSON.parse(lane(sb, ['probe', '--run-dir', sb.run, '--lanes', 'l2', '--claude-dir', sb.claudeDir, '--json']).out).l2.reason).toContain('same account');
    expect(calls(sb, 'claude')).toEqual([]);
    // a DIFFERENT account proceeds (after a probe clears absent)
    fs.writeFileSync(path.join(sb.claudeDir, '.claude.json'), acct('22222222-aaaa-bbbb-cccc-000000000002'));
    expect(JSON.parse(lane(sb, ['probe', '--run-dir', sb.run, '--lanes', 'l2', '--claude-dir', sb.claudeDir, '--json']).out).l2.status).toBe('ok');
    expect(l2().code).toBe(0);
    // an UNKNOWN overflow id keeps today's behavior even when the root id is known
    fs.writeFileSync(path.join(sb.claudeDir, '.claude.json'), acct(null));
    expect(l2({ CLAUDE_CODE_ACCOUNT_UUID: '11111111-aaaa-bbbb-cccc-000000000001' }).code).toBe(0);
    // the root's own config dirs are refused outright
    fs.mkdirSync(path.join(sb.home, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(sb.home, '.claude', '.claude.json'), acct(null));
    for (const dir of [path.join(sb.home, '.claude'), sb.home]) {
      writeLanes(sb, {}); // so the refusal comes from the guard, not from the previous iteration's absent lane
      const r = l2({}, dir);
      expect({ dir, code: r.code, note: r.status().note }).toEqual({ dir, code: 5, note: 'same-account' });
    }
  }, 30_000);

  test('top-level is_error "usage limit reached|<epoch>" → quota with the epoch as next_probe_at (end to end)', () => {
    const sb = mkSandbox();
    const epoch = Math.floor(Date.now() / 1000) + 3 * 3600;
    step(sb, 'claude', `echo '{"type":"result","is_error":true,"result":"Claude AI usage limit reached|${epoch}"}'\nexit 1\n`);
    const r = run(sb, { lane: 'l2', mode: 'impl', model: 'claude-sonnet-5-5', effort: 'medium', 'claude-dir': sb.claudeDir });
    expect(r.code).toBe(4);
    expect(lanesOf(sb).l2).toMatchObject({ status: 'cooling', consecutive_quota: 1 });
    expect(Date.parse(lanesOf(sb).l2.next_probe_at)).toBe(epoch * 1000);
  });
});

describe('classification (E1: structured output only)', () => {
  const cases: [string, string, number, string, string][] = [
    ['ok (turn.completed)', codexStep(), 0, 'ok', 'ok'],
    ['throttle (429)', codexStep({ fail: 'exceeded retry limit, last status: 429 Too Many Requests' }), 3, 'throttle', 'ok'],
    ['throttle (5xx)', codexStep({ fail: 'unexpected status 503 Service Unavailable' }), 3, 'throttle', 'ok'],
    ['throttle (stream disconnected)', codexStep({ fail: 'stream disconnected before completion: Reconnecting... 5/5' }), 3, 'throttle', 'ok'],
    // H19: OpenAI's per-minute 429 says "Rate limit reached … try again in" — a rate limit, never quota.
    ['throttle (OpenAI "Rate limit reached" 429)', codexStep({ fail: 'Rate limit reached for gpt-6.1-sol in organization org-x on tokens per min (TPM): Limit 30000, Used 29500, Requested 1200. Please try again in 1.4s. Visit https://platform.openai.com/account/rate-limits to learn more.' }), 3, 'throttle', 'ok'],
    ['quota (OpenAI insufficient_quota)', codexStep({ fail: 'You exceeded your current quota, please check your plan and billing details.' }), 4, 'quota', 'cooling'],
    ['quota', codexStep({ fail: "You've hit your usage limit. Upgrade to Pro or try later." }), 4, 'quota', 'cooling'],
    ['auth (403)', codexStep({ fail: 'unexpected status 403 Forbidden' }), 5, 'auth', 'absent'],
    ['error (turn.failed, vendor-neutral)', codexStep({ fail: 'model produced an invalid tool call' }), 1, 'error', 'ok'],
    ['error (no terminal event)', codexStep({ completed: false, rc: 2 }), 1, 'error', 'ok'],
  ];
  for (const [label, body, code, cls, laneStatus] of cases) {
    test(`l3 ${label} → class ${cls}, exit ${code}, lane ${laneStatus}`, () => {
      const sb = mkSandbox();
      step(sb, 'codex', body);
      const r = run(sb, { lane: 'l3', mode: 'impl', model: 'gpt-6.1-sol', effort: 'low', timeout: '20' });
      expect(r.code).toBe(code);
      expect(r.status().class).toBe(cls);
      expect(r.status().exit_code === 0).toBe(r.status().class === 'ok');
      expect(lanesOf(sb).l3.status).toBe(laneStatus);
    });
  }

  test('negatives: stderr transcripts, agent text and transient error events never latch quota/auth/throttle; lane unchanged', () => {
    const sb = mkSandbox();
    writeLanes(sb, { l3: { status: 'ok', reason: 'seed', next_probe_at: null, runtime_model: null, updated_at: '2026-01-01T00:00:00Z', status_since: '2026-01-01T00:00:00.000Z', consecutive_quota: 0, throttle_count: 0 },
      l2: { status: 'ok', reason: 'seed' }, l4: { status: 'ok', reason: 'seed' } });
    const l3: [string, number, string][] = [
      // stderr full of vendor-looking transcript lines, no turn.failed
      [codexStep({ completed: false, rc: 1, stderr: "ERROR: You've hit your usage limit. Try again at 3:04 PM\nError: Not logged in\nError: connection refused (429)" }), 1, 'error'],
      // the agent's own text quotes a usage-limit/login message; the turn fails for another reason
      [codexStep({ text: "fixture says: You've hit your usage limit, please login (401)", fail: 'tool call failed: exit status 1' }), 1, 'error'],
      // transient Reconnecting 429/401 notices, then the turn completes
      [codexStep({ transient: ['Reconnecting... 1/5 (unexpected status 429 Too Many Requests)', 'Reconnecting... 2/5 (401 Unauthorized)'] }), 0, 'ok'],
    ];
    for (const [body, code, cls] of l3) {
      step(sb, 'codex', body);
      const r = run(sb, { lane: 'l3', mode: 'impl', model: 'gpt-6.1-sol', effort: 'low' });
      expect({ code: r.code, cls: r.status().class }).toEqual({ code, cls });
      expect(lanesOf(sb).l3).toMatchObject({ status: 'ok', consecutive_quota: 0, throttle_count: 0 });
    }
    // l2 / l4 non-JSON failures: stderr says "not logged in" / "401" — still only `error`
    step(sb, 'claude', 'echo "Error: Not logged in · Please run /login" >&2\necho "usage limit reached" >&2\nexit 1\n');
    expect(run(sb, { lane: 'l2', mode: 'impl', model: 'claude-sonnet-5-5', effort: 'low', 'claude-dir': sb.claudeDir }).status().class).toBe('error');
    step(sb, 'grok', 'echo "401 Unauthorized: usage limit" >&2\nexit 1\n');
    expect(run(sb, { lane: 'l4', mode: 'review', model: 'grok-4.7', effort: 'low', cwd: wtAdd(sb, 'gate-neg', { detach: true }) }).status().class).toBe('error');
    // a successful Claude JSON whose BODY quotes a limit message stays ok
    step(sb, 'claude', `echo '{"type":"result","is_error":false,"result":"The UI shows: usage limit reached|1900000000, please login"}'\n`);
    expect(run(sb, { lane: 'l2', mode: 'impl', model: 'claude-sonnet-5-5', effort: 'low', 'claude-dir': sb.claudeDir }).code).toBe(0);
    expect(lanesOf(sb).l2.status).toBe('ok');
    expect(lanesOf(sb).l4.status).toBe('ok');
  }, 30_000);

});

describe('quota cooling', () => {
  const minutesAhead = (iso: string) => (Date.parse(iso) - Date.now()) / 60000;

  test('parsed "try again at <ISO>" and the human "Oct 12th, 2026 3:04 PM" form (from turn.failed)', () => {
    const sb = mkSandbox();
    const reset = new Date(Math.floor(Date.now() / 1000) * 1000 + 2 * 3600e3);
    step(sb, 'codex', codexStep({ fail: `You've hit your usage limit. Upgrade to Pro or try again at ${reset.toISOString()}.` }));
    expect(run(sb, { lane: 'l3', mode: 'impl', model: 'gpt-6.1-sol', effort: 'high' }).code).toBe(4);
    expect(Date.parse(lanesOf(sb).l3.next_probe_at)).toBe(reset.getTime());
    const sb2 = mkSandbox();
    const t = new Date(Date.now() + 3 * 3600e3);
    t.setSeconds(0, 0);
    const mon = t.toLocaleString('en-US', { month: 'short' });
    const h12 = ((t.getHours() + 11) % 12) + 1;
    const human = `${mon} ${t.getDate()}th, ${t.getFullYear()} ${h12}:${String(t.getMinutes()).padStart(2, '0')} ${t.getHours() < 12 ? 'AM' : 'PM'}`;
    step(sb2, 'codex', codexStep({ fail: `You've hit your usage limit. Try again at ${human}.` }));
    expect(run(sb2, { lane: 'l3', mode: 'impl', model: 'gpt-6.1-sol', effort: 'high' }).code).toBe(4);
    expect(Date.parse(lanesOf(sb2).l3.next_probe_at)).toBe(t.getTime());
  });

  test('unparseable reset: 15 → 30 → 60 → 60 min; a cooling lane is not invoked; an absent lane is refused; ok resets', () => {
    const sb = mkSandbox();
    step(sb, 'codex', codexStep({ fail: 'quota exceeded for this account' }));
    const base = { lane: 'l3', mode: 'impl', model: 'gpt-6.1-sol', effort: 'high' };
    const expire = () => {
      const j = lanesOf(sb);
      j.l3.next_probe_at = new Date(Date.now() - 1000).toISOString();
      j.l3.last_event_at = '2020-01-01T00:00:00.000Z';
      writeLanes(sb, j);
    };
    for (const [i, mins] of [[1, 15], [2, 30], [3, 60], [4, 60]] as const) {
      expect(run(sb, base).code).toBe(4);
      const l3 = lanesOf(sb).l3;
      expect(l3.consecutive_quota).toBe(i);
      expect(Math.abs(minutesAhead(l3.next_probe_at) - mins)).toBeLessThan(0.2);
      if (i === 1) {
        const before = calls(sb, 'codex').length;
        const r = run(sb, base);
        expect(r.status()).toMatchObject({ class: 'quota', skipped: 'cooling', exit: null });
        expect(calls(sb, 'codex').length).toBe(before);
      }
      expire();
    }
    step(sb, 'codex', OK_CODEX);
    expect(run(sb, base).code).toBe(0);
    expect(lanesOf(sb).l3).toMatchObject({ status: 'ok', consecutive_quota: 0, next_probe_at: null });
    step(sb, 'codex', codexStep({ fail: '401 Unauthorized' }));
    expect(run(sb, base).code).toBe(5);
    const n = calls(sb, 'codex').length;
    expect(run(sb, base).status()).toMatchObject({ class: 'auth', skipped: 'absent' });
    expect(calls(sb, 'codex').length).toBe(n);
  }, 30_000);

  test('E9: a late success never clears a cooldown — including one RE-ARMED while the lane already read cooling', async () => {
    const sb = mkSandbox();
    // An expired cooldown from long ago: both new attempts are allowed to start.
    writeLanes(sb, { l3: { status: 'cooling', reason: 'old quota', next_probe_at: '2020-01-01T00:15:00Z', runtime_model: null, updated_at: '2020-01-01T00:00:00Z',
      status_since: '2020-01-01T00:00:00.000Z', last_event_at: '2020-01-01T00:00:00.000Z', consecutive_quota: 1, throttle_count: 0 } });
    step(sb, 'codex', `sleep 1\n${OK_CODEX}`, 1);
    step(sb, 'codex', codexStep({ fail: "You've hit your usage limit." }), 2);
    const slow = runArgs(sb, { lane: 'l3', mode: 'impl', model: 'gpt-6.1-sol', effort: 'low' });
    const p = spawn(LANE, slow.args, { cwd: sb.dir, env: sb.env, stdio: 'ignore' });
    const done = new Promise<number | null>((resolve) => p.on('exit', (c) => resolve(c)));
    const end = Date.now() + 5000;
    while (Date.now() < end && calls(sb, 'codex').length < 1) await Bun.sleep(20);
    expect(run(sb, { lane: 'l3', mode: 'impl', model: 'gpt-6.1-sol', effort: 'low' }).code).toBe(4); // status was already "cooling"
    const rearmed = lanesOf(sb).l3;
    expect(rearmed.status).toBe('cooling');
    expect(Date.parse(rearmed.last_event_at)).toBeGreaterThan(Date.parse('2020-01-02T00:00:00Z'));
    expect(await done).toBe(0);
    const l3 = lanesOf(sb).l3;
    expect(l3.status).toBe('cooling');
    expect(l3.next_probe_at).toBe(rearmed.next_probe_at);
    expect(l3.reason).toContain('kept');
    // An attempt that starts AFTER the event (cooldown expired) does clear it.
    writeLanes(sb, { l3: { ...l3, next_probe_at: '2020-01-01T00:15:00Z' } });
    step(sb, 'codex', OK_CODEX, 3);
    expect(run(sb, { lane: 'l3', mode: 'impl', model: 'gpt-6.1-sol', effort: 'low' }).code).toBe(0);
    expect(lanesOf(sb).l3.status).toBe('ok');
  }, 30_000);
});

describe('probe', () => {
  test('probes l2/l3/l4 with the cheap defaults (l4: resolved model as explicit -m, effort low, H11) and records runtime models', () => {
    const sb = mkSandbox();
    step(sb, 'claude', `echo '{"type":"result","is_error":false,"result":"OK","modelUsage":{"claude-haiku-5-5-20261001":{"outputTokens":1}}}'\n`);
    step(sb, 'codex', codexStep({ text: 'OK', model: 'gpt-6-luna', effort: 'low' }));
    step(sb, 'grok', `echo '{"text":"OK","modelUsage":{"grok-4.7-build":{"outputTokens":1}}}'\n`);
    const r = lane(sb, ['probe', '--run-dir', sb.run, '--claude-dir', sb.claudeDir, '--json']);
    expect(r.code).toBe(0);
    const j = JSON.parse(r.out);
    expect(j.l2).toMatchObject({ status: 'ok', runtime_model: 'claude-haiku-5-5-20261001' });
    expect(j.l3).toMatchObject({ status: 'ok', runtime_model: 'gpt-6-luna' });
    expect(j.l4).toMatchObject({ status: 'ok', runtime_model: 'grok-4.7-build' });
    for (const k of ['status', 'reason', 'next_probe_at', 'runtime_model', 'updated_at', 'consecutive_quota', 'throttle_count']) expect(j.l3).toHaveProperty(k);
    const [c3] = calls(sb, 'codex');
    expect(c3.argv).toEqual(expect.arrayContaining(['--json', '--skip-git-repo-check', 'model="gpt-6-luna"', 'model_reasoning_effort="low"']));
    expect(real(c3.cwd)).toBe(real(path.join(sb.run, 'probe-cwd')));
    const [c4] = calls(sb, 'grok');
    expect(flagValue(c4.argv, '-m')).toBe('grok-4.7-build');
    expect(flagValue(c4.argv, '--reasoning-effort')).toBe('low');
    const p4 = path.join(sb.run, 'attempts', 'probe-l4');
    const s4 = JSON.parse(fs.readFileSync(path.join(p4, fs.readdirSync(p4)[0], 'out.txt.status.json'), 'utf8'));
    expect(s4.attempts[0].timeout_s).toBe(120); // the l4 probe deadline is at least 120 s (default --timeout 60)
  });

  test('skips a lane whose next_probe_at is in the future; failures → absent / short cooling', () => {
    const sb = mkSandbox();
    step(sb, 'codex', OK_CODEX);
    step(sb, 'grok', 'echo "segmentation fault" >&2\nexit 139\n');
    const until = new Date(Date.now() + 20 * 60e3).toISOString().replace(/\.\d{3}Z$/, 'Z');
    writeLanes(sb, { l3: { status: 'cooling', reason: 'quota', next_probe_at: until, runtime_model: null, updated_at: until, status_since: until, consecutive_quota: 2, throttle_count: 0 } });
    const empty = path.join(sb.dir, 'nobody');
    fs.mkdirSync(empty);
    const r = lane(sb, ['probe', '--run-dir', sb.run, '--claude-dir', empty], { GSTACK_LANE_PROBE_RETRY_S: '120' });
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/l3: cooling until .*still cooling/);
    const j = lanesOf(sb);
    expect(j.l3).toMatchObject({ status: 'cooling', next_probe_at: until, consecutive_quota: 2 });
    expect(j.l2.status).toBe('absent');
    expect(j.l4.status).toBe('cooling');
    expect(calls(sb, 'codex')).toEqual([]);
  });
});

describe('invariants across every recorded invocation', () => {
  test('no stub invocation ever received --always-approve; grok never got the prompt text in argv; codex always ran with --json', () => {
    expect(H.checkInvariants()).toBeGreaterThan(40);
  });
});
