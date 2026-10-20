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
  LANE, CONFIG, OK_CLAUDE, OK_CODEX, FIX_OK, FIX_NOAUTH, codexStep, flagValue, real, mode, makeLaneHarness, rateLimits, sq,
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

describe('v1.8.1 Codex credit guard (shared `codex` bucket, codex_allow_credit_spend)', () => {
  const GUARD = 'codex bucket exhausted (100%); credit spend not allowed — set codex_allow_credit_spend=true to allow';
  const isoS = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const resetIn = (days: number) => Math.floor(Date.now() / 1000) + Math.round(days * 86400);
  const base = { lane: 'l3', mode: 'impl', model: 'gpt-6-astra', effort: 'high' };
  const summaryOf = (sb: ReturnType<typeof mkSandbox>, out: string) => lane(sb, ['summary', '--out', out]).out.trim();
  const setConfig = (sb: ReturnType<typeof mkSandbox>, line: string) => fs.appendFileSync(path.join(sb.dir, 'state', 'config.yaml'), `${line}\n`);

  test('below 90%: the snapshot is recorded (status + lanes.json), shown on the summary line, no warning, no guard', () => {
    const sb = mkSandbox();
    const reset = resetIn(3);
    step(sb, 'codex', codexStep({ model: 'gpt-6-astra', rateLimits: [rateLimits({ used: 40, resetsAt: reset }), rateLimits({ used: 85, resetsAt: reset })] }));
    const r = run(sb, base);
    expect(r.code).toBe(0);
    const s = r.status();
    expect(s.class).toBe('ok');
    expect(s.bucket).toEqual({ limit_id: 'codex', used_percent: 85, resets_at: isoS(reset * 1000), credits_balance: 60539.758459,
      rate_limit_reached_type: null, observed_at: expect.any(String) });
    for (const k of ['bucket_warning', 'credit_guard', 'credits_spent']) expect(s).not.toHaveProperty(k);
    expect(r.err).not.toContain('warning');
    const l3 = lanesOf(sb).l3;
    expect(l3).toMatchObject({ status: 'ok', bucket: { used_percent: 85, resets_at: isoS(reset * 1000) } });
    expect(l3).not.toHaveProperty('bucket_warning');
    const line = summaryOf(sb, r.outPath);
    expect(line).toContain(`bucket=85% resets=${isoS(reset * 1000)}`);
    expect(line).not.toContain('warning');
    expect(r.out.trim()).toBe(line);
  });

  test('92%: ONE warning per bucket window (probe output first, then not again on the run); a new window warns again', () => {
    const sb = mkSandbox();
    const reset = resetIn(2);
    const warn = `codex bucket at 92%; at 100% L3 cools until ${isoS(reset * 1000)} unless codex_allow_credit_spend=true`;
    step(sb, 'codex', codexStep({ model: 'gpt-6-luna', effort: 'low', text: 'OK', rateLimits: [rateLimits({ used: 92, resetsAt: reset })] }), 1);
    const p = lane(sb, ['probe', '--run-dir', sb.run, '--lanes', 'l3']);
    expect(p.code).toBe(0);
    expect(p.out).toContain(`l3: ok`);
    expect(p.out).toContain(`bucket=92% resets=${isoS(reset * 1000)}`);
    expect(p.out).toContain(`warning: ${warn}`);
    expect(lanesOf(sb).l3).toMatchObject({ status: 'ok', bucket_warning: warn, bucket_warned: `codex@${isoS(reset * 1000)}` });
    step(sb, 'codex', codexStep({ model: 'gpt-6-astra', rateLimits: [rateLimits({ used: 93, resetsAt: reset })] }), 2);
    const r = run(sb, base);
    expect(r.code).toBe(0);
    expect(r.status()).not.toHaveProperty('bucket_warning');
    expect(r.err).not.toContain('warning');
    expect(summaryOf(sb, r.outPath)).not.toContain('warning');
    expect(lanesOf(sb).l3).not.toHaveProperty('bucket_warning'); // cleared by the next update: the probe line no longer repeats it
    step(sb, 'codex', codexStep({ model: 'gpt-6-luna', effort: 'low', text: 'OK', rateLimits: [rateLimits({ used: 94, resetsAt: reset })] }), 3);
    const p2 = lane(sb, ['probe', '--run-dir', sb.run, '--lanes', 'l3']);
    expect(p2.out).toContain('bucket=94% resets=');
    expect(p2.out).not.toContain('warning');
    const reset2 = resetIn(6);
    step(sb, 'codex', codexStep({ model: 'gpt-6-astra', rateLimits: [rateLimits({ used: 90, resetsAt: reset2 })] }), 4);
    const r2 = run(sb, base);
    expect(r2.status().bucket_warning).toBe(`codex bucket at 90%; at 100% L3 cools until ${isoS(reset2 * 1000)} unless codex_allow_credit_spend=true`);
    expect(r2.err).toContain('gstack-lane: warning: codex bucket at 90%');
    expect(summaryOf(sb, r2.outPath)).toContain(`warning: codex bucket at 90%`);
  }, 30_000);

  test('100% without the opt-in: the observing run keeps its class; L3 cools until resets_at (quota); the NEXT run is refused cooling', () => {
    const sb = mkSandbox();
    const reset = resetIn(4);
    step(sb, 'codex', codexStep({ text: 'REVIEW_COMPLETE: findings=0', model: 'gpt-6-astra', rateLimits: [rateLimits({ used: 99, resetsAt: reset }), rateLimits({ used: 100, resetsAt: reset })] }));
    const r = run(sb, { ...base, mode: 'review' });
    expect(r.code).toBe(0); // it already ran (on credits): its own result stands
    const s = r.status();
    expect(s).toMatchObject({ class: 'ok', published: true, credit_guard: 'cooling', bucket: { used_percent: 100, resets_at: isoS(reset * 1000) } });
    expect(s.lane_status).toMatchObject({ status: 'cooling', next_probe_at: isoS(reset * 1000), reason: GUARD, consecutive_quota: 1 });
    expect(r.err).toContain(GUARD);
    expect(summaryOf(sb, r.outPath)).toContain(`bucket=100% resets=${isoS(reset * 1000)} credit_guard=cooling`);
    const l3 = lanesOf(sb).l3;
    expect(l3).toMatchObject({ status: 'cooling', next_probe_at: isoS(reset * 1000), reason: GUARD });
    expect(Date.parse(l3.last_event_at)).toBeGreaterThanOrEqual(Date.parse(s.attempt_started_at));
    const n = calls(sb, 'codex').length;
    const next = run(sb, base);
    expect(next.code).toBe(4);
    expect(next.status()).toMatchObject({ class: 'quota', skipped: 'cooling', exit: null });
    expect(next.status()).not.toHaveProperty('bucket'); // nothing invoked → nothing read
    expect(calls(sb, 'codex').length).toBe(n);
    expect(lane(sb, ['adjudicate', '--out', next.outPath, '--seat', 'codex', '--gate-class', 'ordinary', '--reviewed-sha', 'a'.repeat(40), '--requested-model', 'gpt-6-astra']).out)
      .toContain('VERDICT=ABSENT reason=quota_skipped_cooling');
    // the probe sees it too and does not hammer the lane
    const p = lane(sb, ['probe', '--run-dir', sb.run, '--lanes', 'l3']);
    expect(p.out).toMatch(new RegExp(`l3: cooling until ${isoS(reset * 1000)} — still cooling.*bucket=100% resets=`));
    expect(calls(sb, 'codex').length).toBe(n);
    // a usage-limit reached type alone triggers it; a hand-edited non-literal opt-in does not count
    const sb2 = mkSandbox();
    setConfig(sb2, 'codex_allow_credit_spend: yes');
    step(sb2, 'codex', codexStep({ model: 'gpt-6-luna', effort: 'low', text: 'OK', rateLimits: [rateLimits({ used: 97, resetsAt: reset, reached: 'workspace_member_usage_limit_reached' })] }));
    expect(lane(sb2, ['probe', '--run-dir', sb2.run, '--lanes', 'l3']).out).toContain(`l3: cooling until ${isoS(reset * 1000)}`);
    expect(lanesOf(sb2).l3).toMatchObject({ status: 'cooling', reason: GUARD, next_probe_at: isoS(reset * 1000) });
  }, 30_000);

  test('100% WITH codex_allow_credit_spend=true: no cooling, the next run is invoked', () => {
    const sb = mkSandbox();
    setConfig(sb, 'codex_allow_credit_spend: true');
    const reset = resetIn(4);
    step(sb, 'codex', codexStep({ model: 'gpt-6-astra', rateLimits: [rateLimits({ used: 100, resetsAt: reset })] }));
    const r = run(sb, base);
    expect(r.code).toBe(0);
    expect(r.status()).toMatchObject({ class: 'ok', credit_guard: 'allowed' });
    expect(r.err).toContain('codex_allow_credit_spend=true');
    expect(lanesOf(sb).l3).toMatchObject({ status: 'ok', next_probe_at: null, consecutive_quota: 0, bucket: { used_percent: 100 } });
    const n = calls(sb, 'codex').length;
    expect(run(sb, base).code).toBe(0);
    expect(calls(sb, 'codex').length).toBe(n + 1);
  }, 30_000);

  test('missing or malformed rate_limits (older codex): recorded unknown, no guard, never a failure; a known record is not erased', () => {
    const sb = mkSandbox();
    step(sb, 'codex', codexStep({ model: 'gpt-6-astra' }), 1);
    const r = run(sb, base);
    expect(r.code).toBe(0);
    const unknown = { limit_id: 'unknown', used_percent: 'unknown', resets_at: 'unknown', credits_balance: 'unknown', rate_limit_reached_type: 'unknown', observed_at: 'unknown' };
    expect(r.status().bucket).toEqual(unknown);
    expect(r.status()).not.toHaveProperty('credit_guard');
    expect(lanesOf(sb).l3).toMatchObject({ status: 'ok', bucket: unknown });
    expect(summaryOf(sb, r.outPath)).not.toContain('bucket=');
    // malformed: not JSON, rate_limits not an object, a non-numeric used_percent, no primary at all → all skipped
    step(sb, 'codex', codexStep({ model: 'gpt-6-astra', rateLimits: ['{"type":"event_msg","payload":{"rate_limits":', JSON.stringify({ type: 'event_msg', payload: { rate_limits: 'x' } }),
      { limit_id: 'codex', primary: { used_percent: 'lots', resets_at: 'soon' } }, { limit_id: 'codex' }] }), 2);
    const m = run(sb, base);
    expect(m.code).toBe(0);
    expect(m.status()).toMatchObject({ class: 'ok', bucket: unknown });
    expect(m.err).toContain('credit guard is blind');
    expect(m.status()).not.toHaveProperty('credit_guard');
    expect(lanesOf(sb).l3.status).toBe('ok');
    // a known snapshot, then a run without one: lanes.json keeps the known record; the status says unknown
    const reset = resetIn(3);
    step(sb, 'codex', codexStep({ model: 'gpt-6-astra', rateLimits: [rateLimits({ used: 30, resetsAt: reset })] }), 3);
    expect(run(sb, base).code).toBe(0);
    step(sb, 'codex', codexStep({ model: 'gpt-6-astra' }), 4);
    const k = run(sb, base);
    expect(k.status().bucket).toEqual(unknown);
    expect(lanesOf(sb).l3.bucket).toMatchObject({ used_percent: 30, resets_at: isoS(reset * 1000) });
    // another bucket id (e.g. "premium") never triggers the codex guard
    step(sb, 'codex', codexStep({ model: 'gpt-6-astra', rateLimits: [rateLimits({ used: 100, resetsAt: reset, limitId: 'premium' })] }), 5);
    const o = run(sb, base);
    expect(o.status()).toMatchObject({ bucket: { limit_id: 'premium', used_percent: 100 } });
    expect(o.status()).not.toHaveProperty('credit_guard');
    expect(lanesOf(sb).l3.status).toBe('ok');
  }, 30_000);

  test('event ordering: a later/active longer cooldown is never shortened, a newer event is kept, absent is never replaced', () => {
    const reset = resetIn(3);
    // (a) a concurrent attempt records a LONGER quota cooldown while this one runs (after it began)
    const sb = mkSandbox();
    const longer = isoS((reset + 2 * 86400) * 1000);
    const newer = { l3: { status: 'cooling', reason: 'quota (reset parsed from CLI output)', next_probe_at: longer, runtime_model: null, updated_at: isoS(Date.now()),
      status_since: new Date(Date.now() + 60_000).toISOString(), last_event_at: new Date(Date.now() + 60_000).toISOString(), consecutive_quota: 1, throttle_count: 0 } };
    step(sb, 'codex', `printf '%s' ${sq(JSON.stringify(newer))} > ${sq(path.join(sb.run, 'lanes.json'))}\n${codexStep({ model: 'gpt-6-astra', rateLimits: [rateLimits({ used: 100, resetsAt: reset })] })}`);
    const r = run(sb, base);
    expect(r.code).toBe(0);
    expect(r.status().credit_guard).toBe('kept');
    expect(lanesOf(sb).l3).toMatchObject({ status: 'cooling', next_probe_at: longer, last_event_at: newer.l3.last_event_at });
    // (b) this attempt's own quota parsed a LATER reset than the bucket's: the longer one stands
    const sb2 = mkSandbox();
    const far = new Date((reset + 86400) * 1000);
    step(sb2, 'codex', codexStep({ model: 'gpt-6-astra', fail: `You've hit your usage limit. Try again at ${far.toISOString()}.`, rateLimits: [rateLimits({ used: 100, resetsAt: reset })] }));
    const q = run(sb2, base);
    expect(q.code).toBe(4);
    expect(q.status()).toMatchObject({ class: 'quota', credit_guard: 'kept' });
    expect(lanesOf(sb2).l3).toMatchObject({ status: 'cooling', next_probe_at: isoS(far.getTime()), consecutive_quota: 1 });
    // (c) an earlier quota reset than the bucket's is EXTENDED to resets_at (counted once)
    const sb3 = mkSandbox();
    const soon = new Date(Date.now() + 3600e3);
    step(sb3, 'codex', codexStep({ model: 'gpt-6-astra', fail: `You've hit your usage limit. Try again at ${soon.toISOString()}.`, rateLimits: [rateLimits({ used: 100, resetsAt: reset })] }));
    expect(run(sb3, base).code).toBe(4);
    expect(lanesOf(sb3).l3).toMatchObject({ status: 'cooling', next_probe_at: isoS(reset * 1000), consecutive_quota: 1, reason: GUARD });
    // (d) an auth failure in the same attempt: absent is never replaced by the guard's cooling
    const sb4 = mkSandbox();
    step(sb4, 'codex', codexStep({ model: 'gpt-6-astra', fail: '401 Unauthorized', rateLimits: [rateLimits({ used: 100, resetsAt: reset })] }));
    expect(run(sb4, base).code).toBe(5);
    expect(lanesOf(sb4).l3.status).toBe('absent');
  }, 30_000);

  test('credits spent: reported from the balance drop between two snapshots of the same window (across runs, and within one)', () => {
    const sb = mkSandbox();
    const reset = resetIn(3);
    step(sb, 'codex', codexStep({ model: 'gpt-6-astra', rateLimits: [rateLimits({ used: 50, resetsAt: reset, balance: '60540.0000000000' })] }), 1);
    const a = run(sb, base);
    expect(a.status()).not.toHaveProperty('credits_spent');
    step(sb, 'codex', codexStep({ model: 'gpt-6-astra', rateLimits: [rateLimits({ used: 51, resetsAt: reset, balance: '60536.7500000000' })] }), 2);
    const b = run(sb, base);
    expect(b.status().credits_spent).toBe(3.25);
    expect(b.err).toContain('codex credits spent: 3.25');
    expect(summaryOf(sb, b.outPath)).toContain('credits spent: 3.25');
    expect(lanesOf(sb).l3.bucket).toMatchObject({ credits_balance: 60536.75, credits_spent: 3.25 });
    // a new window is a new baseline: no delta even though the balance moved
    const reset2 = resetIn(6);
    step(sb, 'codex', codexStep({ model: 'gpt-6-astra', rateLimits: [rateLimits({ used: 1, resetsAt: reset2, balance: '60530.0000000000' })] }), 3);
    const c = run(sb, base);
    expect(c.status()).not.toHaveProperty('credits_spent');
    expect(lanesOf(sb).l3.bucket).not.toHaveProperty('credits_spent');
    // within ONE invocation (no earlier record in this window), the first snapshot is the baseline
    const sb2 = mkSandbox();
    setConfig(sb2, 'codex_allow_credit_spend: true');
    step(sb2, 'codex', codexStep({ model: 'gpt-6-astra', rateLimits: [rateLimits({ used: 100, resetsAt: reset, balance: '100.5' }), rateLimits({ used: 100, resetsAt: reset, balance: '99.25' })] }));
    const d = run(sb2, base);
    expect(d.status()).toMatchObject({ credits_spent: 1.25, credit_guard: 'allowed' });
    const line = summaryOf(sb2, d.outPath);
    expect(line).toContain('bucket=100% resets=');
    expect(line).toContain('credit_guard=allowed credits spent: 1.25');
    expect(JSON.stringify(d.status()) + line + d.err).not.toContain('SECRET-TOKEN-123');
  }, 30_000);
});

describe('v1.8.1 credit guard — fail-closed paths (review round c1)', () => {
  const GUARD = 'codex bucket exhausted (100%); credit spend not allowed — set codex_allow_credit_spend=true to allow';
  const isoS = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const resetIn = (days: number) => Math.floor(Date.now() / 1000) + Math.round(days * 86400);
  const base = { lane: 'l3', mode: 'impl', model: 'gpt-6-astra', effort: 'high' };
  // A codex invocation that writes its rollout + thread.started, then hangs past the deadline.
  const hang = (used: number, reset: number) => codexStep({ model: 'gpt-6-astra', completed: false, text: null, rateLimits: [rateLimits({ used, resetsAt: reset })] })
    .replace(/exit 0\n$/, 'sleep 20\nexit 0\n');

  test('a trailing malformed / partial snapshot never supersedes an earlier VALID exhausted one', () => {
    const sb = mkSandbox();
    const reset = resetIn(3);
    step(sb, 'codex', codexStep({ model: 'gpt-6-astra', rateLimits: [rateLimits({ used: 100, resetsAt: reset }), { limit_id: 'codex' },
      { limit_id: 'codex', primary: { used_percent: 'n/a' } }, '{"type":"event_msg","payload":{"rate_limits":{"limit_id":"codex","primary":{"used_percent":5',
      JSON.stringify({ type: 'event_msg', payload: { rate_limits: null } })] }));
    const r = run(sb, base);
    expect(r.code).toBe(0);
    expect(r.status()).toMatchObject({ credit_guard: 'cooling', bucket: { used_percent: 100, resets_at: isoS(reset * 1000) } });
    expect(lanesOf(sb).l3).toMatchObject({ status: 'cooling', next_probe_at: isoS(reset * 1000), reason: GUARD });
  });

  test('resets_at "0" / 0 / past / garbage / lenient-date / absent / > 8 days at 100%: FAIL CLOSED for the bounded fallback; strict s, ms and ISO are honoured', () => {
    const past = Math.floor(Date.now() / 1000) - 3600;
    for (const ra of ['0', 0, past, String(past), 'garbage', 'Oct 12', '2026-13-45T99:00:00Z', 1e15, null, resetIn(30)] as (string | number | null)[]) {
      const sb = mkSandbox();
      const rl = rateLimits({ used: 100, resetsAt: null }) as { primary: Record<string, unknown> };
      if (ra !== null) rl.primary.resets_at = ra;
      step(sb, 'codex', codexStep({ model: 'gpt-6-astra', rateLimits: [rl] }));
      const r = run(sb, base, [], { GSTACK_LANE_BUCKET_FALLBACK_S: '7200' });
      expect({ ra, code: r.code, guard: r.status().credit_guard }).toEqual({ ra, code: 0, guard: 'cooling' });
      const l3 = lanesOf(sb).l3;
      expect({ ra, status: l3.status }).toEqual({ ra, status: 'cooling' });
      expect(Math.abs((Date.parse(l3.next_probe_at) - Date.now()) / 1000 - 7200)).toBeLessThan(60);
      expect(l3.reason).toBe(`${GUARD} (resets_at unknown, past or implausible: bounded 7200 s cooldown)`);
      expect(run(sb, base).code).toBe(4); // and the next run is refused
    }
    const reset = resetIn(2);
    const micro = new Date(reset * 1000).toISOString().replace('.000Z', '.123456Z');
    for (const ra of [reset * 1000, String(reset), String(reset * 1000), micro]) {
      const sb = mkSandbox();
      const rl = rateLimits({ used: 100, resetsAt: null }) as { primary: Record<string, unknown> };
      rl.primary.resets_at = ra;
      step(sb, 'codex', codexStep({ model: 'gpt-6-astra', rateLimits: [rl] }));
      expect(run(sb, base).code).toBe(0);
      expect({ ra, next: lanesOf(sb).l3.next_probe_at, reason: lanesOf(sb).l3.reason }).toEqual({ ra, next: isoS(reset * 1000), reason: GUARD });
    }
  }, 90_000);

  test('mid-attempt exhaustion: no timeout step-down and no throttle retry once an invocation shows 100% (below 100% still retries)', () => {
    const reset = resetIn(3);
    const review = { ...base, mode: 'review', timeout: '2', 'retry-timeout': '2' };
    const sb = mkSandbox();
    step(sb, 'codex', hang(100, reset));
    const r = run(sb, review);
    expect(r.code).toBe(124);
    expect(r.status()).toMatchObject({ class: 'timeout', timeout_retry: false, retry_suppressed: 'credit-guard', credit_guard: 'cooling' });
    expect(calls(sb, 'codex').length).toBe(1);
    expect(lanesOf(sb).l3).toMatchObject({ status: 'cooling', next_probe_at: isoS(reset * 1000), reason: GUARD });
    const ctl = mkSandbox();
    step(ctl, 'codex', hang(50, reset));
    const c = run(ctl, review);
    expect(c.status()).toMatchObject({ class: 'timeout', timeout_retry: true });
    expect(c.status()).not.toHaveProperty('retry_suppressed');
    expect(calls(ctl, 'codex').length).toBe(2);
    // throttle backoff retries
    const env = { GSTACK_LANE_THROTTLE_RETRIES: '2' };
    const sb2 = mkSandbox();
    step(sb2, 'codex', codexStep({ model: 'gpt-6-astra', fail: '429 Too Many Requests', rateLimits: [rateLimits({ used: 100, resetsAt: reset })] }));
    const t = run(sb2, base, [], env);
    expect(t.code).toBe(3);
    expect(t.status()).toMatchObject({ class: 'throttle', retry_suppressed: 'credit-guard', credit_guard: 'cooling' });
    expect(calls(sb2, 'codex').length).toBe(1);
    const ctl2 = mkSandbox();
    step(ctl2, 'codex', codexStep({ model: 'gpt-6-astra', fail: '429 Too Many Requests', rateLimits: [rateLimits({ used: 50, resetsAt: reset })] }));
    expect(run(ctl2, base, [], env).code).toBe(3);
    expect(calls(ctl2, 'codex').length).toBe(3);
  }, 60_000);

  test('review P2s: rate_limit_reached counts; an "older" own snapshot still guards; a newer SHORTER cooling is extended; an unthreaded rollout is still read (bucket only)', () => {
    const reset = resetIn(3);
    const sb = mkSandbox();
    step(sb, 'codex', codexStep({ model: 'gpt-6-astra', rateLimits: [rateLimits({ used: 99, resetsAt: reset, reached: 'rate_limit_reached' })] }));
    expect(run(sb, base).status().credit_guard).toBe('cooling');
    expect(lanesOf(sb).l3.status).toBe('cooling');
    // a recorded bucket observed "later" keeps the record, but this attempt's own 100% still cools
    const sb2 = mkSandbox();
    writeLanes(sb2, { l3: { status: 'ok', reason: 'ok', next_probe_at: null, runtime_model: null, updated_at: '2020-01-01T00:00:00Z', status_since: '2020-01-01T00:00:00.000Z',
      last_event_at: null, consecutive_quota: 0, throttle_count: 0,
      bucket: { limit_id: 'codex', used_percent: 50, resets_at: isoS(reset * 1000), credits_balance: 1, rate_limit_reached_type: null, observed_at: isoS(Date.now() + 3600e3) } } });
    step(sb2, 'codex', codexStep({ model: 'gpt-6-astra', rateLimits: [rateLimits({ used: 100, resetsAt: reset })] }));
    expect(run(sb2, base).status().credit_guard).toBe('cooling');
    expect(lanesOf(sb2).l3).toMatchObject({ status: 'cooling', next_probe_at: isoS(reset * 1000), bucket: { used_percent: 50 } });
    // a concurrent, NEWER but SHORTER quota cooldown is extended to the bucket reset (never shortened, never cleared)
    const sb3 = mkSandbox();
    const newer = { l3: { status: 'cooling', reason: 'quota (reset unknown; backoff 15m)', next_probe_at: isoS(Date.now() + 15 * 60e3), runtime_model: null, updated_at: isoS(Date.now()),
      status_since: new Date(Date.now() + 60_000).toISOString(), last_event_at: new Date(Date.now() + 60_000).toISOString(), consecutive_quota: 1, throttle_count: 0 } };
    step(sb3, 'codex', `printf '%s' ${sq(JSON.stringify(newer))} > ${sq(path.join(sb3.run, 'lanes.json'))}\n${codexStep({ model: 'gpt-6-astra', rateLimits: [rateLimits({ used: 100, resetsAt: reset })] })}`);
    expect(run(sb3, base).status().credit_guard).toBe('cooling');
    expect(lanesOf(sb3).l3).toMatchObject({ status: 'cooling', next_probe_at: isoS(reset * 1000), reason: GUARD, consecutive_quota: 1 });
    // no thread.started: the fresh home's rollout is still read for the bucket, never for runtime_model
    const sb4 = mkSandbox();
    step(sb4, 'codex', codexStep({ model: 'gpt-6-astra', rateLimits: [rateLimits({ used: 100, resetsAt: reset })] }).split('\n').filter((l) => !l.includes('thread.started')).join('\n'));
    const u = run(sb4, base);
    expect(u.status()).toMatchObject({ runtime_model: null, runtime_model_source: 'none', credit_guard: 'cooling' });
    expect(fs.existsSync(`${u.outPath}.logs/inv-1/rollout.unthreaded.jsonl`)).toBe(true);
    expect(fs.existsSync(`${u.outPath}.logs/inv-1/rollout.jsonl`)).toBe(false);
    expect(lanesOf(sb4).l3.status).toBe('cooling');
  }, 60_000);
});

describe('v1.8.1 credit guard — lanes.json bucket_guard is the only state (review round c2)', () => {
  const GUARD = 'codex bucket exhausted (100%); credit spend not allowed — set codex_allow_credit_spend=true to allow';
  const isoS = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const resetIn = (days: number) => Math.floor(Date.now() / 1000) + Math.round(days * 86400);
  const base = { lane: 'l3', mode: 'impl', model: 'gpt-6-astra', effort: 'high' };
  const guarded = (status: string, until: string, extra: Record<string, unknown> = {}) => ({ l3: { status, reason: status === 'absent' ? 'auth: x' : 'ok (impl)',
    next_probe_at: null, runtime_model: null, updated_at: '2020-01-01T00:00:00Z', status_since: '2020-01-01T00:00:00.000Z', last_event_at: null, consecutive_quota: 0,
    throttle_count: 0, bucket_guard: { exhausted_until: until, reason: GUARD, set_at: '2020-01-01T00:00:00.000Z' }, ...extra } });
  const sideFiles = (sb: ReturnType<typeof mkSandbox>) => fs.readdirSync(sb.run).filter((f) => !['attempts', 'lanes.lock', 'lanes.json', 'lanes.json.hashes', 'probe-cwd'].includes(f));

  test('probe, --json and _probe-lane refuse while a guard is enforced, whatever `status` says', () => {
    const sb = mkSandbox();
    const until = isoS(resetIn(2) * 1000);
    writeLanes(sb, guarded('ok', until));
    step(sb, 'codex', codexStep({ model: 'gpt-6-luna', effort: 'low', text: 'OK' }));
    const p = lane(sb, ['probe', '--run-dir', sb.run, '--lanes', 'l3']);
    expect(p.out).toContain(`l3: cooling until ${until} — still cooling (skipped, not probed)`);
    expect(p.out).toContain(`credit guard: bucket exhausted until ${until} (status ok)`);
    const j = JSON.parse(lane(sb, ['probe', '--run-dir', sb.run, '--lanes', 'l3', '--json']).out);
    expect(j.l3).toMatchObject({ status: 'ok', effective: { status: 'cooling', cooling_active: true, next_probe_at: until, credit_guard: 'enforced', exhausted_until: until } });
    const d = lane(sb, ['_probe-lane', '--run-dir', sb.run, '--lane', 'l3']);
    expect(d.code).toBe(4);
    expect(calls(sb, 'codex')).toEqual([]);
    const r = run(sb, base);
    expect(r.code).toBe(4);
    expect(r.status()).toMatchObject({ class: 'quota', skipped: 'cooling', class_detail: `credit guard: codex bucket exhausted until ${until}` });
    expect(calls(sb, 'codex')).toEqual([]);
    expect(sideFiles(sb)).toEqual([]);
  });

  test('auth failure + exhausted bucket: the guard is still recorded, and absent never masks it', () => {
    const sb = mkSandbox();
    const reset = resetIn(3);
    step(sb, 'codex', codexStep({ model: 'gpt-6-astra', fail: '401 Unauthorized', rateLimits: [rateLimits({ used: 100, resetsAt: reset })] }));
    const r = run(sb, base);
    expect(r.code).toBe(5);
    expect(r.status()).toMatchObject({ class: 'auth', credit_guard: 'recorded' });
    expect(lanesOf(sb).l3).toMatchObject({ status: 'absent', bucket_guard: { exhausted_until: isoS(reset * 1000), reason: GUARD } });
    const n = calls(sb, 'codex').length;
    const next = run(sb, base);
    expect(next.code).toBe(4); // refused as cooling (the guard), not merely absent
    expect(next.status()).toMatchObject({ class: 'quota', skipped: 'cooling' });
    expect(lane(sb, ['probe', '--run-dir', sb.run, '--lanes', 'l3']).out).toContain('still cooling (skipped, not probed)');
    expect(calls(sb, 'codex').length).toBe(n);
    expect(lanesOf(sb).l3.status).toBe('absent');
    // an expired guard over absent: back to the plain absent refusal
    writeLanes(sb, guarded('absent', isoS(Date.now() - 1000)));
    expect(run(sb, base).code).toBe(5);
  });

  test('a retry is refused once ANOTHER attempt recorded exhaustion (shared lanes.json re-read before every invocation)', () => {
    const sb = mkSandbox();
    const until = isoS(resetIn(2) * 1000);
    // invocation 1 (this attempt) sees 50% and is throttled; meanwhile "attempt B" records the guard (set AFTER that reading)
    const later = (st: string) => { const j = guarded(st, until); j.l3.bucket_guard.set_at = new Date(Date.now() + 60_000).toISOString(); return j; };
    step(sb, 'codex', `printf '%s' ${sq(JSON.stringify(later('ok')))} > ${sq(path.join(sb.run, 'lanes.json'))}\n${codexStep({ model: 'gpt-6-astra', fail: '429 Too Many Requests', rateLimits: [rateLimits({ used: 50, resetsAt: resetIn(2) })] })}`, 1);
    step(sb, 'codex', OK_CODEX, 2);
    const r = run(sb, base, [], { GSTACK_LANE_THROTTLE_RETRIES: '2' });
    expect(calls(sb, 'codex').length).toBe(1);
    expect(r.code).toBe(4);
    expect(r.status()).toMatchObject({ class: 'quota', retry_suppressed: 'lane-cooling' });
    expect(r.status().class_detail).toContain(`credit guard: codex bucket exhausted until ${until}`);
    expect(lanesOf(sb).l3.bucket_guard.exhausted_until).toBe(until);
    // a review timeout step-down is refused the same way
    const sb2 = mkSandbox();
    step(sb2, 'codex', `printf '%s' ${sq(JSON.stringify(later('ok')))} > ${sq(path.join(sb2.run, 'lanes.json'))}\n` +
      codexStep({ model: 'gpt-6-astra', completed: false, text: null, rateLimits: [rateLimits({ used: 50, resetsAt: resetIn(2) })] }).replace(/exit 0\n$/, 'sleep 20\nexit 0\n'));
    const t = run(sb2, { ...base, mode: 'review', timeout: '2', 'retry-timeout': '2' });
    expect(calls(sb2, 'codex').length).toBe(1);
    expect(t.code).toBe(4);
    expect(t.status()).toMatchObject({ class: 'quota', retry_suppressed: 'lane-cooling' });
  }, 30_000);

  test('codex_allow_credit_spend=true lifts an existing guard and the guard\'s own cooldown; the record is kept and reported', () => {
    const sb = mkSandbox();
    const reset = resetIn(3);
    step(sb, 'codex', codexStep({ model: 'gpt-6-astra', rateLimits: [rateLimits({ used: 100, resetsAt: reset })] }), 1);
    expect(run(sb, base).code).toBe(0);
    expect(lanesOf(sb).l3).toMatchObject({ status: 'cooling', reason: GUARD, bucket_guard: { exhausted_until: isoS(reset * 1000) } });
    fs.appendFileSync(path.join(sb.dir, 'state', 'config.yaml'), 'codex_allow_credit_spend: true\n');
    const p = lane(sb, ['probe', '--run-dir', sb.run, '--lanes', 'l3', '--json']);
    expect(JSON.parse(p.out).l3.effective).toMatchObject({ credit_guard: 'lifted', cooling_active: false });
    step(sb, 'codex', codexStep({ model: 'gpt-6-astra', rateLimits: [rateLimits({ used: 100, resetsAt: reset })] }));
    const r = run(sb, base);
    expect(r.code).toBe(0);
    expect(r.status()).toMatchObject({ credit_guard_lifted: true, credit_guard: 'allowed' });
    const line = lane(sb, ['summary', '--out', r.outPath]).out;
    expect(line).toContain('credit_guard_lifted=codex_allow_credit_spend');
    expect(lanesOf(sb).l3).toMatchObject({ status: 'ok', bucket_guard: { exhausted_until: isoS(reset * 1000) } }); // record kept
    expect(lane(sb, ['probe', '--run-dir', sb.run, '--lanes', 'l3']).out).toContain('credit guard LIFTED by codex_allow_credit_spend=true');
    // opt-in off again: the kept record is enforced at once
    fs.writeFileSync(path.join(sb.dir, 'state', 'config.yaml'), 'grok_reviews: enabled\n');
    const n = calls(sb, 'codex').length;
    expect(run(sb, base).code).toBe(4);
    expect(calls(sb, 'codex').length).toBe(n);
  }, 30_000);

  test('the fallback deadline is persisted ONCE and never extended by reads; FALLBACK_S is floored at 60 s', async () => {
    const sb = mkSandbox();
    step(sb, 'codex', codexStep({ model: 'gpt-6-astra', rateLimits: [rateLimits({ used: 100, resetsAt: null })] }));
    expect(run(sb, base, [], { GSTACK_LANE_BUCKET_FALLBACK_S: '7200' }).code).toBe(0);
    const g = lanesOf(sb).l3.bucket_guard.exhausted_until;
    expect(Math.abs((Date.parse(g) - Date.now()) / 1000 - 7200)).toBeLessThan(60);
    for (let i = 0; i < 2; i++) {
      await Bun.sleep(1100);
      expect(run(sb, base, [], { GSTACK_LANE_BUCKET_FALLBACK_S: '7200' }).code).toBe(4);
      lane(sb, ['probe', '--run-dir', sb.run, '--lanes', 'l3', '--json'], { GSTACK_LANE_BUCKET_FALLBACK_S: '7200' });
      lane(sb, ['_probe-lane', '--run-dir', sb.run, '--lane', 'l3'], { GSTACK_LANE_BUCKET_FALLBACK_S: '7200' });
    }
    expect(lanesOf(sb).l3.bucket_guard.exhausted_until).toBe(g);
    expect(lanesOf(sb).l3.next_probe_at).toBe(g);
    const sb2 = mkSandbox();
    step(sb2, 'codex', codexStep({ model: 'gpt-6-astra', rateLimits: [rateLimits({ used: 100, resetsAt: null })] }));
    expect(run(sb2, base, [], { GSTACK_LANE_BUCKET_FALLBACK_S: '5' }).code).toBe(0);
    const s2 = (Date.parse(lanesOf(sb2).l3.bucket_guard.exhausted_until) - Date.now()) / 1000;
    expect(s2).toBeGreaterThan(50);
    expect(s2).toBeLessThan(70);
  }, 60_000);

  test('lock busy: the attempt keeps its own class (ok stays ok; an INVALID review stays INVALID), credit_guard=unpersisted, loudly, NO side file', async () => {
    const sb = mkSandbox();
    fs.mkdirSync(sb.run, { recursive: true });
    const reset = resetIn(3);
    step(sb, 'codex', codexStep({ model: 'gpt-6-astra', rateLimits: [rateLimits({ used: 100, resetsAt: reset })] }));
    const holder = spawn('/usr/bin/perl', ['-MFcntl=:flock', '-e', 'open(my $f, ">>", $ARGV[0]) or die; flock($f, LOCK_EX) or die; $| = 1; print "locked\n"; sleep $ARGV[1];',
      path.join(sb.run, 'lanes.lock'), '25'], { stdio: ['ignore', 'pipe', 'ignore'], timeout: 40_000 });
    const gone = new Promise((res) => holder.on('exit', res));
    await new Promise<void>((res, rej) => { holder.stdout!.once('data', () => res()); setTimeout(() => rej(new Error('lock holder never locked')), 5000); });
    let r: ReturnType<typeof run>, bad: ReturnType<typeof run>;
    // a completed-but-INVALID review (empty body → class error) in the same contention
    const sbBad = mkSandbox();
    step(sbBad, 'codex', codexStep({ model: 'gpt-6-astra', text: '   ', rateLimits: [rateLimits({ used: 100, resetsAt: reset })] }));
    fs.mkdirSync(sbBad.run, { recursive: true });
    const holder2 = spawn('/usr/bin/perl', ['-MFcntl=:flock', '-e', 'open(my $f, ">>", $ARGV[0]) or die; flock($f, LOCK_EX) or die; $| = 1; print "locked\n"; sleep $ARGV[1];',
      path.join(sbBad.run, 'lanes.lock'), '25'], { stdio: ['ignore', 'pipe', 'ignore'], timeout: 40_000 });
    const gone2 = new Promise((res) => holder2.on('exit', res));
    await new Promise<void>((res, rej) => { holder2.stdout!.once('data', () => res()); setTimeout(() => rej(new Error('lock holder never locked')), 5000); });
    try {
      r = run(sb, base, [], { GSTACK_LANE_LOCK_WAIT_S: '1' });
      bad = run(sbBad, { ...base, mode: 'review' }, [], { GSTACK_LANE_LOCK_WAIT_S: '1' });
    } finally {
      holder.kill('SIGKILL');
      holder2.kill('SIGKILL');
    }
    await gone;
    await gone2;
    expect(r.code).toBe(0);
    expect(r.status()).toMatchObject({ class: 'ok', exit_code: 0, lane_update: 'pending', credit_guard: 'unpersisted' });
    expect(r.err).toContain('ERROR: Codex bucket exhausted but the credit guard could not persist');
    expect(lane(sb, ['summary', '--out', r.outPath]).out).toContain('credit_guard=unpersisted');
    expect(bad.code).toBe(1);
    expect(bad.status()).toMatchObject({ class: 'error', class_detail: 'empty review body', credit_guard: 'unpersisted' });
    expect(lane(sbBad, ['adjudicate', '--out', bad.outPath, '--seat', 'codex', '--gate-class', 'ordinary', '--reviewed-sha', 'a'.repeat(40), '--requested-model', 'gpt-6-astra']).out)
      .toContain('VERDICT=INVALID reason=class_error');
    expect(sideFiles(sbBad)).toEqual([]);
    expect(sideFiles(sb)).toEqual([]);
    expect(fs.existsSync(path.join(sb.run, 'lanes.json'))).toBe(false);
    // the documented residual: with the lock free again, the next attempt runs ONE invocation and records the guard
    expect(run(sb, base).code).toBe(0);
    expect(lanesOf(sb).l3).toMatchObject({ status: 'cooling', bucket_guard: { exhausted_until: isoS(reset * 1000) } });
    expect(run(sb, base).code).toBe(4);
  }, 60_000);

  test('a SIGTERM\'d attempt still persists its invocation\'s exhausted snapshot', async () => {
    const sb = mkSandbox();
    const reset = resetIn(3);
    step(sb, 'codex', codexStep({ model: 'gpt-6-astra', completed: false, text: null, rateLimits: [rateLimits({ used: 100, resetsAt: reset })] }).replace(/exit 0\n$/, 'sleep 20\nexit 0\n'));
    const a = runArgs(sb, base);
    const p = spawn(LANE, a.args, { cwd: sb.dir, env: sb.env, stdio: 'ignore', timeout: 30_000 });
    const done = new Promise((res) => p.on('exit', res));
    const end = Date.now() + 8000;
    while (Date.now() < end && calls(sb, 'codex').length < 1) await Bun.sleep(50);
    await Bun.sleep(500);
    p.kill('SIGTERM');
    await done;
    expect(lanesOf(sb).l3.bucket_guard).toMatchObject({ exhausted_until: isoS(reset * 1000), reason: GUARD });
    expect(run(sb, base).code).toBe(4);
    expect(calls(sb, 'codex').length).toBe(1);
  }, 30_000);
});

describe('v1.8.1 credit guard — observation timestamps, cancel window, once-only deadline (review round c3)', () => {
  const GUARD = 'codex bucket exhausted (100%); credit spend not allowed — set codex_allow_credit_spend=true to allow';
  const isoS = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const resetIn = (days: number) => Math.floor(Date.now() / 1000) + Math.round(days * 86400);
  const base = { lane: 'l3', mode: 'impl', model: 'gpt-6-astra', effort: 'high' };
  const rec = (rl: object, ts?: string) => JSON.stringify({ ...(ts ? { timestamp: ts } : {}), type: 'event_msg', payload: { type: 'token_count', info: null, rate_limits: rl } });

  test('a below-100% reading clears the guard ONLY with a real rollout timestamp strictly newer than the exhausting observation — any lane status', () => {
    const sb = mkSandbox();
    fs.appendFileSync(path.join(sb.dir, 'state', 'config.yaml'), 'codex_allow_credit_spend: true\n'); // runs allowed, so readings arrive
    const until = isoS(resetIn(2) * 1000);
    const T = new Date(Date.now() - 60_000).toISOString();
    writeLanes(sb, { l3: { status: 'absent', reason: 'auth: x', next_probe_at: null, runtime_model: null, updated_at: '2020-01-01T00:00:00Z', status_since: '2020-01-01T00:00:00.000Z',
      last_event_at: null, consecutive_quota: 0, throttle_count: 0, bucket_guard: { exhausted_until: until, reason: GUARD, set_at: T, observed_at: T } } });
    const low = rateLimits({ used: 50, resetsAt: resetIn(2) });
    // status absent: an OLDER dated reading (via the probe, which still probes an absent lane) never clears
    step(sb, 'codex', codexStep({ model: 'gpt-6-luna', effort: 'low', text: 'OK', rateLimits: [rec(low, new Date(Date.now() - 3600e3).toISOString())] }), 1);
    expect(lane(sb, ['_probe-lane', '--run-dir', sb.run, '--lane', 'l3']).code).toBe(0);
    expect(lanesOf(sb).l3.bucket_guard).toMatchObject({ exhausted_until: until, observed_at: T });
    // an UNDATED reading never clears (its observed_at is "unknown", never synthesized)
    step(sb, 'codex', codexStep({ model: 'gpt-6-astra', rateLimits: [rec(low)] }), 2);
    const u = run(sb, base);
    expect(u.status().bucket.observed_at).toBe('unknown');
    expect(lanesOf(sb).l3.bucket_guard).toMatchObject({ exhausted_until: until });
    // a reading at the SAME instant is not strictly newer
    step(sb, 'codex', codexStep({ model: 'gpt-6-astra', rateLimits: [rec(low, T)] }), 3);
    run(sb, base);
    expect(lanesOf(sb).l3.bucket_guard).toMatchObject({ exhausted_until: until });
    // a real, strictly newer reading ends it
    step(sb, 'codex', codexStep({ model: 'gpt-6-astra', rateLimits: [rec(low, new Date().toISOString())] }), 4);
    run(sb, base);
    expect(lanesOf(sb).l3).not.toHaveProperty('bucket_guard');
    // an undated EXHAUSTING observation makes the guard's observed_at "unknown": no reading can end it
    const sb2 = mkSandbox();
    step(sb2, 'codex', codexStep({ model: 'gpt-6-astra', rateLimits: [rec(rateLimits({ used: 100, resetsAt: resetIn(2) }))] }), 1);
    run(sb2, base);
    expect(lanesOf(sb2).l3.bucket_guard.observed_at).toBe('unknown');
    fs.appendFileSync(path.join(sb2.dir, 'state', 'config.yaml'), 'codex_allow_credit_spend: true\n');
    step(sb2, 'codex', codexStep({ model: 'gpt-6-astra', rateLimits: [rec(low, new Date(Date.now() + 5000).toISOString())] }), 2);
    run(sb2, base);
    expect(lanesOf(sb2).l3).toHaveProperty('bucket_guard');
  }, 60_000);

  test('a SIGTERM after the home cleanup but BEFORE the early record still persists the guard', async () => {
    const sb = mkSandbox();
    const reset = resetIn(3);
    step(sb, 'codex', codexStep({ model: 'gpt-6-astra', rateLimits: [rateLimits({ used: 100, resetsAt: reset })] }));
    const a = runArgs(sb, base);
    const p = spawn(LANE, a.args, { cwd: sb.dir, env: { ...sb.env, GSTACK_LANE_TEST_PAUSE: 'before-record:4' }, stdio: 'ignore', timeout: 30_000 });
    const done = new Promise((res) => p.on('exit', res));
    const rollout = `${a.out}.logs/inv-1/rollout.jsonl`;
    const end = Date.now() + 10_000;
    while (Date.now() < end && !fs.existsSync(rollout)) await Bun.sleep(50);
    await Bun.sleep(400); // the home is gone (GL_CODEX_HOME_LIVE=0); the helper is in the pause before recording
    const homes = fs.existsSync(codexBase(sb)) ? fs.readdirSync(codexBase(sb)) : [];
    expect(homes).toEqual([]);
    expect(fs.existsSync(path.join(sb.run, 'lanes.json'))).toBe(false);
    p.kill('SIGTERM');
    await done;
    expect(lanesOf(sb).l3.bucket_guard).toMatchObject({ exhausted_until: isoS(reset * 1000), reason: GUARD });
    expect(run(sb, base).code).toBe(4);
    expect(calls(sb, 'codex').length).toBe(1);
  }, 30_000);

  test('the fallback deadline of ONE observation is computed once: a delayed finalize never extends it (dated and undated)', () => {
    for (const dated of [true, false]) {
      const sb = mkSandbox();
      const rl = rateLimits({ used: 100, resetsAt: null });
      step(sb, 'codex', codexStep({ model: 'gpt-6-astra', rateLimits: [dated ? rec(rl, new Date().toISOString()) : rec(rl)] }));
      const r = run(sb, base, [], { GSTACK_LANE_BUCKET_FALLBACK_S: '7200', GSTACK_LANE_TEST_PAUSE: 'after-record:3' });
      expect(r.code).toBe(0);
      const g = lanesOf(sb).l3.bucket_guard;
      const lag = Date.parse(r.status().finished_at) - (Date.parse(g.exhausted_until) - 7200e3);
      expect({ dated, early: lag >= 2000 }).toEqual({ dated, early: true }); // computed at the early record, ≥ 3 s before finalize
      expect(lanesOf(sb).l3.next_probe_at).toBe(g.exhausted_until);
    }
  }, 60_000);
});

describe('v1.8.1 credit guard — pending until persisted, one deadline per observation (review round c4)', () => {
  const GUARD = 'codex bucket exhausted (100%); credit spend not allowed — set codex_allow_credit_spend=true to allow';
  const isoS = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const resetIn = (days: number) => Math.floor(Date.now() / 1000) + Math.round(days * 86400);
  const base = { lane: 'l3', mode: 'impl', model: 'gpt-6-astra', effort: 'high' };
  const rec = (rl: object, ts?: string) => JSON.stringify({ ...(ts ? { timestamp: ts } : {}), type: 'event_msg', payload: { type: 'token_count', info: null, rate_limits: rl } });

  test('the early write fails (lock busy), the lock frees, SIGTERM before finalize → the guard is still persisted', async () => {
    const sb = mkSandbox();
    fs.mkdirSync(sb.run, { recursive: true });
    const reset = resetIn(3);
    step(sb, 'codex', codexStep({ model: 'gpt-6-astra', rateLimits: [rateLimits({ used: 100, resetsAt: reset })] }));
    const holder = spawn('/usr/bin/perl', ['-MFcntl=:flock', '-e', 'open(my $f, ">>", $ARGV[0]) or die; flock($f, LOCK_EX) or die; $| = 1; print "locked\n"; sleep $ARGV[1];',
      path.join(sb.run, 'lanes.lock'), '25'], { stdio: ['ignore', 'pipe', 'ignore'], timeout: 40_000 });
    const gone = new Promise((res) => holder.on('exit', res));
    await new Promise<void>((res, rej) => { holder.stdout!.once('data', () => res()); setTimeout(() => rej(new Error('lock holder never locked')), 5000); });
    const a = runArgs(sb, base);
    const p = spawn(LANE, a.args, { cwd: sb.dir, env: { ...sb.env, GSTACK_LANE_LOCK_WAIT_S: '1', GSTACK_LANE_TEST_PAUSE: 'after-record:5' }, stdio: 'ignore', timeout: 30_000 });
    const done = new Promise((res) => p.on('exit', res));
    const rollout = `${a.out}.logs/inv-1/rollout.jsonl`;
    const end = Date.now() + 10_000;
    while (Date.now() < end && !fs.existsSync(rollout)) await Bun.sleep(50);
    await Bun.sleep(2000); // bucket-check + the 1 s lock wait: the early write has FAILED; now in the pause
    expect(fs.existsSync(path.join(sb.run, 'lanes.json'))).toBe(false);
    holder.kill('SIGKILL');
    await gone; // the lock is free again
    p.kill('SIGTERM'); // before finalize
    await done;
    expect(fs.existsSync(`${a.out}.status.json`)).toBe(false); // finalize never ran
    expect(lanesOf(sb).l3.bucket_guard).toMatchObject({ exhausted_until: isoS(reset * 1000), reason: GUARD });
    expect(run(sb, base).code).toBe(4);
    expect(calls(sb, 'codex').length).toBe(1);
  }, 40_000);

  test('an observation\'s deadline is fixed forever: finalized AFTER it expired, it neither restarts nor extends cooling (dated and undated)', () => {
    for (const dated of [true, false]) {
      const sb = mkSandbox();
      const reset = Math.floor(Date.now() / 1000) + 3;
      const rl = rateLimits({ used: 100, resetsAt: reset });
      step(sb, 'codex', codexStep({ model: 'gpt-6-astra', rateLimits: [dated ? rec(rl, new Date().toISOString()) : rec(rl)] }), 1);
      step(sb, 'codex', OK_CODEX, 2);
      const r = run(sb, base, [], { GSTACK_LANE_TEST_PAUSE: 'after-record:5', GSTACK_LANE_BUCKET_FALLBACK_S: '7200' });
      expect(r.code).toBe(0);
      expect({ dated, guard: r.status().credit_guard }).toEqual({ dated, guard: 'expired' });
      const l3 = lanesOf(sb).l3;
      expect({ dated, until: l3.bucket_guard.exhausted_until }).toEqual({ dated, until: isoS(reset * 1000) }); // not a fresh 7200 s fallback
      expect(l3.status === 'cooling' && Date.parse(l3.next_probe_at) > Date.now()).toBe(false);
      expect(run(sb, base).code).toBe(0); // the next attempt is invoked
      expect(calls(sb, 'codex').length).toBe(2);
    }
  }, 60_000);
});

describe('v1.8.1 credit guard — globally unique observation keys, per-observation deadlines (review round c5)', () => {
  const isoS = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const resetIn = (days: number) => Math.floor(Date.now() / 1000) + Math.round(days * 86400);
  const base = { lane: 'l3', mode: 'impl', model: 'gpt-6-astra', effort: 'high' };
  const rec = (rl: object, ts?: string) => JSON.stringify({ ...(ts ? { timestamp: ts } : {}), type: 'event_msg', payload: { type: 'token_count', info: null, rate_limits: rl } });

  test('task-a/a1 and task-b/a1 (undated) get DISTINCT keys: the second run\'s fresh 100% reading cools after the first guard expired', async () => {
    const sb = mkSandbox();
    const outA = path.join(sb.run, 'attempts', 'task-a', 'a1', 'out.txt');
    const outB = path.join(sb.run, 'attempts', 'task-b', 'a1', 'out.txt');
    step(sb, 'codex', codexStep({ model: 'gpt-6-astra', rateLimits: [rec(rateLimits({ used: 100, resetsAt: Math.floor(Date.now() / 1000) + 2 }))] }), 1);
    expect(run(sb, { ...base, out: outA }).code).toBe(0);
    expect(Object.values(lanesOf(sb).l3.bucket_obs).map((v: any) => v.id)).toEqual(['task-a/a1/out.txt/inv-1@#0']);
    await Bun.sleep(3000); // A's guard (and its own deadline) expired
    const reset = resetIn(3);
    step(sb, 'codex', codexStep({ model: 'gpt-6-astra', rateLimits: [rec(rateLimits({ used: 100, resetsAt: reset }))] }), 2);
    const b = run(sb, { ...base, out: outB });
    expect(b.code).toBe(0);
    expect(b.status().credit_guard).toBe('cooling');
    const l3 = lanesOf(sb).l3;
    expect(Object.values(l3.bucket_obs).map((v: any) => v.id).sort()).toEqual(['task-a/a1/out.txt/inv-1@#0', 'task-b/a1/out.txt/inv-1@#0']);
    for (const k of Object.keys(l3.bucket_obs)) expect(k).toMatch(/^[0-9a-f]{64}$/);
    expect(l3).toMatchObject({ status: 'cooling', next_probe_at: isoS(reset * 1000), bucket_guard: { exhausted_until: isoS(reset * 1000) } });
    expect(run(sb, base).code).toBe(4);
  }, 30_000);

  test('concurrent A (long guard) / B (short, inside A, finalized after BOTH expired): B keeps its own deadline and never restarts cooling', () => {
    const sb = mkSandbox();
    const now = Date.now();
    const aUntil = isoS(now + 9000);
    // during B's invocation, "attempt A" records a guard that outlasts B's own reset
    const lanesA = { l3: { status: 'ok', reason: 'ok (impl)', next_probe_at: null, runtime_model: null, updated_at: isoS(now), status_since: '2020-01-01T00:00:00.000Z',
      last_event_at: null, consecutive_quota: 0, throttle_count: 0,
      bucket_guard: { exhausted_until: aUntil, reason: 'codex bucket exhausted (100%); credit spend not allowed — set codex_allow_credit_spend=true to allow', set_at: new Date(now).toISOString(), observed_at: 'unknown' },
      bucket_obs: { ['f'.repeat(64)]: { u: aUntil, f: 0, id: 'other/a9/out.txt/inv-1@#0' } } } };
    const bReset = Math.floor(now / 1000) + 3;
    step(sb, 'codex', `printf '%s' ${sq(JSON.stringify(lanesA))} > ${sq(path.join(sb.run, 'lanes.json'))}\n${codexStep({ model: 'gpt-6-astra', rateLimits: [rec(rateLimits({ used: 100, resetsAt: bReset }))] })}`, 1);
    step(sb, 'codex', OK_CODEX, 2);
    const r = run(sb, base, [], { GSTACK_LANE_TEST_PAUSE: 'after-record:11', GSTACK_LANE_BUCKET_FALLBACK_S: '7200' });
    expect(r.code).toBe(0);
    expect(r.status().credit_guard).toBe('expired');
    const l3 = lanesOf(sb).l3;
    const own = Object.values(l3.bucket_obs).find((v: any) => v.id.endsWith('/inv-1@#0') && !v.id.startsWith('other/')) as any;
    expect(own).toMatchObject({ u: isoS(bReset * 1000), f: 0 }); // B's own deadline retained although it fit inside A's guard
    expect(l3.bucket_guard.exhausted_until).toBe(aUntil);      // A's guard: not extended by a fresh 7200 s fallback
    expect(l3.status === 'cooling' && Date.parse(l3.next_probe_at) > Date.now()).toBe(false);
    expect(run(sb, base).code).toBe(0);                        // nothing restarted: the next attempt runs
  }, 40_000);

  test('bucket_obs stays bounded: expired entries past the 6 h replay window are pruned after 8 days and evicted oldest-deadline first beyond 64; live and recently expired never', () => {
    const sb = mkSandbox();
    const hex = (i: number) => i.toString(16).padStart(64, '0');
    const obs: Record<string, { u: string; f: number; id: string }> = { [hex(999)]: { u: isoS(Date.now() - 9 * 86400e3), f: 1, id: 'old' },
      [hex(998)]: { u: isoS(Date.now() - 3600e3), f: 1, id: 'recent' } };
    for (let i = 0; i < 80; i++) obs[hex(i)] = { u: isoS(Date.now() - 7 * 3600e3 - i * 1000), f: 1, id: `expired-${i}` };
    writeLanes(sb, { l3: { status: 'ok', reason: 'ok', next_probe_at: null, runtime_model: null, updated_at: '2020-01-01T00:00:00Z', status_since: '2020-01-01T00:00:00.000Z',
      last_event_at: null, consecutive_quota: 0, throttle_count: 0, bucket_obs: obs } });
    step(sb, 'codex', codexStep({ model: 'gpt-6-astra', rateLimits: [rateLimits({ used: 100, resetsAt: resetIn(2) })] }));
    expect(run(sb, base).code).toBe(0);
    const m = lanesOf(sb).l3.bucket_obs;
    const ids = Object.values(m).map((v: any) => v.id);
    expect(ids.length).toBe(64);
    expect(ids).not.toContain('old');                       // > 8 days: pruned
    expect(ids).toContain('recent');                        // expired within the replay window: kept
    expect(ids).toContain('expired-0');                     // the newest older-expired kept…
    expect(ids).not.toContain('expired-79');                // …the oldest-deadline expired evicted first
    expect(ids.some((id: string) => id.includes('/inv-1@'))).toBe(true); // this run's own live observation kept
  });
});

describe('v1.8.1 credit guard — sha256 keys of the full identity, live observations never evicted (review round c6)', () => {
  const isoS = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const resetIn = (days: number) => Math.floor(Date.now() / 1000) + Math.round(days * 86400);
  const base = { lane: 'l3', mode: 'impl', model: 'gpt-6-astra', effort: 'high' };
  const rec = (rl: object, ts?: string) => JSON.stringify({ ...(ts ? { timestamp: ts } : {}), type: 'event_msg', payload: { type: 'token_count', info: null, rate_limits: rl } });

  test('two outputs sharing their first 400+ characters get DISTINCT keys; the fresh 100% reading cools', async () => {
    const sb = mkSandbox();
    const task = 'T'.repeat(250), att = 'a'.repeat(200);
    const outA = path.join(sb.run, 'attempts', task, `${att}x1`, 'out.txt');
    const outB = path.join(sb.run, 'attempts', task, `${att}x2`, 'out.txt');
    step(sb, 'codex', codexStep({ model: 'gpt-6-astra', rateLimits: [rec(rateLimits({ used: 100, resetsAt: Math.floor(Date.now() / 1000) + 2 }))] }), 1);
    expect(run(sb, { ...base, out: outA }).code).toBe(0);
    await Bun.sleep(3000); // A's own deadline expired
    const reset = resetIn(3);
    step(sb, 'codex', codexStep({ model: 'gpt-6-astra', rateLimits: [rec(rateLimits({ used: 100, resetsAt: reset }))] }), 2);
    const b = run(sb, { ...base, out: outB });
    expect(b.code).toBe(0);
    expect(b.status().credit_guard).toBe('cooling');
    const l3 = lanesOf(sb).l3;
    expect(Object.keys(l3.bucket_obs).length).toBe(2);
    for (const k of Object.keys(l3.bucket_obs)) expect(k).toMatch(/^[0-9a-f]{64}$/);
    expect(l3).toMatchObject({ status: 'cooling', next_probe_at: isoS(reset * 1000) });
    expect(run(sb, base).code).toBe(4);
  }, 30_000);

  test('65 LIVE observations are all retained; a short one finalized after its reset neither restarts nor extends cooling', () => {
    const sb = mkSandbox();
    const hex = (i: number) => i.toString(16).padStart(64, '0');
    const live: Record<string, { u: string; f: number; id: string }> = {};
    for (let i = 0; i < 65; i++) live[hex(i)] = { u: isoS(Date.now() + 86400e3 + i * 1000), f: 0, id: `live-${i}` };
    writeLanes(sb, { l3: { status: 'ok', reason: 'ok', next_probe_at: null, runtime_model: null, updated_at: '2020-01-01T00:00:00Z', status_since: '2020-01-01T00:00:00.000Z',
      last_event_at: null, consecutive_quota: 0, throttle_count: 0, bucket_obs: live } });
    const reset = Math.floor(Date.now() / 1000) + 3;
    step(sb, 'codex', codexStep({ model: 'gpt-6-astra', rateLimits: [rec(rateLimits({ used: 100, resetsAt: reset }))] }), 1);
    step(sb, 'codex', OK_CODEX, 2);
    const r = run(sb, base, [], { GSTACK_LANE_TEST_PAUSE: 'after-record:5', GSTACK_LANE_BUCKET_FALLBACK_S: '7200' });
    expect(r.code).toBe(0);
    expect(r.status().credit_guard).toBe('expired');
    const l3 = lanesOf(sb).l3;
    const ids = Object.values(l3.bucket_obs).map((v: any) => v.id);
    for (let i = 0; i < 65; i++) expect(ids).toContain(`live-${i}`);
    expect(Date.parse(l3.bucket_guard.exhausted_until)).toBe(reset * 1000); // its own deadline: not a fresh 7200 s fallback
    expect(l3.status === 'cooling' && Date.parse(l3.next_probe_at) > Date.now()).toBe(false);
    expect(run(sb, base).code).toBe(0);
  }, 30_000);
});

describe('v1.8.1 credit guard — hard map ceiling (fail closed) and late finalize (review round c7)', () => {
  const isoS = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const resetIn = (days: number) => Math.floor(Date.now() / 1000) + Math.round(days * 86400);
  const base = { lane: 'l3', mode: 'impl', model: 'gpt-6-astra', effort: 'high' };
  const hex = (i: number) => i.toString(16).padStart(64, '0');
  const rec = (rl: object, ts?: string) => JSON.stringify({ ...(ts ? { timestamp: ts } : {}), type: 'event_msg', payload: { type: 'token_count', info: null, rate_limits: rl } });
  const lanesWith = (obs: Record<string, unknown>) => ({ l3: { status: 'ok', reason: 'ok', next_probe_at: null, runtime_model: null, updated_at: '2020-01-01T00:00:00Z',
    status_since: '2020-01-01T00:00:00.000Z', last_event_at: null, consecutive_quota: 0, throttle_count: 0, bucket_obs: obs } });

  test('300 LIVE entries: the map is capped (no admission), the guard fails CLOSED with a warning; the opt-in lifts it visibly', () => {
    const live: Record<string, { u: string; f: number; id: string }> = {};
    for (let i = 0; i < 300; i++) live[hex(i)] = { u: isoS(Date.now() + 86400e3 + i * 1000), f: 0, id: `live-${i}` };
    const reset = resetIn(2);
    const sb = mkSandbox();
    writeLanes(sb, lanesWith(live));
    step(sb, 'codex', codexStep({ model: 'gpt-6-astra', rateLimits: [rateLimits({ used: 100, resetsAt: reset })] }));
    const r = run(sb, base);
    expect(r.code).toBe(0); // the observing invocation keeps its own result
    expect(r.status().credit_guard).toBe('map_full');
    expect(r.err).toContain('WARNING: credit-guard observation map full');
    const l3 = lanesOf(sb).l3;
    expect(Object.keys(l3.bucket_obs).length).toBe(300); // never grown, nothing live dropped
    expect(l3.bucket_guard.exhausted_until).toBe(isoS(reset * 1000));
    expect(l3.bucket_guard.reason).toContain('observation map full');
    expect(l3).toMatchObject({ status: 'cooling', next_probe_at: isoS(reset * 1000) });
    const n = calls(sb, 'codex').length;
    expect(run(sb, base).code).toBe(4);
    expect(calls(sb, 'codex').length).toBe(n);
    // opt-in: still not admitted, guard recorded and LIFTED (visible), the next run proceeds
    const sb2 = mkSandbox();
    fs.appendFileSync(path.join(sb2.dir, 'state', 'config.yaml'), 'codex_allow_credit_spend: true\n');
    writeLanes(sb2, lanesWith(live));
    step(sb2, 'codex', codexStep({ model: 'gpt-6-astra', rateLimits: [rateLimits({ used: 100, resetsAt: reset })] }));
    const o = run(sb2, base);
    expect(o.status().credit_guard).toBe('map_full');
    expect(o.err).toContain('lifted by codex_allow_credit_spend=true');
    expect(Object.keys(lanesOf(sb2).l3.bucket_obs).length).toBe(300);
    expect(JSON.parse(lane(sb2, ['probe', '--run-dir', sb2.run, '--lanes', 'l3', '--json']).out).l3.effective.credit_guard).toBe('lifted');
    expect(run(sb2, base).code).toBe(0);
  }, 30_000);

  test('normal churn (300 entries expired past the grace): evicted to the soft cap, no false guard', () => {
    const old: Record<string, { u: string; f: number; id: string }> = {};
    for (let i = 0; i < 300; i++) old[hex(i)] = { u: isoS(Date.now() - 7 * 3600e3 - i * 1000), f: 1, id: `old-${i}` };
    const sb = mkSandbox();
    fs.appendFileSync(path.join(sb.dir, 'state', 'config.yaml'), 'codex_allow_credit_spend: true\n');
    writeLanes(sb, lanesWith(old));
    step(sb, 'codex', codexStep({ model: 'gpt-6-astra', rateLimits: [rateLimits({ used: 100, resetsAt: resetIn(2) })] }));
    const r = run(sb, base);
    expect(r.status().credit_guard).toBe('allowed');
    expect(Object.keys(lanesOf(sb).l3.bucket_obs).length).toBe(64);
    const sb2 = mkSandbox();
    writeLanes(sb2, lanesWith(old));
    step(sb2, 'codex', codexStep({ model: 'gpt-6-astra', rateLimits: [rateLimits({ used: 40, resetsAt: resetIn(2) })] }));
    const b = run(sb2, base);
    expect(b.code).toBe(0);
    expect(b.status()).not.toHaveProperty('credit_guard');
    expect(lanesOf(sb2).l3).not.toHaveProperty('bucket_guard');
    expect(run(sb2, base).code).toBe(0);
  }, 30_000);

  test('a helper suspended PAST the grace with 64+ newer competing entries: late_finalize — nothing recomputed, no restart, the next run proceeds', () => {
    const sb = mkSandbox();
    const reset = Math.floor(Date.now() / 1000) + 3; // live at the early record; past its 2 s grace at finalize
    const comp: Record<string, { u: string; f: number; id: string }> = {};
    for (let i = 0; i < 70; i++) comp[hex(i)] = { u: new Date(reset * 1000 + 1000 + i).toISOString(), f: 1, id: `comp-${i}` };
    writeLanes(sb, lanesWith(comp));
    step(sb, 'codex', codexStep({ model: 'gpt-6-astra', rateLimits: [rec(rateLimits({ used: 100, resetsAt: reset }))] }), 1);
    step(sb, 'codex', OK_CODEX, 2);
    const env = { GSTACK_LANE_OBS_GRACE_S: '2', GSTACK_LANE_TEST_PAUSE: 'after-record:7', GSTACK_LANE_BUCKET_FALLBACK_S: '7200' };
    const r = run(sb, base, [], env);
    expect(r.code).toBe(0);
    expect(r.status().credit_guard).toBe('late_finalize');
    expect(r.err).toContain('credit-guard late finalize');
    const l3 = lanesOf(sb).l3;
    expect(Object.values(l3.bucket_obs).some((v: any) => v.id.includes('/inv-1@'))).toBe(false); // its entry was evicted
    expect(l3.bucket_guard.exhausted_until).toBe(isoS(reset * 1000)); // the early record's deadline: not a fresh 7200 s fallback
    expect(l3.status === 'cooling' && Date.parse(l3.next_probe_at) > Date.now()).toBe(false);
    expect(run(sb, base).code).toBe(0); // the next run proceeds per the current bucket state
  }, 30_000);
});

describe('invariants across every recorded invocation', () => {
  test('no stub invocation ever received --always-approve; grok never got the prompt text in argv; codex always ran with --json', () => {
    expect(H.checkInvariants()).toBeGreaterThan(40);
  });
});
