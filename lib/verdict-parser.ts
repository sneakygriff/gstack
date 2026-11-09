/**
 * Verdict parser seam: the one place gstack consults the Jev `verdict` gate about what a
 * reviewer or relay output MEANS. Off unless GSTACK_VERDICT_PARSER=jev.
 *
 * SHADOW ONLY. Every caller computes its own regex verdict first and passes it in as
 * `ctx.regex`; the result's `verdict` is always that value. Jev's answer is logged:
 *   <run-dir>/jev-shadow.jsonl         every answer Jev gave
 *   <run-dir>/jev-disagreements.jsonl  the answers that differ from the regex verdict
 * Logs carry labels and a body hash, never the body.
 *
 * Callers invoke this only for the content judgement. Nonce echo, exit codes, stderr lane
 * classes, refusal detection and the tainted-hash journal run first, stay deterministic, and
 * never reach this file.
 *
 * `parser` on the result: "regex" flag off (callers emit no tag, output is unchanged) ·
 * "shadow" Jev answered and was logged · "fallback" Jev gave no usable answer (down, no key,
 * grey zone, timeout, malformed). Neither tag ever changes a verdict, and a fallback is not
 * a degraded result.
 *
 * Library: parseVerdict(body, mode, ctx). The Workflow VM behind autobuilder-unit.js cannot
 * import anything, so its relay agents use the CLI:
 *   bun lib/verdict-parser.ts --mode <m> --regex <label> [--run-dir <d>] [--source <s>] [--file <f>]
 * (stdin without --file). It prints one JSON line; exit 2 is a usage error, anything else 0.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export const JEV_GATES_PIN = '2a868a6a4aa94dda8d745e4bd50720d8bdbe3472';

/** Above the gate's own 20 s wall clock, so the gate reports its timeout when it can. */
const JEV_GATE_TIMEOUT_MS = 25_000;
const MAX_ENVELOPE_BYTES = 1024 * 1024;

const REVIEW_LABELS = ['PRESENT_CLEAN', 'PRESENT_P1', 'INVALID'] as const;
const LABELS = {
  adjudicate: REVIEW_LABELS,
  'codex-review': REVIEW_LABELS,
  seatc: ['READY', 'BLOCKED'],
  'ci-status': ['pass', 'fail', 'pending', 'timeout', 'none', 'head_moved', 'not_mergeable', 'api_error'],
  panel: ['PASS', 'CONCERNS', 'BLOCK', 'INVALID'],
} as const;

export type VerdictMode = keyof typeof LABELS;
export type VerdictParser = 'regex' | 'shadow' | 'fallback';

export interface VerdictContext {
  /** The verdict the existing regex path reached, in the mode's vocabulary. Always returned. */
  regex: string;
  /** Where the logs go. Default: $GSTACK_VERDICT_RUN_DIR, else $GSTACK_HOME/verdict-shadow. */
  runDir?: string;
  /** Names the reviewed output in the logs (a path or a voice), so it can be labelled later. */
  source?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
}

export interface VerdictResult {
  verdict: string;
  parser: VerdictParser;
  /** Jev's answer, present only when `parser` is "shadow". */
  jev?: string;
}

interface JevAnswer {
  verdict: string;
  model?: unknown;
  receipt?: unknown;
}

function isMode(value: string | undefined): value is VerdictMode {
  return value !== undefined && Object.prototype.hasOwnProperty.call(LABELS, value);
}

function jevGateCommand(env: NodeJS.ProcessEnv): string[] {
  return env.GSTACK_JEV_GATE_BIN ? [env.GSTACK_JEV_GATE_BIN] : ['bunx', `github:sneakygriff/jev-gates#${JEV_GATES_PIN}`];
}

/** Jev's answer, or null for anything short of an in-vocabulary verdict from Jev itself. */
function askJev(body: string, mode: VerdictMode, env: NodeJS.ProcessEnv, timeoutMs: number): JevAnswer | null {
  const [cmd, ...prefix] = jevGateCommand(env);
  const run = spawnSync(cmd!, [...prefix, 'verdict', '--mode', mode], {
    input: body,
    encoding: 'utf8',
    env,
    timeout: timeoutMs,
    killSignal: 'SIGKILL',
    maxBuffer: MAX_ENVELOPE_BYTES,
  });
  // Exit 1 is the gate's "ran, blocking decision"; anything else means it did not answer.
  if (run.error || (run.status !== 0 && run.status !== 1)) return null;
  const line = String(run.stdout).trim().split('\n').pop() ?? '';
  const envelope = JSON.parse(line) as Record<string, unknown>;
  if (envelope.gate !== 'verdict' || envelope.parser !== 'jev') return null;
  const verdict = envelope.verdict;
  if (typeof verdict !== 'string' || !(LABELS[mode] as readonly string[]).includes(verdict)) return null;
  return { verdict, model: envelope.model, receipt: envelope.receipt };
}

function resolveRunDir(ctx: VerdictContext, env: NodeJS.ProcessEnv): string {
  if (ctx.runDir) return ctx.runDir;
  if (env.GSTACK_VERDICT_RUN_DIR) return env.GSTACK_VERDICT_RUN_DIR;
  return path.join(env.GSTACK_HOME || path.join(env.HOME || os.homedir(), '.gstack'), 'verdict-shadow');
}

function appendRow(file: string, row: Record<string, unknown>): void {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.appendFileSync(file, `${JSON.stringify(row)}\n`, { mode: 0o600 });
}

function logAnswer(body: string, mode: VerdictMode, ctx: VerdictContext, env: NodeJS.ProcessEnv, jev: JevAnswer): void {
  const runDir = resolveRunDir(ctx, env);
  const agree = jev.verdict === ctx.regex;
  const row = {
    ts: new Date().toISOString(),
    mode,
    regex: ctx.regex,
    jev: jev.verdict,
    agree,
    source: ctx.source ?? null,
    body_sha256: createHash('sha256').update(body).digest('hex'),
    model: jev.model ?? null,
    receipt: jev.receipt ?? null,
  };
  appendRow(path.join(runDir, 'jev-shadow.jsonl'), row);
  if (!agree) appendRow(path.join(runDir, 'jev-disagreements.jsonl'), row);
}

/**
 * Returns the caller's regex verdict, tagged with what happened to Jev's shadow reading.
 * Never throws and never writes to stdout or stderr: both adjudicate and the panel relay
 * their stdout verbatim.
 */
export function parseVerdict(body: string, mode: VerdictMode, ctx: VerdictContext): VerdictResult {
  const env = ctx.env ?? process.env;
  if (env.GSTACK_VERDICT_PARSER !== 'jev') return { verdict: ctx.regex, parser: 'regex' };

  let jev: JevAnswer | null = null;
  try {
    jev = askJev(body, mode, env, ctx.timeoutMs ?? JEV_GATE_TIMEOUT_MS);
  } catch {
    jev = null;
  }
  if (!jev) return { verdict: ctx.regex, parser: 'fallback' };

  try {
    logAnswer(body, mode, ctx, env, jev);
  } catch {
    // A shadow log that cannot be written must not disturb the verdict it shadows.
  }
  return { verdict: ctx.regex, parser: 'shadow', jev: jev.verdict };
}

function main(argv: string[]): number {
  const named: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i]!;
    const value = argv[i + 1];
    if (!flag.startsWith('--') || value === undefined) {
      console.error('usage: verdict-parser --mode <m> --regex <label> [--run-dir <d>] [--source <s>] [--file <f>]');
      return 2;
    }
    named[flag.slice(2)] = value;
  }
  const { mode, regex } = named;
  if (!isMode(mode) || !regex || !/^[A-Za-z_]+$/.test(regex)) {
    console.error(`verdict-parser: --mode must be one of ${Object.keys(LABELS).join(', ')}, and --regex a bare label`);
    return 2;
  }
  let body: string;
  try {
    body = fs.readFileSync(named.file ?? 0, 'utf8');
  } catch {
    console.log(JSON.stringify({ verdict: regex, parser: 'fallback' }));
    return 0;
  }
  console.log(JSON.stringify(parseVerdict(body, mode, { regex, runDir: named['run-dir'], source: named.source ?? named.file })));
  return 0;
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
