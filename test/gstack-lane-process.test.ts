/**
 * bin/gstack-lane — process-control suite: hard deadlines over the whole process tree,
 * reaping of escaped/re-parented workers, the effort step-down ladder, throttle backoff
 * inside the deadline, and the kernel flock on lanes.json (E8). Split out of
 * test/gstack-lane.test.ts and test/gstack-lane-isolation.test.ts to keep each file well
 * under the 45 s budget. Uses test/helpers/gstack-lane-harness.ts: STUB vendor CLIs only,
 * first on a hermetic PATH where the real ones cannot be found.
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { LANE, OK_CLAUDE, OK_CODEX, codexStep, waitGone, makeLaneHarness, type RunOpts } from './helpers/gstack-lane-harness';

const H = makeLaneHarness('gstack-lane-proc');
const { mkSandbox, step, runArgs, run, calls, lanesOf } = H;

beforeAll(() => H.setup());
afterAll(() => H.teardown());

describe('deadlines, reaping and ladders', () => {
  test('real deadline: the stub sleeps past --timeout; the whole tree dies (own-pgid and TERM-immune descendants); one step-down retry', async () => {
    const sb = mkSandbox();
    step(sb, 'codex', [
      '( trap "" TERM; exec sleep 30 ) &', 'echo $! >> "$STUB_DIR/pids"',
      'bash -c \'set -m; sleep 30 & echo $! >> "$STUB_DIR/pids"; wait\' &', 'echo $! >> "$STUB_DIR/pids"',
      'echo $$ >> "$STUB_DIR/pids"', 'sleep 30', ''].join('\n'));
    const r = run(sb, { lane: 'l3', mode: 'review', model: 'gpt-6.1-sol', effort: 'high', timeout: '1' });
    expect(r.code).toBe(124);
    expect(r.ms).toBeGreaterThanOrEqual(1900); // 1 s + 1 s (retry), each enforced
    expect(r.ms).toBeLessThan(5500);
    const pids = fs.readFileSync(path.join(sb.dir, 'pids'), 'utf8').trim().split('\n').map(Number);
    expect(pids).toHaveLength(8);
    expect(await waitGone(pids)).toEqual([]);
    const s = r.status();
    expect(s).toMatchObject({ class: 'timeout', exit_code: 124, requested_effort: 'high', effort: 'medium', timeout_retry: true });
    expect(s.attempts.map((a: any) => [a.effort, a.timeout_s, a.class])).toEqual([['high', 1, 'timeout'], ['medium', 1, 'timeout']]);
  }, 30_000);

  test('addendum d: on a SUCCESSFUL exit, a worker that escaped the process group (new session) is reaped too', async () => {
    const sb = mkSandbox();
    step(sb, 'codex', `perl -MPOSIX -e 'POSIX::setsid(); sleep 30' &\necho $! > "$STUB_DIR/escaped.pid"\nsleep 1.5\n${OK_CODEX}`);
    const r = run(sb, { lane: 'l3', mode: 'impl', model: 'gpt-6.1-sol', effort: 'low' });
    expect(r.code).toBe(0);
    const pid = Number(fs.readFileSync(path.join(sb.dir, 'escaped.pid'), 'utf8').trim());
    expect(await waitGone([pid])).toEqual([]);
  }, 30_000);

  test('F4: at the DEADLINE, a sampled descendant that changed session and re-parented before it is still killed', async () => {
    const sb = mkSandbox();
    // The intermediate parent exits after ~1.5 s, so the setsid'd grandchild is re-parented
    // (out of both the process group and the ppid walk) well before the 3 s deadline.
    step(sb, 'codex', `perl -MPOSIX -e 'if (my $p = fork) { open(my $f, ">", "$ENV{STUB_DIR}/gc.pid"); print $f $p; close $f; select(undef, undef, undef, 1.5); exit 0 } POSIX::setsid(); sleep 30' &\nsleep 30\n`, 1);
    step(sb, 'codex', 'exit 124\n', 2);
    const r = run(sb, { lane: 'l3', mode: 'impl', model: 'gpt-6.1-sol', effort: 'high', timeout: '3', 'retry-timeout': '1' });
    expect(r.code).toBe(124);
    const gc = Number(fs.readFileSync(path.join(sb.dir, 'gc.pid'), 'utf8').trim());
    expect(gc).toBeGreaterThan(1);
    expect(await waitGone([gc])).toEqual([]);
  }, 30_000);

  test('timeout ladders: 600→300, 900→420, else half; --retry-timeout overrides; effort xhigh→medium, medium→low', () => {
    const sb = mkSandbox();
    step(sb, 'codex', 'exit 124\n');
    const ladder = (timeout: string, effort: string, extra: string[] = []) => {
      const r = run(sb, { lane: 'l3', mode: 'review', model: 'gpt-6-astra', effort, timeout }, extra);
      expect(r.code).toBe(124);
      return r.status().attempts.map((a: any) => [a.effort, a.timeout_s]);
    };
    expect(ladder('600', 'high')).toEqual([['high', 600], ['medium', 300]]);
    expect(ladder('900', 'xhigh')).toEqual([['xhigh', 900], ['medium', 420]]);
    expect(ladder('10', 'medium')).toEqual([['medium', 10], ['low', 5]]);
    expect(ladder('600', 'high', ['--retry-timeout', '120'])).toEqual([['high', 600], ['medium', 120]]);
  }, 30_000);

  test('throttle backoff stays inside the deadline; throttle_count exposed; then ok resets the lane counter', () => {
    const sb = mkSandbox();
    step(sb, 'codex', codexStep({ fail: '429 Too Many Requests — model overloaded' }));
    const r = run(sb, { lane: 'l3', mode: 'impl', model: 'gpt-6.1-sol', effort: 'medium', timeout: '3' }, [],
      { GSTACK_LANE_THROTTLE_RETRIES: '20', GSTACK_LANE_BACKOFF_MS: '100' });
    expect(r.code).toBe(3);
    expect(r.ms).toBeLessThan(3000 + 1500);
    const s = r.status();
    expect(s.attempts.length).toBeGreaterThan(1);
    expect(s.attempts.every((a: any) => a.class === 'throttle' && a.timeout_s <= 3)).toBe(true);
    expect(s.throttle_count).toBe(s.attempts.length);
    expect(s.lane_throttle_count).toBe(1);
    const n = calls(sb, 'codex').length;
    step(sb, 'codex', codexStep({ fail: '529 overloaded_error' }), n + 1);
    step(sb, 'codex', OK_CODEX, n + 2);
    const ok = run(sb, { lane: 'l3', mode: 'impl', model: 'gpt-6.1-sol', effort: 'medium', timeout: '10' }, [], { GSTACK_LANE_THROTTLE_RETRIES: '3' });
    expect(ok.code).toBe(0);
    expect(ok.status().attempts.map((a: any) => a.class)).toEqual(['throttle', 'ok']);
    expect(lanesOf(sb).l3.throttle_count).toBe(0);
  }, 30_000);
});

describe('lanes.json kernel lock (E8)', () => {
  test('12 concurrent runs (barrier) never corrupt lanes.json; a racing reader never sees a torn file', async () => {
    const sb = mkSandbox();
    const gate = 'while [ ! -f "$STUB_DIR/go" ]; do sleep 0.01; done\n';
    step(sb, 'claude', `${gate}${OK_CLAUDE}`);
    step(sb, 'codex', `${gate}${codexStep({ fail: "You've hit your usage limit." })}`);
    step(sb, 'grok', `${gate}echo '{"is_error":true,"error":"401 Unauthorized"}'\nexit 1\n`);
    const jobs: Promise<number>[] = [];
    const outs: [string, string][] = [];
    for (let i = 0; i < 4; i++) {
      for (const [l, o] of [
        ['l2', { lane: 'l2', mode: 'impl', model: 'claude-sonnet-5-5', effort: 'medium', 'claude-dir': sb.claudeDir }],
        ['l3', { lane: 'l3', mode: 'impl', model: 'gpt-6.1-sol', effort: 'medium' }],
        ['l4', { lane: 'l4', mode: 'impl', model: 'grok-4.7', effort: 'low', tier: 'T1' }],
      ] as const) {
        const { args, out } = runArgs(sb, { ...o, timeout: '20' } as RunOpts);
        outs.push([l, out]);
        jobs.push(new Promise((resolve) => {
          const p = spawn(LANE, args, { cwd: sb.dir, env: sb.env, stdio: 'ignore' });
          p.on('exit', (code) => resolve(code ?? -1));
        }));
      }
    }
    const callsDir = path.join(sb.dir, 'calls');
    const end = Date.now() + 10_000;
    while (Date.now() < end && !(fs.existsSync(callsDir) && fs.readdirSync(callsDir).filter((f) => !f.startsWith('.') && !f.startsWith('grok-models')).length >= 12)) await Bun.sleep(20);
    fs.writeFileSync(path.join(sb.dir, 'go'), '');
    let done = false;
    const torn: string[] = [];
    const all = Promise.all(jobs).then((c) => { done = true; return c; });
    while (!done) {
      try { const txt = fs.readFileSync(path.join(sb.run, 'lanes.json'), 'utf8'); try { JSON.parse(txt); } catch { torn.push(txt); } } catch { /* not yet */ }
      await Bun.sleep(1);
    }
    const codes = await all;
    expect(torn).toEqual([]);
    expect(codes.slice().sort()).toEqual([0, 0, 0, 0, 4, 4, 4, 4, 5, 5, 5, 5]);
    const j = lanesOf(sb);
    expect(Object.keys(j).sort()).toEqual(['l2', 'l3', 'l4']);
    expect(j.l3).toMatchObject({ status: 'cooling', consecutive_quota: 1 });
    expect(j.l4.status).toBe('absent');
    expect(fs.readdirSync(sb.run).filter((f) => f.includes('.tmp.') || f.includes('corrupt'))).toEqual([]);
    for (const [l, out] of outs) expect(JSON.parse(fs.readFileSync(`${out}.status.json`, 'utf8')).lane).toBe(l);
  }, 30_000);

  test('a live holder blocks the writer; a SIGKILLed holder releases the lock instantly (no stale-lock logic); a held lock ⇒ lane_update pending', async () => {
    const sb = mkSandbox();
    step(sb, 'claude', `echo '{"type":"result","is_error":true,"result":"Claude AI usage limit reached"}'\nexit 1\n`);
    fs.mkdirSync(sb.run, { recursive: true });
    const holder = spawn('/usr/bin/perl', ['-MFcntl=:flock', '-e', 'open(my $f, ">>", $ARGV[0]) or die; flock($f, LOCK_EX) or die; print "locked\\n"; $| = 1; sleep 30', path.join(sb.run, 'lanes.lock')], { stdio: ['ignore', 'pipe', 'ignore'] });
    await new Promise<void>((resolve) => holder.stdout!.once('data', () => resolve()));
    const pending = run(sb, { lane: 'l2', mode: 'impl', model: 'claude-sonnet-5-5', effort: 'medium', 'claude-dir': sb.claudeDir }, [], { GSTACK_LANE_LOCK_WAIT_S: '0' });
    expect(pending.code).toBe(4);
    expect(pending.status()).toMatchObject({ class: 'quota', lane_update: 'pending', lane_update_kind: 'quota', lane_status: null });
    expect(fs.existsSync(path.join(sb.run, 'lanes.json'))).toBe(false);
    const { args } = runArgs(sb, { lane: 'l2', mode: 'impl', model: 'claude-sonnet-5-5', effort: 'medium', 'claude-dir': sb.claudeDir });
    const p = spawn(LANE, args, { cwd: sb.dir, env: { ...sb.env, GSTACK_LANE_LOCK_WAIT_S: '15' }, stdio: 'ignore' });
    let code: number | null | undefined;
    const exited = new Promise<void>((resolve) => p.on('exit', (c) => { code = c; resolve(); }));
    await Bun.sleep(700);
    expect(code).toBeUndefined(); // blocked on the live holder
    holder.kill('SIGKILL');
    await exited;
    expect(code).toBe(4);
    expect(lanesOf(sb).l2.status).toBe('cooling');
  }, 30_000);

  test('SIGTERM to the helper kills the in-flight CLI process group', async () => {
    const sb = mkSandbox();
    step(sb, 'codex', 'sleep 30 &\necho $! >> "$STUB_DIR/pids"\necho $$ >> "$STUB_DIR/pids"\nwait\n');
    const p = spawn(LANE, runArgs(sb, { lane: 'l3', mode: 'impl', model: 'gpt-6.1-sol', effort: 'high', timeout: '30' }).args, { cwd: sb.dir, env: sb.env, stdio: 'ignore' });
    const exited = new Promise<number | null>((resolve) => p.on('exit', (code) => resolve(code)));
    const pidFile = path.join(sb.dir, 'pids');
    const end = Date.now() + 5000;
    while (Date.now() < end && !(fs.existsSync(pidFile) && fs.readFileSync(pidFile, 'utf8').trim().split('\n').length >= 2)) await Bun.sleep(50);
    p.kill('SIGTERM');
    expect(await exited).toBe(143);
    expect(await waitGone(fs.readFileSync(pidFile, 'utf8').trim().split('\n').map(Number))).toEqual([]);
  });
});

describe('invariants across every recorded invocation', () => {
  test('no stub invocation ever received --always-approve; grok never got the prompt text in argv; codex always ran with --json', () => {
    expect(H.checkInvariants()).toBeGreaterThan(10);
  });
});
