/**
 * lib/verdict-parser.ts and the seams that use it: GSTACK_VERDICT_PARSER=jev is shadow only.
 * The regex verdict always decides, Jev's reading is logged, and every deterministic check
 * runs without Jev. Hermetic: a stub `jev-gate` replaces the vendor CLI, no network.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { parseVerdict, type VerdictMode } from '../lib/verdict-parser';
import { parseVoiceResult } from '../lib/outside-voices/registry';
import { makeLaneHarness } from './helpers/gstack-lane-harness';

const ROOT = path.join(import.meta.dir, '..');
const CLI = path.join(ROOT, 'lib', 'verdict-parser.ts');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'verdict-parser-'));
let seq = 0;

afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

/** A sandbox with a stub jev-gate that records each call and prints what it is told to. */
function sandbox(stubBody: string) {
  const dir = path.join(tmp, `s${++seq}`);
  fs.mkdirSync(dir, { recursive: true });
  const calls = path.join(dir, 'calls.log');
  const stdin = path.join(dir, 'stdin.txt');
  const bin = path.join(dir, 'jev-gate');
  fs.writeFileSync(bin, `#!/bin/bash\necho "$*" >> ${JSON.stringify(calls)}\ncat > ${JSON.stringify(stdin)}\n${stubBody}\n`, { mode: 0o755 });
  const runDir = path.join(dir, 'run');
  return {
    dir, runDir, bin,
    called: () => fs.existsSync(calls),
    argv: () => fs.readFileSync(calls, 'utf8').trim(),
    stdin: () => fs.readFileSync(stdin, 'utf8'),
    rows: (name: string) => {
      const f = path.join(runDir, name);
      return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim().split('\n').map(l => JSON.parse(l)) : [];
    },
    env: (over: Record<string, string> = {}) => ({ ...process.env, GSTACK_VERDICT_PARSER: 'jev', GSTACK_JEV_GATE_BIN: bin, ...over }),
  };
}
const answers = (verdict: string, parser = 'jev') =>
  `echo '${JSON.stringify({ gate: 'verdict', decision: 'PASS', verdict, parser, model: 'jev-1.14.0', receipt: 'r1' })}'`;
const SECRET_BODY = 'the review body must never reach a log\nREVIEW_COMPLETE: findings=0\n';

function call(sb: ReturnType<typeof sandbox>, env: NodeJS.ProcessEnv, regex = 'PRESENT_CLEAN', mode: VerdictMode = 'adjudicate', timeoutMs?: number) {
  return parseVerdict(SECRET_BODY, mode, { regex, runDir: sb.runDir, source: 'attempts/x/review.md', env, timeoutMs });
}

describe('parseVerdict flag gating', () => {
  for (const value of [undefined, '', 'JEV', '1', 'true', 'jev ']) {
    test(`GSTACK_VERDICT_PARSER=${JSON.stringify(value)} never runs the gate and tags nothing`, () => {
      const sb = sandbox(answers('PRESENT_P1'));
      const env = sb.env();
      if (value === undefined) delete env.GSTACK_VERDICT_PARSER;
      else env.GSTACK_VERDICT_PARSER = value;
      expect(call(sb, env)).toEqual({ verdict: 'PRESENT_CLEAN', parser: 'regex' });
      expect(sb.called()).toBe(false);
      expect(fs.existsSync(sb.runDir)).toBe(false);
    });
  }
});

describe('parseVerdict shadow', () => {
  test('agreement: regex decides, the answer is logged, no disagreement row', () => {
    const sb = sandbox(answers('PRESENT_CLEAN'));
    expect(call(sb, sb.env())).toEqual({ verdict: 'PRESENT_CLEAN', parser: 'shadow', jev: 'PRESENT_CLEAN' });
    expect(sb.rows('jev-shadow.jsonl')).toHaveLength(1);
    expect(sb.rows('jev-shadow.jsonl')[0]).toMatchObject({ agree: true, regex: 'PRESENT_CLEAN', jev: 'PRESENT_CLEAN' });
    expect(sb.rows('jev-disagreements.jsonl')).toEqual([]);
  });
  test('disagreement: the regex verdict is still returned and the row names both sides', () => {
    const sb = sandbox(answers('PRESENT_P1'));
    expect(call(sb, sb.env())).toEqual({ verdict: 'PRESENT_CLEAN', parser: 'shadow', jev: 'PRESENT_P1' });
    const [row] = sb.rows('jev-disagreements.jsonl');
    expect(row).toMatchObject({ mode: 'adjudicate', regex: 'PRESENT_CLEAN', jev: 'PRESENT_P1', agree: false, source: 'attempts/x/review.md', model: 'jev-1.14.0', receipt: 'r1' });
    expect(row.body_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(sb.rows('jev-shadow.jsonl')).toHaveLength(1);
  });
  test('the body travels on stdin, the mode in argv, and no log holds the body', () => {
    const sb = sandbox(answers('fail'));
    call(sb, sb.env(), 'pass', 'ci-status');
    expect(sb.argv()).toBe('verdict --mode ci-status');
    expect(sb.stdin()).toBe(SECRET_BODY);
    const logs = fs.readFileSync(path.join(sb.runDir, 'jev-disagreements.jsonl'), 'utf8') + fs.readFileSync(path.join(sb.runDir, 'jev-shadow.jsonl'), 'utf8');
    expect(logs).not.toContain('must never reach');
  });
  test('an unwritable run dir cannot disturb the verdict', () => {
    const sb = sandbox(answers('PRESENT_P1'));
    fs.writeFileSync(sb.runDir, 'a file where the run dir should be');
    expect(call(sb, sb.env()).verdict).toBe('PRESENT_CLEAN');
  });
  test('run dir defaults to $GSTACK_VERDICT_RUN_DIR, then $GSTACK_HOME/verdict-shadow', () => {
    const sb = sandbox(answers('PRESENT_P1'));
    parseVerdict('x', 'adjudicate', { regex: 'INVALID', env: sb.env({ GSTACK_VERDICT_RUN_DIR: sb.runDir }) });
    expect(sb.rows('jev-disagreements.jsonl')).toHaveLength(1);
    const home = path.join(sb.dir, 'home');
    parseVerdict('x', 'adjudicate', { regex: 'INVALID', env: { ...sb.env({ GSTACK_HOME: home }), GSTACK_VERDICT_RUN_DIR: '' } });
    expect(fs.existsSync(path.join(home, 'verdict-shadow', 'jev-disagreements.jsonl'))).toBe(true);
  });
});

describe('parseVerdict fallback: no usable answer means the regex verdict tagged fallback', () => {
  const noAnswer: [string, string][] = [
    ['the gate reports its own fallback (NO_ANSWER)', answers('PRESENT_P1', 'fallback')],
    ['exit 2 (usage or config error)', `${answers('PRESENT_P1')}; exit 2`],
    ['killed by a signal', 'kill -9 $$'],
    ['garbage stdout', 'echo not-json'],
    ['empty stdout', ':'],
    ['a verdict outside the mode vocabulary', answers('READY')],
    ['a different gate', `echo '{"gate":"copy","verdict":"PRESENT_P1","parser":"jev"}'`],
  ];
  for (const [label, stub] of noAnswer) {
    test(label, () => {
      const sb = sandbox(stub);
      expect(call(sb, sb.env())).toEqual({ verdict: 'PRESENT_CLEAN', parser: 'fallback' });
      expect(sb.called()).toBe(true);
      expect(fs.existsSync(path.join(sb.runDir, 'jev-disagreements.jsonl'))).toBe(false);
      expect(fs.existsSync(path.join(sb.runDir, 'jev-shadow.jsonl'))).toBe(false);
    });
  }
  test('a missing binary', () => {
    const sb = sandbox(':');
    expect(call(sb, sb.env({ GSTACK_JEV_GATE_BIN: path.join(sb.dir, 'nope') }))).toEqual({ verdict: 'PRESENT_CLEAN', parser: 'fallback' });
  });
  test('a hung gate is cut off at the timeout', () => {
    const sb = sandbox('exec sleep 30');
    const started = Date.now();
    expect(call(sb, sb.env(), 'PRESENT_CLEAN', 'adjudicate', 300)).toEqual({ verdict: 'PRESENT_CLEAN', parser: 'fallback' });
    expect(Date.now() - started).toBeLessThan(10_000);
  });
  test('exit 1 with an envelope is a blocking decision, so it still counts as an answer', () => {
    const sb = sandbox(`${answers('PRESENT_P1')}; exit 1`);
    expect(call(sb, sb.env()).parser).toBe('shadow');
  });
});

describe('verdict-parser CLI (the Workflow VM path)', () => {
  const cli = (args: string[], env: NodeJS.ProcessEnv, input = 'body') => spawnSync('bun', [CLI, ...args], { input, encoding: 'utf8', env, cwd: tmp });
  test('prints one JSON line and logs to --run-dir', () => {
    const sb = sandbox(answers('BLOCKED'));
    const r = cli(['--mode', 'seatc', '--regex', 'READY', '--run-dir', sb.runDir], sb.env(), 'SEATC status=PRESENT p1=0');
    expect(r.status).toBe(0);
    expect(r.stdout.trim().split('\n')).toHaveLength(1);
    expect(JSON.parse(r.stdout)).toEqual({ verdict: 'READY', parser: 'shadow', jev: 'BLOCKED' });
    expect(sb.stdin()).toBe('SEATC status=PRESENT p1=0');
    expect(sb.rows('jev-disagreements.jsonl')[0]).toMatchObject({ mode: 'seatc', regex: 'READY', jev: 'BLOCKED' });
  });
  test('an unreadable --file is a fallback, never an error', () => {
    const sb = sandbox(answers('BLOCKED'));
    const r = cli(['--mode', 'seatc', '--regex', 'READY', '--file', path.join(sb.dir, 'absent.md')], sb.env());
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({ verdict: 'READY', parser: 'fallback' });
    expect(sb.called()).toBe(false);
  });
  test('flag off: the regex label back, untagged by Jev, no gate run', () => {
    const sb = sandbox(answers('BLOCKED'));
    const env = sb.env();
    delete env.GSTACK_VERDICT_PARSER;
    expect(JSON.parse(cli(['--mode', 'seatc', '--regex', 'READY'], env).stdout)).toEqual({ verdict: 'READY', parser: 'regex' });
    expect(sb.called()).toBe(false);
  });
  for (const args of [['--mode', 'nope', '--regex', 'READY'], ['--mode', 'seatc', '--regex', 'a b'], ['--mode', 'seatc'], ['--mode']]) {
    test(`usage error: ${args.join(' ')}`, () => {
      const sb = sandbox(answers('BLOCKED'));
      expect(cli(args, sb.env()).status).toBe(2);
      expect(sb.called()).toBe(false);
    });
  }
});

// ── registry.ts: the nonce check is ahead of Jev and independent of it ─────────────────
describe('parseVoiceResult seam (panel mode)', () => {
  const NONCE = 'nonce-123';
  const raw = (over: Record<string, unknown> = {}) => JSON.stringify({ schema: 'outside-voice/v2', voice: 'codex', status: 'ready', verdict: 'PASS', findings: [], datamark: NONCE, ...over });
  const withEnv = <T>(env: Record<string, string>, fn: () => T): T => {
    const saved = { ...process.env };
    Object.assign(process.env, env);
    try { return fn(); } finally {
      for (const k of Object.keys(env)) { if (k in saved) process.env[k] = saved[k]; else delete process.env[k]; }
    }
  };
  const flag = (sb: ReturnType<typeof sandbox>, extra: Record<string, string> = {}) => ({ GSTACK_VERDICT_PARSER: 'jev', GSTACK_JEV_GATE_BIN: sb.bin, GSTACK_VERDICT_RUN_DIR: sb.runDir, ...extra });
  const parse = (r: string, nonce: string | undefined = NONCE) => parseVoiceResult(r, { voice: 'codex', requireDatamark: true, ...(nonce ? { datamark: nonce } : {}) });

  for (const [label, body] of [['missing', raw({ datamark: undefined })], ['wrong', raw({ datamark: 'forged' })]] as const) {
    test(`a ${label} nonce is rejected whatever Jev would answer, and Jev is never asked`, () => {
      const sb = sandbox(answers('PASS'));
      const result = withEnv(flag(sb), () => parse(body));
      expect(result.status).toBe('error');
      expect(result.verdict).toBeNull();
      expect(result.reason).toContain('datamark mismatch');
      expect(sb.called()).toBe(false);
      expect(result).not.toHaveProperty('parser');
    });
  }
  test('flag off: no parser key, no gate run', () => {
    const sb = sandbox(answers('BLOCK'));
    const result = withEnv({ GSTACK_JEV_GATE_BIN: sb.bin, GSTACK_VERDICT_RUN_DIR: sb.runDir }, () => {
      delete process.env.GSTACK_VERDICT_PARSER;
      return parse(raw());
    });
    expect(result).not.toHaveProperty('parser');
    expect(result.verdict).toBe('PASS');
    expect(sb.called()).toBe(false);
  });
  test('flag on, Jev down: identical to the regex result plus parser "fallback"', () => {
    const sb = sandbox('exit 2');
    delete process.env.GSTACK_VERDICT_PARSER;
    const off = parse(raw());
    const on = withEnv(flag(sb), () => parse(raw()));
    expect(on).toEqual({ ...off, parser: 'fallback' });
    expect(sb.called()).toBe(true);
  });
  test('flag on, Jev disagrees: the regex verdict stands, tagged shadow, row logged', () => {
    const sb = sandbox(answers('BLOCK'));
    const on = withEnv(flag(sb), () => parse(raw()));
    expect(on.verdict).toBe('PASS');
    expect(on.status).toBe('ready');
    expect(on.parser).toBe('shadow');
    expect(sb.rows('jev-disagreements.jsonl')[0]).toMatchObject({ mode: 'panel', regex: 'PASS', jev: 'BLOCK', source: 'codex' });
  });
  test('a parse that declares no authentication never reaches Jev', () => {
    const sb = sandbox(answers('BLOCK'));
    const on = withEnv(flag(sb), () => parseVoiceResult(raw({ datamark: undefined }), { voice: 'codex' }));
    expect(on.status).toBe('ready');
    expect(sb.called()).toBe(false);
  });
  test("gstack-vote's authentication re-parse (it passes a locationResolver) does not re-ask Jev", () => {
    const sb = sandbox(answers('BLOCK'));
    const on = withEnv(flag(sb), () => parseVoiceResult(raw(), { voice: 'codex', datamark: NONCE, requireDatamark: true, locationResolver: () => null } as never));
    expect(on.status).toBe('ready');
    expect(sb.called()).toBe(false);
  });
  test('an absent self-report carries no verdict, so Jev is not asked', () => {
    const sb = sandbox(answers('BLOCK'));
    const on = withEnv(flag(sb), () => parse(raw({ status: 'absent', verdict: undefined, datamark: undefined })));
    expect(on.status).toBe('absent');
    expect(sb.called()).toBe(false);
  });
});

// ── bin/gstack-lane adjudicate ─────────────────────────────────────────────────────────
describe('gstack-lane adjudicate seam', () => {
  const H = makeLaneHarness('verdict-parser-adj');
  const { mkSandbox, lane } = H;
  beforeAll(() => H.setup());
  afterAll(() => H.teardown());

  const SHA = '0123456789abcdef0123456789abcdef01234567';
  const CLEAN = 'Looks fine.\nThere are no [P1] issues.\nREVIEW_COMPLETE: findings=0\n';
  let n = 0;
  function attempt(sb: ReturnType<typeof mkSandbox>, body: string, over: Record<string, unknown> = {}) {
    const aid = `vp${++n}`;
    const dir = path.join(sb.run, 'attempts', 'gate-m1-codex', aid);
    fs.mkdirSync(dir, { recursive: true });
    const out = path.join(dir, 'review.md');
    fs.writeFileSync(out, body);
    fs.writeFileSync(`${out}.status.json`, JSON.stringify({
      attempt_id: aid, task: 'gate-m1-codex', lane: 'l3', mode: 'review', requested_model: 'gpt-6.1-sol', runtime_model: 'gpt-6.1-sol', model_mismatch: false,
      exit: 0, class: 'ok', class_detail: null, exit_code: 0, out, published: true, reviewed_sha: SHA, tainted: false, taint_checked: false, attempts: [{ n: 1, class: 'ok' }], ...over,
    }));
    return out;
  }
  const adjudicate = (sb: ReturnType<typeof mkSandbox>, out: string, env?: Record<string, string>) => {
    const r = lane(sb, ['adjudicate', '--out', out, '--seat', 'codex', '--gate-class', 'ordinary', '--reviewed-sha', SHA, '--requested-model', 'gpt-6.1-sol'], env);
    return { code: r.code, line: r.out.trim() };
  };
  const on = (stub: ReturnType<typeof sandbox>) => ({ GSTACK_VERDICT_PARSER: 'jev', GSTACK_JEV_GATE_BIN: stub.bin });
  const rowsIn = (sb: ReturnType<typeof mkSandbox>, name: string) => {
    const f = path.join(sb.run, name);
    return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim().split('\n').map(l => JSON.parse(l)) : [];
  };
  const CLEAN_LINE = 'VERDICT=PRESENT_CLEAN reason=no_p1 p1_count=0 runtime_model=gpt-6.1-sol';

  test('flag unset: the exact pre-seam line, and the gate never runs', () => {
    const stub = sandbox(answers('PRESENT_P1'));
    const sb = mkSandbox();
    expect(adjudicate(sb, attempt(sb, CLEAN), { GSTACK_JEV_GATE_BIN: stub.bin })).toEqual({ code: 0, line: CLEAN_LINE });
    expect(stub.called()).toBe(false);
    expect(rowsIn(sb, 'jev-shadow.jsonl')).toEqual([]);
  });
  test('flag on, Jev down: the same line and exit code, tagged parser=fallback', () => {
    const stub = sandbox('exit 2');
    const sb = mkSandbox();
    expect(adjudicate(sb, attempt(sb, CLEAN), on(stub))).toEqual({ code: 0, line: `${CLEAN_LINE} parser=fallback` });
    expect(stub.called()).toBe(true);
  });
  test('flag on, the parser module cannot load: the same line, tagged parser=fallback', () => {
    const stub = sandbox(answers('PRESENT_P1'));
    const sb = mkSandbox();
    const isolated = path.join(sb.dir, 'isolated', 'bin', 'gstack-lane');
    fs.mkdirSync(path.dirname(isolated), { recursive: true });
    fs.copyFileSync(path.join(ROOT, 'bin', 'gstack-lane'), isolated);
    fs.chmodSync(isolated, 0o755);
    const r = spawnSync(isolated, ['adjudicate', '--out', attempt(sb, CLEAN), '--seat', 'codex', '--gate-class', 'ordinary', '--reviewed-sha', SHA, '--requested-model', 'gpt-6.1-sol'], { cwd: sb.dir, encoding: 'utf8', env: { ...sb.env, ...on(stub) }, timeout: 25_000 });
    expect({ code: r.status, line: r.stdout.trim() }).toEqual({ code: 0, line: `${CLEAN_LINE} parser=fallback` });
    expect(stub.called()).toBe(false);
  });
  test('flag on, Jev disagrees: the regex verdict and exit code stand, disagreement in <run-dir>', () => {
    const stub = sandbox(answers('PRESENT_P1'));
    const sb = mkSandbox();
    const out = attempt(sb, CLEAN);
    expect(adjudicate(sb, out, on(stub))).toEqual({ code: 0, line: `${CLEAN_LINE} parser=shadow` });
    expect(rowsIn(sb, 'jev-disagreements.jsonl')[0]).toMatchObject({ mode: 'adjudicate', regex: 'PRESENT_CLEAN', jev: 'PRESENT_P1' });
    expect(fs.realpathSync(rowsIn(sb, 'jev-disagreements.jsonl')[0].source)).toBe(fs.realpathSync(out));
    expect(stub.stdin()).toBe(CLEAN);
  });
  test('a P1 regex verdict keeps exit 10 when Jev reads it clean', () => {
    const stub = sandbox(answers('PRESENT_CLEAN'));
    const sb = mkSandbox();
    const r = adjudicate(sb, attempt(sb, '[P1] a real bug\nREVIEW_COMPLETE: findings=1\n'), on(stub));
    expect(r).toEqual({ code: 10, line: 'VERDICT=PRESENT_P1 reason=p1_found p1_count=1 runtime_model=gpt-6.1-sol parser=shadow' });
  });
  test('no completion marker stays INVALID when Jev calls it clean, and that false stop is logged', () => {
    const stub = sandbox(answers('PRESENT_CLEAN'));
    const sb = mkSandbox();
    const r = adjudicate(sb, attempt(sb, 'A full review, but the final marker drifted.\n'), on(stub));
    expect(r).toEqual({ code: 11, line: 'VERDICT=INVALID reason=no-completion-marker p1_count=0 runtime_model=gpt-6.1-sol parser=shadow' });
    expect(rowsIn(sb, 'jev-disagreements.jsonl')[0]).toMatchObject({ regex: 'INVALID', jev: 'PRESENT_CLEAN' });
  });
  const deterministic: [string, Record<string, unknown>, string, number][] = [
    ['tainted', { tainted: true }, 'VERDICT=INVALID reason=tainted p1_count=0 runtime_model=gpt-6.1-sol', 11],
    ['non-zero exit', { exit: 1, exit_code: 1 }, 'VERDICT=INVALID reason=nonzero_exit p1_count=0 runtime_model=gpt-6.1-sol', 11],
    ['refusal', { class: 'error', rejected: 'refused' }, 'VERDICT=INVALID reason=rejected p1_count=0 runtime_model=gpt-6.1-sol', 11],
    ['quota lane class', { class: 'quota', exit: 1, exit_code: 4 }, 'VERDICT=ABSENT reason=quota p1_count=0 runtime_model=gpt-6.1-sol', 12],
    ['stale sha', { reviewed_sha: 'f'.repeat(40) }, 'VERDICT=INVALID reason=stale_sha p1_count=0 runtime_model=gpt-6.1-sol', 11],
  ];
  for (const [label, over, line, code] of deterministic) {
    test(`${label} is decided without Jev, even with the flag on and Jev saying clean`, () => {
      const stub = sandbox(answers('PRESENT_CLEAN'));
      const sb = mkSandbox();
      expect(adjudicate(sb, attempt(sb, CLEAN, over), on(stub))).toEqual({ code, line });
      expect(stub.called()).toBe(false);
    });
  }
  test('a disallowed runtime model stays INVALID: it is not a content verdict', () => {
    const stub = sandbox(answers('PRESENT_CLEAN'));
    const sb = mkSandbox();
    expect(adjudicate(sb, attempt(sb, CLEAN, { runtime_model: 'gpt-6-luna' }), on(stub))).toEqual({ code: 11, line: 'VERDICT=INVALID reason=runtime_model_not_allowed p1_count=0 runtime_model=gpt-6-luna' });
    expect(stub.called()).toBe(false);
  });
});
