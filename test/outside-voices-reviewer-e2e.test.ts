/**
 * Outside Voices — grok-as-reviewer / gemini-as-reviewer E2E (M3/T6).
 *
 * Drives the REAL reviewer call path — `bin/gstack-panel` at its real
 * repo-relative location (so it resolves its `lib/outside-voices/registry.ts`
 * sibling and does real schema-validated parsing, never the panel's bash-only
 * fallback) — for each of grok and gemini AS A VOICE, with ONLY that voice
 * enabled (a fresh, isolated `GSTACK_HOME` seeded via the REAL `bin/gstack-config`
 * binary: `codex_reviews=disabled`, `<other>_reviews=disabled`,
 * `<voice>_reviews=enabled`, `redact_repo_visibility=public` so the consent gate
 * and any `gh`/`glab` network probe never fire). This exercises the verbatim
 * per-voice sandbox flags (`grok … --sandbox read-only` / `gemini … --approval-mode
 * plan`), the file-based transport, the anti-injection nonce fencing
 * (`--untrusted-file` + `--datamark`, `wrapUntrusted` in the registry), and
 * `parseVoiceResult` end to end against a REAL model response — the one thing
 * `test/codex-e2e.test.ts` already proves for codex and neither
 * `test/gemini-e2e.test.ts` (a discovery smoke test only) nor any grok test
 * (none existed before this file) previously covered for the other two voices.
 *
 * Structured like `test/outside-voices-sandbox.test.ts` (the closest sibling —
 * same "spawn the real external CLI voices" shape) rather than
 * `test/codex-e2e.test.ts`'s codex-session-runner/worktree harness: there is no
 * "skill discovery" question here, only "does a real grok/gemini call round-trip
 * through gstack-panel's registry-backed parse into a schema-valid,
 * nonce-authenticated `<voice>.result.json`". Unlike the sandbox canary (which
 * classifies write-denial), this file classifies REVIEWER OUTPUT VALIDITY: a
 * `ready` record must echo the nonce and carry a well-formed verdict; a
 * non-ready (`absent`/`error`) record is accepted as an HONEST, classified
 * outcome (auth unavailable on this machine, a hung CLI, or a model that did
 * not follow the verdict-fence contract) — never a silent pass, never a hard
 * suite failure for something environmental. What IS asserted unconditionally,
 * regardless of status, is that none of THIS test's own engineered-permissive
 * gates (kill-switch / consent / redaction / under-voice / budget / receipt)
 * is the reason for a non-ready result — if one of those fired, the test
 * harness misconfigured the panel, not the CLI, and that is a real bug here.
 *
 * ── Tier gate + SKIP-IF-CLI-MISSING (mirrors codex-e2e.test.ts / gemini-e2e.test.ts) ──
 * Whole-file EVALS=1 + EVALS_TIER=periodic gate via the consolidated
 * `test/helpers/e2e-gate.ts` helper (the same helper `test/outside-voices-
 * sandbox.test.ts` — T7 of M1 — already migrated to; `describeE2ETier`/
 * `e2eTierEnabled` are recognized by `scripts/test-paid-shards.ts`'s
 * `classifyPaidTestFile` exactly like the raw `EVALS_TIER === 'periodic'`
 * predicate codex-e2e.test.ts/gemini-e2e.test.ts still use literally). Per
 * voice, a CLI that is missing OR present-but-unusable (bare `--help` probe,
 * 15s timeout — gemini-e2e.test.ts's own technique, applied symmetrically to
 * grok since no established grok usability probe exists yet) skips that
 * voice's test cleanly via `test.skipIf`. In the default/free run (no EVALS,
 * or EVALS_TIER!=='periodic') the whole `describe` block is `describe.skip`ed
 * — no gstack-panel spawn, no external CLI call, no spend, ever.
 *
 * Registration: `test/helpers/paid-test-set.ts` (`PAID_TEST_GLOBS`) — the ONE
 * definition package.json's `test:gate`/`test:evals` globs and the sharded
 * paid/free runners derive from. No `test/helpers/touchfiles-data.ts` entry:
 * like `outside-voices-sandbox.test.ts`, this file does not use
 * `selectTests`-based diff selection (a single fixed harness runs per voice,
 * not a menu of named sub-tests), so it has nothing to register there.
 */

import { describe, test, expect } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { randomBytes } from 'crypto';
import {
  VOICE_SCHEMA_ID,
  VOICE_STATUSES,
  VERDICTS,
  VENDOR_OF,
  OUTSIDE_VOICE_BOUNDARY,
  VERDICT_FENCE_BEGIN,
  VERDICT_FENCE_END,
} from '../lib/outside-voices/registry';
import { describeE2ETier, e2eTierEnabled } from './helpers/e2e-gate';

const ROOT = path.resolve(import.meta.dir, '..');
const PANEL_BIN = path.join(ROOT, 'bin', 'gstack-panel');
const CONFIG_BIN = path.join(ROOT, 'bin', 'gstack-config');

// --- Prerequisites / gating (periodic tier only — same shape as
// test/codex-e2e.test.ts / test/gemini-e2e.test.ts / test/outside-voices-
// sandbox.test.ts) ---

const evalsEnabled = e2eTierEnabled('periodic');

if (!!process.env.EVALS && !evalsEnabled) {
  process.stderr.write(
    "\nOutside Voices reviewer E2E: SKIPPED — external-service test, periodic tier only (EVALS_TIER === 'periodic')\n",
  );
}

const describeReviewerE2E = describeE2ETier('periodic');

type ReviewVoice = 'grok' | 'gemini';
const OTHER_VOICE: Record<ReviewVoice, ReviewVoice> = { grok: 'gemini', gemini: 'grok' };

function isBinaryAvailable(bin: string): boolean {
  try {
    return Bun.spawnSync(['which', bin]).exitCode === 0;
  } catch {
    return false;
  }
}

// A binary on PATH is not enough (gemini-e2e.test.ts's own lesson: the CLI can
// be present but UNUSABLE — a deprecated auth path or argv-parse error fails
// every run before any model call). Probe with a bare --help: a CLI that
// can't even print usage is unusable, and a working one is cheap to confirm.
// Applied to BOTH voices for symmetry — no established grok usability probe
// existed before this file.
function isCliUsable(bin: string): boolean {
  if (!isBinaryAvailable(bin)) return false;
  try {
    const result = Bun.spawnSync([bin, '--help'], { timeout: 15_000 });
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

const GROK_AVAILABLE = isBinaryAvailable('grok');
const GROK_USABLE = GROK_AVAILABLE && isCliUsable('grok');
const GEMINI_AVAILABLE = isBinaryAvailable('gemini');
const GEMINI_USABLE = GEMINI_AVAILABLE && isCliUsable('gemini');

if (evalsEnabled) {
  if (!GROK_AVAILABLE) {
    process.stderr.write('\nOutside Voices reviewer E2E: SKIPPED grok — grok binary not found on PATH\n');
  } else if (!GROK_USABLE) {
    process.stderr.write('\nOutside Voices reviewer E2E: SKIPPED grok — grok CLI present but unusable (--help failed)\n');
  }
  if (!GEMINI_AVAILABLE) {
    process.stderr.write('\nOutside Voices reviewer E2E: SKIPPED gemini — gemini binary not found on PATH (install: npm i -g @google/gemini-cli)\n');
  } else if (!GEMINI_USABLE) {
    process.stderr.write('\nOutside Voices reviewer E2E: SKIPPED gemini — gemini CLI present but unusable (auth path deprecated upstream or CLI broken)\n');
  }
}

// --- Fixture prompt/target ---------------------------------------------------

// Tiny, deliberately trivial review target — the point of this test is the
// PIPELINE (sandbox flags, transport, nonce, parse), not review quality.
const FIXTURE_DIFF = [
  '--- a/example.ts',
  '+++ b/example.ts',
  '@@ -1,3 +1,3 @@',
  ' function add(a: number, b: number): number {',
  '-  return a + b + 1; // off-by-one bug',
  '+  return a + b;',
  ' }',
  '',
].join('\n');

function buildPromptText(voice: ReviewVoice, vendor: string): string {
  return [
    OUTSIDE_VOICE_BOUNDARY,
    '',
    'You are an independent outside-voice code reviewer. This specific automated ' +
      'run is a structural test of the gstack outside-voices reviewer pipeline ' +
      '(test/outside-voices-reviewer-e2e.test.ts), not a production review — the ' +
      'reviewed content below is an intentionally tiny, synthetic diff. Review it. ' +
      'Be direct and terse.',
    '',
    'End your ENTIRE response with exactly one machine-readable verdict block ' +
      `between the fences ${VERDICT_FENCE_BEGIN} and ${VERDICT_FENCE_END}: a single ` +
      `JSON object of schema "${VOICE_SCHEMA_ID}" with fields "voice":"${voice}", ` +
      `"vendor":"${vendor}", "status":"ready", "verdict" (one of "PASS"|"CONCERNS"|"BLOCK"), ` +
      '"findings" (an array, may be empty [], each ' +
      '{"severity":"P0"|"P1"|"P2"|"P3","claim":string,"location":string|null,"repro_command":string|null}), ' +
      '"tokens":null, "cost_usd":null, and — REQUIRED — "datamark": the EXACT token ' +
      'shown in the [datamark:…] marker on the untrusted content fences below. Copy it ' +
      'verbatim; it authenticates your verdict and a mismatched or missing datamark is ' +
      'rejected.',
    '',
    'Example shape (replace the datamark value with the REAL one from the fences below):',
    VERDICT_FENCE_BEGIN,
    `{"schema":"${VOICE_SCHEMA_ID}","voice":"${voice}","vendor":"${vendor}","status":"ready","verdict":"PASS","findings":[],"tokens":null,"cost_usd":null,"datamark":"REPLACE_WITH_THE_REAL_DATAMARK"}`,
    VERDICT_FENCE_END,
    '',
  ].join('\n');
}

// --- Real bin/gstack-config seeding (isolated GSTACK_HOME) -------------------

/**
 * `GSTACK_HOME` is the one env var every state-touching script in this
 * pipeline honors: `bin/gstack-config`'s `STATE_DIR` fallback chain,
 * `bin/gstack-egress-lib.sh`'s `_gstack_egress_home` (fail-closed egress
 * receipts — no receipt, no send), and `bin/gstack-review-log`. Pointing it at
 * a fresh temp dir isolates ALL of that state from the developer/CI machine's
 * real `~/.gstack` — never `GSTACK_STATE_ROOT` alone, which the egress helpers
 * do NOT read.
 */
function setConfig(gstackHome: string, key: string, value: string): void {
  const r = Bun.spawnSync(['bash', CONFIG_BIN, 'set', key, value], {
    env: { ...process.env, GSTACK_HOME: gstackHome },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  if (r.exitCode !== 0) {
    throw new Error(`gstack-config set ${key} ${value} failed (exit ${r.exitCode}): ${r.stderr.toString()}`);
  }
}

// --- Real bin/gstack-panel invocation ----------------------------------------

const PANEL_KILL_TIMEOUT_MS = 570_000; // panel's own per-voice ladder (540s) + 30s wrapper/spawn slack
const TEST_TIMEOUT_MS = 600_000; // + slack for JSON parsing / assertions (mirrors codex-review-findings's 600_000ms budget)

interface PanelSpawnOutcome {
  timedOut: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

/** Spawn the REAL bin/gstack-panel with a manual timeout guard (mirrors
 *  test/outside-voices-sandbox.test.ts's runCanary — kill on timeout, track
 *  timedOut separately from exitCode since a killed process's exit code alone
 *  is not a reliable hang signal).
 *
 *  Neutralizes the ambient vendor session sentinels (GROK_AGENT / GEMINI_CLI /
 *  CODEX_THREAD_ID / CODEX_SANDBOX) before applying the caller's `env`
 *  overlay: this suite must exercise the REAL reviewer call path regardless
 *  of which host it happens to run under. If the runner itself is a live
 *  grok/gemini/codex session, the M3 under-<voice> nested-self-invocation
 *  guard (bin/gstack-panel `_panel_under_grok`/`_panel_under_gemini`) would
 *  otherwise correctly fire and mark the voice ABSENT(under-<voice>) —
 *  which `assertReviewerOutcome` below hard-fails on as a harness
 *  misconfiguration (it IS one: an environmental leak, not a real bug in the
 *  reviewer path). Same precedent as `test/skill-recipe-invariants.test.ts`'s
 *  FIX5 clears. */
async function runPanel(args: string[], cwd: string, env: Record<string, string>): Promise<PanelSpawnOutcome> {
  const proc = Bun.spawn(['bash', PANEL_BIN, ...args], {
    cwd,
    env: {
      ...process.env,
      GROK_AGENT: '',
      GEMINI_CLI: '',
      CODEX_THREAD_ID: '',
      CODEX_SANDBOX: '',
      ...env,
    },
    stdin: 'ignore', // production parity: gstack-panel invokes every CLI with </dev/null
    stdout: 'pipe',
    stderr: 'pipe',
  });

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill();
  }, PANEL_KILL_TIMEOUT_MS);

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  clearTimeout(timer);

  return { timedOut, exitCode, stdout, stderr };
}

interface ReviewerRunResult {
  voice: ReviewVoice;
  nonce: string;
  panel: PanelSpawnOutcome;
  resultExists: boolean;
  record: any;
  rawText: string;
  errText: string;
}

/**
 * Run ONE full, real reviewer call for `voice`: isolated GSTACK_HOME, only
 * `voice` enabled (codex + the other external voice explicitly disabled,
 * consent bypassed via a public-repo config override so no gh/glab network
 * probe ever runs), a tiny fixture diff delivered via --untrusted-file so the
 * panel's OWN wrapUntrusted fencing + nonce-stamping runs (not pre-assembled
 * by the test), and a fresh per-run --datamark nonce.
 */
async function runVoiceReviewer(voice: ReviewVoice): Promise<ReviewerRunResult> {
  const gstackHome = fs.mkdtempSync(path.join(os.tmpdir(), `outside-voices-reviewer-e2e-${voice}-home-`));
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), `outside-voices-reviewer-e2e-${voice}-cwd-`));
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), `outside-voices-reviewer-e2e-${voice}-out-`));

  try {
    // A plausible project root (codex refuses `exec` outside a trusted git
    // repo; harmless setup for grok/gemini too — outside-voices-sandbox.test.ts's
    // identical caveat). Does not touch buildArgv or add any flag under test.
    Bun.spawnSync(['git', 'init', '-q', cwd]);

    setConfig(gstackHome, 'codex_reviews', 'disabled');
    setConfig(gstackHome, `${voice}_reviews`, 'enabled');
    setConfig(gstackHome, `${OTHER_VOICE[voice]}_reviews`, 'disabled');
    // Public visibility bypasses the first-use per-vendor consent gate AND
    // the gh/glab network probe _panel_repo_visibility would otherwise try —
    // this test's isolated throwaway repo has no remote to ask about.
    setConfig(gstackHome, 'redact_repo_visibility', 'public');

    const vendor = VENDOR_OF[voice];
    const nonce = randomBytes(8).toString('hex');
    const promptFile = path.join(cwd, 'prompt.txt');
    const untrustedFile = path.join(cwd, 'untrusted.txt');
    fs.writeFileSync(promptFile, buildPromptText(voice, vendor));
    fs.writeFileSync(untrustedFile, FIXTURE_DIFF);

    const panel = await runPanel(
      [
        '--surface', 'review',
        '--prompt-file', promptFile,
        '--untrusted-file', untrustedFile,
        '--datamark', nonce,
        '--out-dir', outDir,
        '--wall-clock-s', '560',
      ],
      cwd,
      { GSTACK_HOME: gstackHome },
    );

    const resultPath = path.join(outDir, `${voice}.result.json`);
    const rawPath = path.join(outDir, `${voice}.raw`);
    const errPath = path.join(outDir, `${voice}.err`);
    const resultExists = fs.existsSync(resultPath);
    let record: any = null;
    if (resultExists) {
      try {
        record = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
      } catch {
        record = null;
      }
    }

    return {
      voice,
      nonce,
      panel,
      resultExists,
      record,
      rawText: fs.existsSync(rawPath) ? fs.readFileSync(rawPath, 'utf8') : '',
      errText: fs.existsSync(errPath) ? fs.readFileSync(errPath, 'utf8') : '',
    };
  } finally {
    fs.rmSync(gstackHome, { recursive: true, force: true });
    fs.rmSync(cwd, { recursive: true, force: true });
    fs.rmSync(outDir, { recursive: true, force: true });
  }
}

// Reasons that can ONLY come from this test's own engineered-permissive gate
// setup misfiring — never a real auth/CLI-behavior signal. If one of these
// shows up in a non-ready record's reason, the harness (not the external
// service) is broken.
const ENGINEERED_CAUSE_MARKERS = [
  'kill-switch',
  'consent-missing',
  'redaction-',
  'budget-capped',
  'config-unavailable',
  'receipt-failed',
] as const;

function assertReviewerOutcome(result: ReviewerRunResult): void {
  const { voice, nonce, panel, resultExists, record, rawText, errText } = result;

  if (rawText.trim()) process.stderr.write(`  [${voice} raw] ${rawText.trim().slice(0, 800)}\n`);
  if (errText.trim()) process.stderr.write(`  [${voice} err] ${errText.trim().slice(0, 800)}\n`);

  expect(
    resultExists,
    `${voice}.result.json must exist after a real gstack-panel run (panel exit ${panel.exitCode}, timedOut=${panel.timedOut})`,
  ).toBe(true);
  expect(record, `${voice}.result.json must contain valid JSON`).not.toBeNull();

  // Schema-valid regardless of outcome — parseVoiceResult's own invariant is
  // that a real result file is NEVER a silent guess: schema id, voice/vendor
  // attribution, and a recognized status must always hold, ready or not.
  expect(record.schema).toBe(VOICE_SCHEMA_ID);
  expect(record.voice).toBe(voice);
  expect(record.vendor).toBe(VENDOR_OF[voice]);
  expect(VOICE_STATUSES).toContain(record.status);

  if (record.status !== 'ready') {
    const reason: string = record.reason ?? '';
    for (const marker of ENGINEERED_CAUSE_MARKERS) {
      expect(
        reason,
        `${voice} must not be non-ready for an engineered-away cause ("${marker}") — this test's own ` +
          `config setup is supposed to make that gate a no-op: ${reason}`,
      ).not.toContain(marker);
    }
    // An under-<voice> nested-self-invocation guard firing here would also be
    // a harness bug (this process is not itself a live grok/gemini session).
    expect(reason, `${voice} must not be ABSENT(under-${voice}) in this harness`).not.toContain(`under-${voice}`);
  }

  if (record.status === 'ready') {
    // The real reviewer call path worked end to end against a REAL model
    // response: nonce authentication + schema validation both held.
    expect(record.datamark, 'a ready verdict must echo the panel nonce (anti-injection auth)').toBe(nonce);
    expect(VERDICTS).toContain(record.verdict);
    expect(Array.isArray(record.findings)).toBe(true);
  } else {
    // An honest, classified non-ready record (auth unavailable on this
    // machine, a hung CLI, or a model that did not follow the verdict-fence
    // contract) — never a silent pass, but never a hard suite failure for
    // something environmental either. Surfaced for CI visibility.
    expect(typeof record.reason).toBe('string');
    expect((record.reason ?? '').length).toBeGreaterThan(0);
    console.warn(`${voice} reviewer e2e: not ready (status=${record.status}) — ${record.reason}`);
  }
}

// --- Tests --------------------------------------------------------------------

describeReviewerE2E('Outside Voices reviewer E2E — grok/gemini as a VOICE (real bin/gstack-panel path)', () => {
  test.skipIf(!GROK_USABLE)(
    'grok: real reviewer call path produces a schema-valid, nonce-stamped result.json (or an honest classified absent/error record)',
    async () => {
      const result = await runVoiceReviewer('grok');
      assertReviewerOutcome(result);
    },
    TEST_TIMEOUT_MS,
  );

  test.skipIf(!GEMINI_USABLE)(
    'gemini: real reviewer call path produces a schema-valid, nonce-stamped result.json (or an honest classified absent/error record)',
    async () => {
      const result = await runVoiceReviewer('gemini');
      assertReviewerOutcome(result);
    },
    TEST_TIMEOUT_MS,
  );
});
