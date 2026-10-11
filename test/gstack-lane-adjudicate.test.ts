/**
 * bin/gstack-lane adjudicate (D4/H9) — the forum-member verdict moved out of the skill's
 * prose `_adj` into the helper. Covers the 17-case adjudication matrix the skill's recipe
 * was verified against (fix-b2: tainted+error, rejected, quota, auth, throttle, timeout,
 * ok/sol, luna-vs-sol, astra-substituting-sol, sol-vs-astra, null model, stale sha, empty
 * body, non-zero exit, grok mismatch, class-error-with-[P1]-body, no-status), the
 * INVALID-before-ABSENT order, the review-body P1 parser, and two end-to-end runs whose
 * status files the helper itself wrote. Uses test/helpers/gstack-lane-harness.ts (STUB CLIs).
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { codexStep, makeLaneHarness } from './helpers/gstack-lane-harness';

const H = makeLaneHarness('gstack-lane-adj');
const { mkSandbox, step, lane, freshOut, run, wtAdd, sh, repo } = H;

beforeAll(() => H.setup());
afterAll(() => H.teardown());

const SHA = '0123456789abcdef0123456789abcdef01234567';
type Seat = 'codex' | 'grok';
let seq = 0;

/** A review attempt as the helper records it (flat status keys), with overrides. body null = nothing published. */
function mk(sb: ReturnType<typeof mkSandbox>, seat: Seat, over: Record<string, unknown> = {}, body: string | null = 'Looks fine.\nThere are no [P1] issues.\nREVIEW_COMPLETE: findings=0\n', o: { noStatus?: boolean; raw?: string } = {}) {
  seq += 1;
  const task = `gate-m1-${seat}`;
  const aid = `adj${seq}`;
  const dir = path.join(sb.run, 'attempts', task, aid);
  fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, 'review.md');
  if (body !== null) fs.writeFileSync(out, seat === 'codex' ? body : JSON.stringify({ text: body, modelUsage: { 'grok-4.7-build': { outputTokens: 9 } } }));
  const status = {
    attempt_id: aid, task, lane: seat === 'codex' ? 'l3' : 'l4', mode: 'review',
    requested_model: seat === 'codex' ? 'gpt-6.1-sol' : 'grok-4.7-build', runtime_model: seat === 'codex' ? 'gpt-6.1-sol' : 'grok-4.7-build',
    model_mismatch: false, exit: 0, class: 'ok', class_detail: null, exit_code: 0, out, published: body !== null,
    reviewed_sha: SHA, tainted: false, taint_checked: seat === 'grok', ...(seat === 'grok' ? { grok_project_config_stripped: true } : {}),
    attempts: [{ n: 1, class: 'ok' }], ...over,
  };
  if (o.raw !== undefined) fs.writeFileSync(`${out}.status.json`, o.raw);
  else if (!o.noStatus) fs.writeFileSync(`${out}.status.json`, JSON.stringify(status, null, 2));
  return out;
}
function adj(sb: ReturnType<typeof mkSandbox>, out: string, seat: Seat, gate = 'ordinary', req: string | null = seat === 'codex' ? 'gpt-6.1-sol' : null, sha = SHA) {
  const r = lane(sb, ['adjudicate', '--out', out, '--seat', seat, '--gate-class', gate, '--reviewed-sha', sha, ...(req ? ['--requested-model', req] : [])]);
  return { code: r.code, line: r.out.trim() };
}
const V = (verdict: string, reason: string, p1: number, rm: string | null) => `VERDICT=${verdict} reason=${reason} p1_count=${p1} runtime_model=${rm ?? 'null'}`;
const CODE: Record<string, number> = { PRESENT_CLEAN: 0, PRESENT_P1: 10, INVALID: 11, ABSENT: 12 };

describe('bin/gstack-lane adjudicate: the 17-case matrix (INVALID before ABSENT)', () => {
  test('every case maps to the skill-verified verdict, exit code and reason', () => {
    const sb = mkSandbox();
    const cases: [string, Seat, string, string | null, Record<string, unknown>, string | null | undefined, { noStatus?: boolean } | undefined, string, string, number, string | null][] = [
      // label, seat, gate, requested, status overrides, body (undefined = a clean default), opts, verdict, reason, p1, runtime_model
      ['tainted + error', 'grok', 'ordinary', null, { class: 'error', tainted: true, class_detail: 'tainted: review or primary worktree changed', exit_code: 1 }, null, undefined, 'INVALID', 'tainted', 0, 'grok-4.7-build'],
      ['rejected refusal', 'codex', 'ordinary', 'gpt-6.1-sol', { class: 'error', rejected: 'l3 never runs effort ultra', exit: null, exit_code: 1, runtime_model: null }, null, undefined, 'INVALID', 'rejected', 0, null],
      ['quota', 'codex', 'ordinary', 'gpt-6.1-sol', { class: 'quota', exit: 1, exit_code: 4, runtime_model: null }, null, undefined, 'ABSENT', 'quota', 0, null],
      ['auth', 'codex', 'ordinary', 'gpt-6.1-sol', { class: 'auth', exit: 1, exit_code: 5, runtime_model: null }, null, undefined, 'ABSENT', 'auth', 0, null],
      ['throttle', 'grok', 'ordinary', null, { class: 'throttle', exit: 1, exit_code: 3 }, null, undefined, 'ABSENT', 'throttle', 0, 'grok-4.7-build'],
      ['timeout', 'codex', 'critical', 'gpt-6-astra', { class: 'timeout', exit: 124, exit_code: 124, runtime_model: null }, null, undefined, 'ABSENT', 'timeout', 0, null],
      ['ok / sol on an ordinary gate', 'codex', 'ordinary', 'gpt-6.1-sol', {}, undefined, undefined, 'PRESENT_CLEAN', 'no_p1', 0, 'gpt-6.1-sol'],
      ['luna instead of sol', 'codex', 'ordinary', 'gpt-6.1-sol', { runtime_model: 'gpt-6-luna' }, undefined, undefined, 'INVALID', 'runtime_model_not_allowed', 0, 'gpt-6-luna'],
      ['astra substituting for sol', 'codex', 'ordinary', 'gpt-6.1-sol', { runtime_model: 'gpt-6-astra' }, undefined, undefined, 'PRESENT_CLEAN', 'no_p1', 0, 'gpt-6-astra'],
      ['sol on a critical (astra) gate', 'codex', 'critical', 'gpt-6-astra', { runtime_model: 'gpt-6.1-sol' }, undefined, undefined, 'INVALID', 'runtime_model_not_allowed', 0, 'gpt-6.1-sol'],
      ['null runtime model (codex)', 'codex', 'ordinary', 'gpt-6.1-sol', { runtime_model: null }, undefined, undefined, 'INVALID', 'runtime_model_unverified', 0, null],
      ['stale reviewed_sha', 'codex', 'ordinary', 'gpt-6.1-sol', { reviewed_sha: 'f'.repeat(40) }, undefined, undefined, 'INVALID', 'stale_sha', 0, 'gpt-6.1-sol'],
      ['empty body', 'codex', 'ordinary', 'gpt-6.1-sol', {}, '  \n\t\n', undefined, 'INVALID', 'empty_body', 0, 'gpt-6.1-sol'],
      ['non-zero exit', 'codex', 'ordinary', 'gpt-6.1-sol', { exit: 1 }, undefined, undefined, 'INVALID', 'nonzero_exit', 0, 'gpt-6.1-sol'],
      ['grok family mismatch (a note, never a failure)', 'grok', 'critical', null, { runtime_model: 'grok-4.6-build', model_mismatch: true }, undefined, undefined, 'PRESENT_CLEAN', 'no_p1,model_mismatch', 0, 'grok-4.6-build'],
      ['class error with [P1]s in the body', 'codex', 'ordinary', 'gpt-6.1-sol', { class: 'error', exit: 1, exit_code: 1, class_detail: 'exit 1 after turn.completed', published: false }, '- [P1] real bug\n', undefined, 'INVALID', 'class_error', 0, 'gpt-6.1-sol'],
      ['no status file (helper never ran)', 'codex', 'ordinary', 'gpt-6.1-sol', {}, null, { noStatus: true }, 'ABSENT', 'no_status', 0, null],
    ];
    expect(cases).toHaveLength(17);
    const got = cases.map(([label, seat, gate, req, over, body, o]) => {
      const out = mk(sb, seat, over, body === undefined ? 'Looks fine.\nThere are no [P1] issues.\nREVIEW_COMPLETE: findings=0\n' : body, o ?? {});
      return { label, ...adj(sb, out, seat, gate, req) };
    });
    expect(got).toEqual(cases.map(([label, , , , , , , verdict, reason, p1, rm]) => ({ label, code: CODE[verdict], line: V(verdict, reason, p1, rm) })));
  }, 30_000);

  test('the rest of the order: skipped availability, unknown class, wrong seat/mode/attempt, unreadable status, grok without taint check', () => {
    const sb = mkSandbox();
    const at = (seat: Seat, over: Record<string, unknown>, o: { raw?: string } = {}) => adj(sb, mk(sb, seat, over, undefined, o), seat);
    expect(at('codex', { class: 'quota', skipped: 'cooling', exit: null, exit_code: 4, runtime_model: null }).line).toBe(V('ABSENT', 'quota_skipped_cooling', 0, null));
    expect(at('grok', { class: 'auth', skipped: 'absent', exit: null, exit_code: 5 }).line).toBe(V('ABSENT', 'auth_skipped_absent', 0, 'grok-4.7-build'));
    expect(at('codex', { class: 'weird' }).line).toBe(V('INVALID', 'unknown_class', 0, 'gpt-6.1-sol'));
    expect(at('codex', { lane: 'l2' }).line).toBe(V('INVALID', 'seat_mismatch', 0, 'gpt-6.1-sol'));
    expect(at('codex', { mode: 'impl' }).line).toBe(V('INVALID', 'not_a_review', 0, 'gpt-6.1-sol'));
    expect(at('codex', { exit_code: 1 }).line).toBe(V('INVALID', 'nonzero_exit', 0, 'gpt-6.1-sol'));
    expect(at('codex', { out: path.join(sb.run, 'attempts', 'gate-m0-codex', 'old', 'review.md') }).line).toBe(V('INVALID', 'attempt_mismatch', 0, 'gpt-6.1-sol'));
    expect(at('codex', { attempt_id: 'another-attempt' }).line).toBe(V('INVALID', 'attempt_mismatch', 0, 'gpt-6.1-sol'));
    expect(at('codex', {}, { raw: '{"class": "ok", "tainted": fals' }).line).toBe(V('INVALID', 'status_unreadable', 0, null));
    expect(at('codex', {}, { raw: '[]' }).line).toBe(V('INVALID', 'status_unreadable', 0, null));
    expect(at('grok', { taint_checked: false }).line).toBe(V('INVALID', 'taint_unchecked', 0, 'grok-4.7-build'));
    expect(at('grok', { grok_project_config_stripped: false }).line).toBe(V('INVALID', 'grok_config_not_stripped', 0, 'grok-4.7-build')); // S4
    expect(at('codex', { published: false }).line).toBe(V('INVALID', 'empty_body', 0, 'gpt-6.1-sol'));
    // tainted outranks an availability class (INVALID before ABSENT)
    expect(at('codex', { class: 'quota', tainted: true }).line).toBe(V('INVALID', 'tainted', 0, 'gpt-6.1-sol'));
    // codex on a critical gate: astra requested, astra ran
    const astra = mk(sb, 'codex', { requested_model: 'gpt-6-astra', runtime_model: 'gpt-6-astra' });
    expect(adj(sb, astra, 'codex', 'critical', 'gpt-6-astra').line).toBe(V('PRESENT_CLEAN', 'no_p1', 0, 'gpt-6-astra'));
    // an astra-requested ORDINARY gate may not silently get sol
    expect(adj(sb, mk(sb, 'codex', {}), 'codex', 'ordinary', 'gpt-6-astra').line).toBe(V('INVALID', 'runtime_model_not_allowed', 0, 'gpt-6.1-sol'));
  }, 30_000);

  test('usage errors exit 2 and print no verdict', () => {
    const sb = mkSandbox();
    const out = mk(sb, 'codex');
    for (const args of [
      ['adjudicate', '--seat', 'codex', '--gate-class', 'ordinary', '--reviewed-sha', SHA, '--requested-model', 'gpt-6.1-sol'], // no --out
      ['adjudicate', '--out', out, '--seat', 'l3', '--gate-class', 'ordinary', '--reviewed-sha', SHA, '--requested-model', 'gpt-6.1-sol'],
      ['adjudicate', '--out', out, '--seat', 'codex', '--gate-class', 'big', '--reviewed-sha', SHA, '--requested-model', 'gpt-6.1-sol'],
      ['adjudicate', '--out', out, '--seat', 'codex', '--gate-class', 'ordinary', '--reviewed-sha', 'HEAD', '--requested-model', 'gpt-6.1-sol'],
      ['adjudicate', '--out', out, '--seat', 'codex', '--gate-class', 'ordinary', '--reviewed-sha', SHA], // codex needs --requested-model
      ['adjudicate', '--out', out, '--seat', 'codex', '--gate-class', 'ordinary', '--reviewed-sha', SHA, '--requested-model', 'x y'],
    ]) {
      const r = lane(sb, args);
      expect({ args: args.join(' '), code: r.code, out: r.out }).toEqual({ args: args.join(' '), code: 2, out: '' });
    }
  });
});

describe('bin/gstack-lane adjudicate: review-body P1 parsing', () => {
  test('only a LEADING [P1]/[P0] tag counts — list markers, checkboxes, headings, quotes, tables, emphasis, CRLF; prose mentions never', () => {
    const sb = mkSandbox();
    const p1 = (body: string, seat: Seat = 'codex') => adj(sb, mk(sb, seat, {}, body), seat).line;
    const done = (n: number) => `\nREVIEW_COMPLETE: findings=${n}`;
    expect(p1(`There are no [P1] issues.\n[P2] a nit\nNo [P0] either.${done(1)}`)).toBe(V('PRESENT_CLEAN', 'no_p1', 0, 'gpt-6.1-sol'));
    expect(p1(['[P1] a', '- [P1] b', '  * **[P1]** c', '1. [P0] d', '### [P1] e', '> [p1] f', '| [P1] | g |', '`[P1]` h', '- [ ] [P1] i', '2) __[P1]__ j'].join('\n') + done(10)))
      .toBe(V('PRESENT_P1', 'p1_found', 10, 'gpt-6.1-sol'));
    expect(p1('Summary\r\n- [P1] crlf finding\r\n- [P2] minor\r\nREVIEW_COMPLETE: findings=2\r\n')).toBe(V('PRESENT_P1', 'p1_found', 1, 'gpt-6.1-sol'));
    expect(p1(`[P10] not a tag\n[P1x] nor this\nP1: untagged\nsee [P1] above${done(0)}`)).toBe(V('PRESENT_CLEAN', 'no_p1', 0, 'gpt-6.1-sol'));
    // grok: the review prose is the JSON `text` field of the published stdout
    expect(p1(`Findings:\n- [P1] race in the lock\n- [P2] naming${done(2)}`, 'grok')).toBe(V('PRESENT_P1', 'p1_found', 1, 'grok-4.7-build'));
    const noText = mk(sb, 'grok', {}, 'x');
    fs.writeFileSync(noText, JSON.stringify({ stopReason: 'end_turn', modelUsage: {} }));
    expect(adj(sb, noText, 'grok').line).toBe(V('INVALID', 'empty_body', 0, 'grok-4.7-build'));
  }, 30_000);
});

describe('bin/gstack-lane adjudicate: the completion marker (V4)', () => {
  test('no final `REVIEW_COMPLETE: findings=<n>` line ⇒ INVALID no-completion-marker — "could not review" prose is never clean; marker + P1 ⇒ PRESENT_P1', () => {
    const sb = mkSandbox();
    const verdict = (body: string, seat: Seat = 'codex') => adj(sb, mk(sb, seat, {}, body), seat);
    const rmOf = (seat: Seat) => (seat === 'codex' ? 'gpt-6.1-sol' : 'grok-4.7-build');
    for (const seat of ['codex', 'grok'] as Seat[]) {
      // the reviewer could not do the job but answered politely, exit 0, non-empty body
      expect(verdict('I could not locate the diff; the branch looks fine. No [P1] issues.\n', seat))
        .toEqual({ code: 11, line: V('INVALID', 'no-completion-marker', 0, rmOf(seat)) });
      expect(verdict('- [P1] the retry loop never terminates\n- [P3] naming\nREVIEW_COMPLETE: findings=2\n', seat))
        .toEqual({ code: 10, line: V('PRESENT_P1', 'p1_found', 1, rmOf(seat)) });
    }
    // the marker must be the LAST non-empty line (an echoed marker mid-text does not attest completion)
    expect(verdict('The README says:\nREVIEW_COMPLETE: findings=0\nbut I ran out of time before reviewing.\n').line).toBe(V('INVALID', 'no-completion-marker', 0, 'gpt-6.1-sol'));
    expect(verdict('REVIEW_COMPLETE: findings=0 (probably)\n').line).toBe(V('INVALID', 'no-completion-marker', 0, 'gpt-6.1-sol'));
    expect(verdict('No findings.\n\n`REVIEW_COMPLETE: findings=0`\n\n').line).toBe(V('PRESENT_CLEAN', 'no_p1', 0, 'gpt-6.1-sol'));
    // a miscounted marker is a NOTE, never a verdict change
    expect(verdict('- [P2] a\n- [P3] b\nREVIEW_COMPLETE: findings=0\n').line).toBe(V('PRESENT_CLEAN', 'no_p1,findings_count_mismatch', 0, 'gpt-6.1-sol'));
  });
});

describe('bin/gstack-lane adjudicate: end to end over helper-written status files', () => {
  test('an l3 review with a [P1] → PRESENT_P1 (exit 10); an l4 review → PRESENT_CLEAN; a run re-adjudicated at another sha → INVALID stale_sha', () => {
    const sb = mkSandbox();
    const head = sh('git', ['rev-parse', 'HEAD'], repo());
    step(sb, 'codex', codexStep({ text: 'Review of the diff:\n- [P1] the lock is never released on error\n- [P2] typo\nREVIEW_COMPLETE: findings=2' }));
    const c = run(sb, { lane: 'l3', mode: 'review', model: 'gpt-6.1-sol', effort: 'high', cwd: wtAdd(sb, 'gate-e2e-codex', { detach: true }), out: freshOut(sb, 'gate-e2e-codex') });
    expect(c.code).toBe(0);
    expect(adj(sb, c.outPath, 'codex', 'ordinary', 'gpt-6.1-sol', head)).toEqual({ code: 10, line: V('PRESENT_P1', 'p1_found', 1, 'gpt-6.1-sol') });
    expect(adj(sb, c.outPath, 'codex', 'ordinary', 'gpt-6.1-sol', 'e'.repeat(40)).line).toBe(V('INVALID', 'stale_sha', 0, 'gpt-6.1-sol'));
    step(sb, 'grok', `echo '${JSON.stringify({ text: 'LGTM: no issues.\nREVIEW_COMPLETE: findings=0', stopReason: 'end_turn', modelUsage: { 'grok-4.7-build': { outputTokens: 20 } } })}'\n`);
    const g = run(sb, { lane: 'l4', mode: 'review', effort: 'high', cwd: wtAdd(sb, 'gate-e2e-grok', { detach: true }), out: freshOut(sb, 'gate-e2e-grok') });
    expect(g.code).toBe(0);
    expect(adj(sb, g.outPath, 'grok', 'ordinary', null, head)).toEqual({ code: 0, line: V('PRESENT_CLEAN', 'no_p1', 0, 'grok-4.7-build') });
    expect(adj(sb, g.outPath, 'codex', 'ordinary', 'gpt-6.1-sol', head).line).toBe(V('INVALID', 'seat_mismatch', 0, 'grok-4.7-build'));
  }, 30_000);
});
