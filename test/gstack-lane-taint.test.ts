/**
 * bin/gstack-lane — L4 review taint suite: the bounded, inert before/after snapshots that
 * make a grok review INVALID when it (or anything) writes to the review/primary/sibling
 * worktrees, the shared git control state (hooks, config, refs, symlinked hook targets,
 * modes) or lanes.json — and that never run a repo-configured program while doing so.
 * Split out of test/gstack-lane-isolation.test.ts and test/gstack-lane-hardening.test.ts to
 * keep each file well under the 45 s budget. Uses test/helpers/gstack-lane-harness.ts:
 * STUB vendor CLIs only, first on a hermetic PATH where the real ones cannot be found.
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { LANE, OK_CLAUDE, OK_GROK, sq, makeLaneHarness } from './helpers/gstack-lane-harness';

const H = makeLaneHarness('gstack-lane-taint');
const { mkSandbox, step, lane, runArgs, run, calls, lanesOf, writeLanes, wtAdd, sh, mkRepo } = H;

beforeAll(() => H.setup());
afterAll(() => H.teardown());

describe('bin/gstack-lane l4 review taint (E5/E6, F5, H3, symlinked hooks)', () => {
  test('E5 + addendum: any write to the review/primary/sibling worktrees, hooks, refs or a foreign lanes.json edit taints the review', () => {
    const sb = mkSandbox();
    const repo = mkRepo(`taint-${path.basename(sb.dir)}`);
    const sibling = wtAdd(sb, 'task-sibling', { repo });
    const lanesFile = path.join(sb.run, 'lanes.json');
    const cases: [string, string, string][] = [
      ['review worktree', 'echo stray > "$PWD/stray.txt"', 'review or primary worktree changed'],
      ['primary worktree', `echo wip >> ${sq(path.join(repo, 'a.txt'))}`, 'review or primary worktree changed'],
      ['sibling task worktree', `echo x > ${sq(path.join(sibling, 'injected.txt'))}`, 'review or primary worktree changed'],
      ['hooks/pre-commit', 'printf "#!/bin/sh\\nexit 0\\n" > "$(git rev-parse --git-common-dir)/hooks/pre-commit"', 'shared git control state changed'],
      ['a new ref', 'git update-ref refs/heads/evil HEAD', 'shared git control state changed'],
      ['lanes.json (foreign edit)', `echo '{"l2":{"status":"absent"}}' > ${sq(lanesFile)}`, 'lanes.json changed outside gstack-lane'],
    ];
    cases.forEach(([label, write, detail], i) => {
      step(sb, 'grok', `${write}\n${OK_GROK}`, i + 1);
      const wt = wtAdd(sb, `gate-t${i}`, { detach: true, repo });
      const r = run(sb, { lane: 'l4', mode: 'review', effort: 'high', cwd: wt });
      expect({ label, code: r.code, tainted: r.status().tainted, cls: r.status().class }).toEqual({ label, code: 1, tainted: true, cls: 'error' });
      expect(r.status().taint_detail).toContain(detail);
      expect(r.status().published).toBe(false);
      fs.rmSync(path.join(wt, 'stray.txt'), { force: true });
      expect(lane(sb, ['worktree', 'rm', '--run-dir', sb.run, '--task', `gate-t${i}`, '--force', '--repo', repo]).code).toBe(0); // keep the sibling set small
    });
  }, 30_000);

  test('a helper-written lanes.json update during the review (the concurrent forum member) does NOT taint it', () => {
    const sb = mkSandbox();
    step(sb, 'claude', OK_CLAUDE);
    const nested = runArgs(sb, { lane: 'l2', mode: 'review', model: 'claude-opus-5-5', effort: 'high', 'claude-dir': sb.claudeDir });
    step(sb, 'grok', `${nested.args.map(sq).reduce((acc, a) => `${acc} ${a}`, sq(LANE))} >/dev/null 2>&1\n${OK_GROK}`);
    const wt = wtAdd(sb, 'gate-concurrent', { detach: true });
    const r = run(sb, { lane: 'l4', mode: 'review', effort: 'high', cwd: wt });
    expect(r.code).toBe(0);
    expect(r.status()).toMatchObject({ class: 'ok', tainted: false });
    expect(JSON.parse(fs.readFileSync(`${nested.out}.status.json`, 'utf8')).class).toBe('ok');
    expect(lanesOf(sb).l2.status).toBe('ok');
  }, 30_000);

  test('E6/H3: snapshots are inert (diff.external and a pre-existing clean filter never run) and bounded (an untracked file too slow to hash ⇒ tainted, never launched)', () => {
    const sb = mkSandbox();
    step(sb, 'grok', OK_GROK);
    const repo = mkRepo(`inert-${path.basename(sb.dir)}`);
    const marker = path.join(sb.dir, 'FILTER-RAN');
    sh('git', ['config', 'diff.external', 'sleep 30'], repo);
    sh('git', ['config', 'filter.slow.clean', `touch ${sq(marker)}; sleep 30`], repo); // configured BEFORE the review (H3: still never runs)
    fs.writeFileSync(path.join(sh('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], repo), 'info', 'attributes'), 'a.txt filter=slow\n');
    fs.appendFileSync(path.join(repo, 'a.txt'), 'pre-existing WIP\n'); // status/diff HEAD would invoke the filter and the external driver
    const wt = wtAdd(sb, 'gate-inert', { detach: true, repo });
    fs.appendFileSync(path.join(wt, 'a.txt'), 'x\n');
    const ok = run(sb, { lane: 'l4', mode: 'review', effort: 'high', cwd: wt });
    expect(ok.code).toBe(0);
    expect(ok.status().tainted).toBe(false);
    expect(ok.ms).toBeLessThan(8000);
    expect(fs.existsSync(marker)).toBe(false);
    const wt2 = wtAdd(sb, 'gate-hang', { detach: true, repo });
    // a SPARSE 16 GiB untracked file (no disk used): hashing its contents outlasts the 1 s snapshot deadline
    const fd = fs.openSync(path.join(wt2, 'huge.bin'), 'w');
    fs.ftruncateSync(fd, 16 * 2 ** 30);
    fs.closeSync(fd);
    const hang = run(sb, { lane: 'l4', mode: 'review', effort: 'high', cwd: wt2 }, [], { GSTACK_LANE_SNAPSHOT_TIMEOUT_S: '1' });
    expect(hang.code).toBe(1);
    expect(hang.status()).toMatchObject({ class: 'error', tainted: true });
    expect(hang.status().taint_detail).toContain('pre-review snapshot');
    expect(hang.ms).toBeLessThan(8000);
    expect(calls(sb, 'grok')).toHaveLength(1); // only the first, untainted review ran
  }, 30_000);

  test('F5: chmod +x on an existing disabled hook during a review taints it; so does deleting lanes.json', () => {
    const sb = mkSandbox();
    const repo = mkRepo(`perm-${path.basename(sb.dir)}`);
    const common = sh('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], repo);
    fs.writeFileSync(path.join(common, 'hooks', 'pre-push'), '#!/bin/sh\nexit 0\n', { mode: 0o644 }); // present but disabled
    step(sb, 'grok', `chmod +x ${sq(path.join(common, 'hooks', 'pre-push'))}\n${OK_GROK}`, 1);
    const a = run(sb, { lane: 'l4', mode: 'review', effort: 'high', cwd: wtAdd(sb, 'gate-p1', { detach: true, repo }) });
    expect(a.code).toBe(1);
    expect(a.status()).toMatchObject({ class: 'error', tainted: true });
    expect(a.status().taint_detail).toContain('control state changed');
    writeLanes(sb, { l2: { status: 'cooling', reason: 'quota', next_probe_at: '2099-01-01T00:00:00Z' } });
    step(sb, 'grok', `rm -f ${sq(path.join(sb.run, 'lanes.json'))}\n${OK_GROK}`, 2);
    const b = run(sb, { lane: 'l4', mode: 'review', effort: 'high', cwd: wtAdd(sb, 'gate-p2', { detach: true, repo }) });
    expect(b.code).toBe(1);
    expect(b.status()).toMatchObject({ class: 'error', tainted: true });
    expect(b.status().taint_detail).toContain('lanes.json disappeared');
  }, 30_000);

  test('L4 taint: chmod +x on a hook inside a SYMLINKED .git/hooks target, or retargeting that link, taints the review', () => {
    const sb = mkSandbox();
    const repo = mkRepo(`symhooks-${path.basename(sb.dir)}`);
    const common = sh('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], repo);
    const target = path.join(sb.dir, 'ext-hooks');
    const other = path.join(sb.dir, 'other-hooks');
    fs.mkdirSync(target); fs.mkdirSync(other);
    fs.writeFileSync(path.join(target, 'pre-push'), '#!/bin/sh\nexit 0\n', { mode: 0o644 });
    fs.writeFileSync(path.join(other, 'pre-push'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    fs.rmSync(path.join(common, 'hooks'), { recursive: true, force: true });
    fs.symlinkSync(target, path.join(common, 'hooks'));
    step(sb, 'grok', `chmod +x ${sq(path.join(target, 'pre-push'))}\n${OK_GROK}`, 1);
    step(sb, 'grok', `ln -sfn ${sq(other)} ${sq(path.join(common, 'hooks'))}\n${OK_GROK}`, 2);
    const a = run(sb, { lane: 'l4', mode: 'review', effort: 'high', cwd: wtAdd(sb, 'gate-s1', { detach: true, repo }) });
    expect(a.status()).toMatchObject({ class: 'error', tainted: true });
    expect(a.status().taint_detail).toContain('control state changed');
    const b = run(sb, { lane: 'l4', mode: 'review', effort: 'high', cwd: wtAdd(sb, 'gate-s2', { detach: true, repo }) });
    expect(b.status()).toMatchObject({ class: 'error', tainted: true });
    expect(b.status().taint_detail).toContain('control state changed');
  }, 30_000);

});

describe('invariants across every recorded invocation', () => {
  test('no stub invocation ever received --always-approve; grok never got the prompt text in argv; codex always ran with --json', () => {
    expect(H.checkInvariants()).toBeGreaterThan(5);
  });
});
