/**
 * Structural coverage for the two fork-only skills (review finding:
 * floor-only eval coverage). autobuilder-loop and plan-deliverables had
 * nothing beyond skill-coverage-floor.test.ts, which only pins frontmatter
 * shape and body length — it cannot see whether a load-bearing recipe
 * fragment (a security gate, a retry contract, a fail-closed verdict) got
 * clobbered by a template edit.
 *
 * Free static-text pins over the .tmpl SOURCES (not the generated
 * SKILL.md) — this is what an author actually edits, and it's what
 * `bun run gen:skill-docs` reads from. No LLM, no E2E cost.
 *
 * Each pin below is tied to a real incident cited inline in the .tmpl
 * (dates/notes preserved in the comments at the cited lines) so a future
 * "simplify this bash" pass can't silently regress the exact class of bug
 * that was already caught once.
 */
import { describe, test, expect } from 'bun:test';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { VOICES, VOICE_NAMES, CLI_VOICES } from '../lib/outside-voices/registry';
import { PRICING } from './helpers/pricing';
import { generateOutsideVoices } from '../scripts/resolvers/outside-voices';
import { HOST_PATHS } from '../scripts/resolvers/types';
import type { TemplateContext } from '../scripts/resolvers/types';

const ROOT = path.resolve(import.meta.dir, '..');
const AUTOBUILDER_TMPL = fs.readFileSync(path.join(ROOT, 'autobuilder-loop', 'SKILL.md.tmpl'), 'utf-8');
const PLAN_DELIVERABLES_TMPL = fs.readFileSync(path.join(ROOT, 'plan-deliverables', 'SKILL.md.tmpl'), 'utf-8');

// T10 — Outside Voices security-field + gate-shape invariants. Static-text
// pins (+ one direct-import structural pin) over lib/outside-voices/registry.ts,
// bin/gstack-panel, bin/gstack-config, scripts/resolvers/{review,outside-voices}.ts —
// see m1-decompose.md task T10 / reports T1.md, T5.md, T11.md.
const REGISTRY_SRC = fs.readFileSync(path.join(ROOT, 'lib', 'outside-voices', 'registry.ts'), 'utf-8');
const GSTACK_PANEL = fs.readFileSync(path.join(ROOT, 'bin', 'gstack-panel'), 'utf-8');
const GSTACK_CONFIG = fs.readFileSync(path.join(ROOT, 'bin', 'gstack-config'), 'utf-8');
const REVIEW_TS_SRC = fs.readFileSync(path.join(ROOT, 'scripts', 'resolvers', 'review.ts'), 'utf-8');
const OUTSIDE_VOICES_RESOLVER_SRC = fs.readFileSync(
  path.join(ROOT, 'scripts', 'resolvers', 'outside-voices.ts'),
  'utf-8',
);
const CONFIG_BIN = path.join(ROOT, 'bin', 'gstack-config');

// M2 (autoplan integration, autobuilder run feat-outside-voices-panel-20260830-224457,
// task T6) — read against the GENERATED files, not the .tmpl sources: the anti-drift
// property below is specifically about what autoplan's skip-list string matches
// against what the loaded review skills actually render, so a template-level
// comparison would miss a drift introduced anywhere in the render pipeline.
const AUTOPLAN_SKILL_MD = fs.readFileSync(path.join(ROOT, 'autoplan', 'SKILL.md'), 'utf-8');

/**
 * Extract one top-level bash function's source (`name() { ... }`,
 * brace-balanced) verbatim out of `src`. Used below to actually EXECUTE a few
 * of bin/gstack-panel's security-critical gates (consent, budget) against
 * controlled inputs, rather than only pinning their text — the extraction
 * happens at test time against the REAL file, so an edit to the gate is
 * exercised here automatically, never a hand-copied drift risk.
 */
function extractBashFunction(src: string, name: string): string {
  const marker = new RegExp(`${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\(\\)\\s*\\{`);
  const m = marker.exec(src);
  if (!m) throw new Error(`extractBashFunction: '${name}' not found in source`);
  const braceStart = src.indexOf('{', m.index);
  let depth = 0;
  let end = -1;
  for (let i = braceStart; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  if (end === -1) throw new Error(`extractBashFunction: unbalanced braces extracting '${name}'`);
  return src.slice(m.index, end);
}

describe('autobuilder-loop/SKILL.md.tmpl — recipe invariants', () => {
  test('Codex forum-member config gate rejects only the explicit negative (disabled/off)', () => {
    // Gate on the EXPLICIT negative only — an unknown/empty value must not
    // silently drop the member (live failure 2026-08-15: a literal `!= "on"`
    // check classified enabled-as-disabled).
    expect(AUTOBUILDER_TMPL).toContain('= "disabled" ] || [ "$_CODEX_ENABLED" = "off"');
  });

  test('Grok forum-member config gate rejects absent/disabled/off explicitly', () => {
    expect(AUTOBUILDER_TMPL).toContain(
      '[ "$_GROK_ENABLED" = "absent" ] || [ "$_GROK_ENABLED" = "disabled" ] || [ "$_GROK_ENABLED" = "off" ]',
    );
  });

  test('error-class retry: quota is its own class, and timeout steps down to medium effort', () => {
    // Exit code alone conflates timeout/capacity/quota (proven live 2026-07:
    // exit-1 quota AND exit-1 capacity both looked like "Codex gone"), so the
    // recipe must branch on stderr content, not just $?.
    expect(AUTOBUILDER_TMPL).toContain('quota');
    expect(AUTOBUILDER_TMPL).toContain('stepping down to medium');
  });

  test('a forum member ABSENT at one gate is re-attempted at the next, never latched for the run', () => {
    expect(AUTOBUILDER_TMPL).toContain('ABSENT is PER-GATE');
  });

  test('Worktree preflight gate checks git status --porcelain and offers a stash option', () => {
    expect(AUTOBUILDER_TMPL).toContain('git status --porcelain');
    expect(AUTOBUILDER_TMPL).toContain('git stash push -u -m "autobuilder-preflight"');
  });

  test('the adversarial-forum gate verdict is fail-closed', () => {
    // Absence of a positive success signal is a FAIL, not a pass-by-default.
    expect(AUTOBUILDER_TMPL).toContain('fail-closed');
  });
});

describe('plan-deliverables/SKILL.md.tmpl — recipe invariants', () => {
  test('cross-model gap-check retries by failure class, not raw exit code alone', () => {
    expect(PLAN_DELIVERABLES_TMPL).toContain('Retry by failure class');
  });

  test('milestone content travels via the GAP_CONTEXT_FILE file transport, not pasted into the script', () => {
    // A doc-derived line equal to a heredoc terminator ends the heredoc early
    // and everything after it EXECUTES as shell (cross-model forum [P1],
    // 2026-08-15) — the fix is a separate context FILE, never inlined text.
    expect(PLAN_DELIVERABLES_TMPL).toContain('GAP_CONTEXT_FILE');
    expect(PLAN_DELIVERABLES_TMPL).toContain('EXECUTES as shell');
  });

  test('the skip-guard greps for the untrusted-context fence before sending the prompt', () => {
    // Guards against a placeholder/empty prompt going out silently when the
    // context file was never written or appended.
    expect(PLAN_DELIVERABLES_TMPL).toContain("grep -q 'BEGIN UNTRUSTED CONTEXT'");
  });
});

describe('Outside Voices — security-field + gate-shape invariants (T10)', () => {
  // (a) Every registry adapter declares all FOUR MANDATORY security fields,
  // non-empty. `flag` is the one field legitimately nullable (fable is
  // tool-restriction, not a CLI sandbox flag) — everything else must be a
  // non-empty string.
  test('every VOICES adapter declares non-empty sandbox/boundary/fences/transport', () => {
    expect(VOICE_NAMES.length).toBeGreaterThan(0);
    for (const name of VOICE_NAMES) {
      const adapter = VOICES[name];

      expect(adapter.sandbox).toBeTruthy();
      expect(typeof adapter.sandbox.kind).toBe('string');
      expect(adapter.sandbox.kind.length).toBeGreaterThan(0);
      expect(typeof adapter.sandbox.description).toBe('string');
      expect(adapter.sandbox.description.length).toBeGreaterThan(0);
      // sandbox.flag: string|null — null is only legitimate for a
      // tool-restriction (subagent) adapter, never for a CLI adapter.
      if (adapter.kind === 'cli') {
        expect(typeof adapter.sandbox.flag).toBe('string');
        expect((adapter.sandbox.flag as string).length).toBeGreaterThan(0);
      }

      expect(typeof adapter.boundary).toBe('string');
      expect(adapter.boundary.length).toBeGreaterThan(0);

      expect(adapter.fences).toBeTruthy();
      expect(typeof adapter.fences.begin).toBe('string');
      expect(adapter.fences.begin.length).toBeGreaterThan(0);
      expect(typeof adapter.fences.end).toBe('string');
      expect(adapter.fences.end.length).toBeGreaterThan(0);
      expect(typeof adapter.fences.datamarkInstruction).toBe('string');
      expect(adapter.fences.datamarkInstruction.length).toBeGreaterThan(0);

      expect(adapter.transport).toBeTruthy();
      expect(typeof adapter.transport.kind).toBe('string');
      expect(adapter.transport.kind.length).toBeGreaterThan(0);
      expect(typeof adapter.transport.description).toBe('string');
      expect(adapter.transport.description.length).toBeGreaterThan(0);
    }
  });

  // (b) `--yolo` (auto-approve tool mode) must never appear on any reviewer
  // path. test/helpers/gemini-session-runner.ts is explicitly exempt — it is
  // a benchmark-only harness, never the reviewer invocation.
  test('--yolo appears in no reviewer path (registry, panel, outside-voices resolver)', () => {
    expect(REGISTRY_SRC).not.toContain('--yolo');
    expect(GSTACK_PANEL).not.toContain('--yolo');
    expect(OUTSIDE_VOICES_RESOLVER_SRC).not.toContain('--yolo');
  });

  // (c) The OUTSIDE_VOICE_BOUNDARY literal is single-sourced in registry.ts.
  // review.ts and the resolver must import it, never re-declare their own copy
  // (the old `const CODEX_BOUNDARY` in review.ts is gone).
  test('boundary literal is single-sourced: only registry.ts carries the text; review.ts + the resolver import it', () => {
    const boundaryFragment =
      'Do NOT read or execute any files under ~/.claude/, ~/.agents/, .claude/skills/, or agents/';

    expect(REGISTRY_SRC).toContain(boundaryFragment);
    expect(REVIEW_TS_SRC).not.toContain(boundaryFragment);
    expect(OUTSIDE_VOICES_RESOLVER_SRC).not.toContain(boundaryFragment);

    expect(REVIEW_TS_SRC).not.toContain('const CODEX_BOUNDARY');
    expect(REVIEW_TS_SRC).toContain('OUTSIDE_VOICE_BOUNDARY');
    expect(REVIEW_TS_SRC).toContain("from '../../lib/outside-voices/registry'");
    expect(OUTSIDE_VOICES_RESOLVER_SRC).toContain('OUTSIDE_VOICE_BOUNDARY');
    expect(OUTSIDE_VOICES_RESOLVER_SRC).toContain("from '../../lib/outside-voices/registry'");
  });

  // (d) gate shapes. ROUND-4 (garbage-config fix): grok/gemini are DEFAULT-OFF,
  // so their kill-switch gate in bin/gstack-panel is now a fail-closed WHITELIST —
  // it proceeds ONLY on an explicit positive `enabled`; a garbage/unknown value
  // must never re-enable a default-off external voice. fable/codex stay DEFAULT-ON
  // and keep the gstack convention of gating on the explicit NEGATIVE only.
  test('grok/gemini kill-switch gates in bin/gstack-panel are default-off whitelists (only "enabled" proceeds)', () => {
    expect(GSTACK_PANEL).toContain('[ "$_GROK_ENABLED" != "enabled" ]');
    expect(GSTACK_PANEL).toContain('[ "$_GEMINI_ENABLED" != "enabled" ]');
    // The old explicit-negative gates (which treated a garbage value as enabled)
    // are gone for the two default-off voices.
    expect(GSTACK_PANEL).not.toContain(
      '[ "$_GEMINI_ENABLED" = "absent" ] || [ "$_GEMINI_ENABLED" = "disabled" ] || [ "$_GEMINI_ENABLED" = "off" ]',
    );
    expect(GSTACK_PANEL).not.toContain(
      '[ "$_GROK_ENABLED" = "absent" ] || [ "$_GROK_ENABLED" = "disabled" ] || [ "$_GROK_ENABLED" = "off" ]',
    );
  });

  test('codex kill-switch gate in bin/gstack-panel stays default-on (gates on the explicit negative, not a whitelist)', () => {
    // codex is default-ON and sandbox-verified; per gstack convention it gates on
    // the explicit negative so an unknown value does not silently drop the voice.
    expect(GSTACK_PANEL).toContain(
      '[ "$_CODEX_ENABLED" = "absent" ] || [ "$_CODEX_ENABLED" = "disabled" ] || [ "$_CODEX_ENABLED" = "off" ]',
    );
    expect(GSTACK_PANEL).not.toContain('[ "$_CODEX_ENABLED" != "enabled" ]');
  });

  test('Fable kill-switch gate in bin/gstack-panel rejects absent/disabled/off explicitly', () => {
    expect(GSTACK_PANEL).toContain(
      '[ "$_FABLE_ENABLED" = "absent" ] || [ "$_FABLE_ENABLED" = "disabled" ] || [ "$_FABLE_ENABLED" = "off" ]',
    );
  });

  test('fable_reviews is NOT treated as a paid call: excluded from the reject-on-invalid paid-switch block', () => {
    // The paid-call kill switches (codex/grok/gemini_reviews) reject an
    // unrecognized value outright (exit 1, existing value unchanged) — a typo
    // must never silently flip a paid external call on or off.
    expect(GSTACK_CONFIG).toContain(
      'if [ "$KEY" = "codex_reviews" ] || [ "$KEY" = "grok_reviews" ] || [ "$KEY" = "gemini_reviews" ]; then',
    );
    // fable_reviews must not have been folded into that paid block.
    expect(GSTACK_CONFIG).not.toContain(
      'if [ "$KEY" = "codex_reviews" ] || [ "$KEY" = "grok_reviews" ] || [ "$KEY" = "gemini_reviews" ] || [ "$KEY" = "fable_reviews" ]',
    );
    expect(GSTACK_CONFIG).not.toContain('codex_reviews|grok_reviews|gemini_reviews|fable_reviews');

    // fable_reviews (free Anthropic subagent, OV-20) gets its own warn-and-default
    // gate instead: an unrecognized value WARNS and falls back to "enabled" — no
    // exit 1, because there is no paid-spend risk in silently coercing a typo.
    expect(GSTACK_CONFIG).toContain(
      'if [ "$KEY" = "fable_reviews" ] && [ "$VALUE" != "enabled" ] && [ "$VALUE" != "disabled" ]; then',
    );
    expect(GSTACK_CONFIG).toContain("Warning: fable_reviews '$VALUE' not recognized");
  });

  // (e) Anti-drift: each CLI adapter's exact registry `sandbox.flag` string
  // must appear verbatim in bin/gstack-panel — the TS security contract and
  // the bash invocation cannot silently diverge (m1-decompose integration
  // surprise #5).
  test('every CLI voice sandbox.flag string is pinned verbatim in bin/gstack-panel (anti-drift)', () => {
    expect(CLI_VOICES.length).toBe(3); // codex, grok, gemini
    for (const adapter of CLI_VOICES) {
      const flag = adapter.sandbox.flag;
      expect(typeof flag).toBe('string');
      expect(GSTACK_PANEL).toContain(flag as string);
      // invoke.sandboxFlag must be the exact same string as sandbox.flag
      // (single source inside the registry itself — no per-field drift).
      expect(adapter.invoke.sandboxFlag).toBe(flag);
    }

    // The exact per-voice literals (belt-and-suspenders on top of the loop
    // above, so a future registry refactor can't quietly widen these).
    // gemini's frozen `-s read-only` was INVALID against the real CLI (`-s` is
    // boolean → argv parse error); the fix is `--approval-mode plan` (the CLI's
    // read-only mode). grok keeps `--sandbox read-only` as its DECLARED flag,
    // but its write-denial is UNVERIFIED (default-off) — see registry note.
    expect(VOICES.codex.sandbox.flag).toBe('-s read-only');
    expect(VOICES.grok.sandbox.flag).toBe('--sandbox read-only');
    expect(VOICES.gemini.sandbox.flag).toBe('--approval-mode plan');
  });

  // (f) grok's verdict must be parsed from PLAIN output, not the `--output-format
  // json` envelope that buried the fence in escaped `.text` (gate FAIL P1-3).
  test('grok uses plain output-format, not the json envelope', () => {
    expect(VOICES.grok.invoke.extraFlags).toEqual(['--output-format', 'plain']);
    expect(GSTACK_PANEL).toContain('--output-format plain');
    expect(GSTACK_PANEL).not.toContain('--output-format json');
  });

  // (g) grok/gemini default DISABLED (gate roster decision): neither external
  // voice whose write-denial is unverified may be default-on. codex + fable stay
  // enabled.
  test('grok/gemini default disabled; codex/fable default enabled', () => {
    expect(GSTACK_CONFIG).toContain('grok_reviews) echo "disabled"');
    expect(GSTACK_CONFIG).toContain('gemini_reviews) echo "disabled"');
    expect(GSTACK_CONFIG).toContain('codex_reviews) echo "enabled"');
    expect(GSTACK_CONFIG).toContain('fable_reviews) echo "enabled"');
  });

  // (h) Pricing drift pin (gate-eng-review P2): bin/gstack-panel's budget
  // projection (_panel_rate_in/_panel_rate_out) duplicates per-voice USD/MTok
  // rates as bash case-statement constants, "anchored" to
  // test/helpers/pricing.ts by COMMENT only (bin/gstack-panel's own header:
  // "Rates (USD/MTok) are flat per-voice constants anchored to
  // test/helpers/pricing.ts") — no test previously pinned the two in sync, so
  // a routine pricing.ts refresh (quarterly, per that file's own header) could
  // silently strand the budget cap: it would keep gating spend against a rate
  // that no longer matches what the voice's provider actually charges, in
  // either direction (a stale LOW panel rate under-projects cost and lets the
  // real spend blow past panel_budget_usd before the cap trips; a stale HIGH
  // rate over-projects and starves a voice of budget it should have had).
  // Anchor models are the ones bin/gstack-panel's own comment names for each
  // voice (T4): codex → GPT-5.x (gpt-5.4 in pricing.ts), grok → grok-3,
  // gemini → gemini-2.5-pro.
  test('bin/gstack-panel pricing constants are pinned to test/helpers/pricing.ts (anti-drift, eng-review P2)', () => {
    const ANCHOR_MODEL: Record<string, string> = {
      codex: 'gpt-5.4',
      grok: 'grok-3',
      gemini: 'gemini-2.5-pro',
    };

    for (const [voice, model] of Object.entries(ANCHOR_MODEL)) {
      const row = PRICING[model];
      expect(row, `test/helpers/pricing.ts has no entry for '${model}' (${voice}'s anchor model)`).toBeTruthy();

      // bin/gstack-panel's case statements format each rate as a bash literal
      // with exactly two decimals (`echo 2.50`, not `echo 2.5`) — match that
      // shape exactly so a pricing.ts refresh that changes the number (even
      // by a cent) is caught, not just a refresh that changes the digit count.
      const inRate = row.input_per_mtok.toFixed(2);
      const outRate = row.output_per_mtok.toFixed(2);

      expect(
        GSTACK_PANEL,
        `bin/gstack-panel _panel_rate_in must carry '${voice}) echo ${inRate}' — ` +
          `test/helpers/pricing.ts prices ${model} input at $${inRate}/MTok`,
      ).toContain(`${voice}) echo ${inRate}`);
      expect(
        GSTACK_PANEL,
        `bin/gstack-panel _panel_rate_out must carry '${voice}) echo ${outRate}' — ` +
          `test/helpers/pricing.ts prices ${model} output at $${outRate}/MTok`,
      ).toContain(`${voice}) echo ${outRate}`);
    }
  });
});

// M2 — autoplan skip-list anti-drift (T6, m2-decompose.md). autoplan's Phase 0
// skip-list exists ONLY so /autoplan doesn't double-run the outside-voices panel
// section its own loaded review skills already carry (it reads plan-ceo-review,
// plan-eng-review, plan-devex-review SKILL.md verbatim and follows them, skip
// list and all). Before M2, this entry read the pre-M1 heading
// "Outside Voice — Independent Plan Challenge" — M1 had already renamed the
// panel section, so the entry silently matched nothing: autoplan would BOTH
// follow the loaded skill's panel section AND run its own (then-inline)
// dual-voice blocks. M2 fixed the entry; this pin makes that exact class of
// drift impossible to reintroduce silently by asserting the skip-list string
// against the LIVE rendered heading each surface actually emits, never a
// hand-copied duplicate that can rot independently.
describe('autoplan skip-list — anti-drift against the live rendered outside-voices panel heading (M2 / T6)', () => {
  test('the autoplan skip-list entry for the panel matches the heading rendered in every plan-*-review surface it must skip (ceo/eng/devex)', () => {
    const skipListEntry = '- Outside Voices — Advisory Panel (recommendation only; the user decides)';
    expect(AUTOPLAN_SKILL_MD, 'autoplan skip-list must carry the current panel heading').toContain(skipListEntry);

    const liveHeading = '## Outside Voices — Advisory Panel (recommendation only; the user decides)';
    for (const surface of ['plan-ceo-review', 'plan-eng-review', 'plan-devex-review']) {
      const rendered = fs.readFileSync(path.join(ROOT, surface, 'sections', 'review-sections.md'), 'utf-8');
      expect(rendered, `${surface}/sections/review-sections.md must render the panel heading`).toContain(
        liveHeading,
      );
    }

    // Anti-drift: the skip-list entry (minus its leading "- ") must be
    // BYTE-IDENTICAL to the live heading (minus its leading "## ") — a future
    // resolver rename that isn't mirrored in autoplan's skip-list fails HERE,
    // rather than silently double-running the panel at runtime.
    expect(skipListEntry.replace(/^- /, '')).toBe(liveHeading.replace(/^## /, ''));
  });

  test('the pre-existing "Design Outside Voices (parallel)" skip-list entry still matches plan-design-review\'s live heading (untouched by M2, kept until M3)', () => {
    const skipListEntry = '- Design Outside Voices (parallel)';
    expect(AUTOPLAN_SKILL_MD).toContain(skipListEntry);

    const rendered = fs.readFileSync(path.join(ROOT, 'plan-design-review', 'SKILL.md'), 'utf-8');
    const liveHeading = '## Design Outside Voices (parallel)';
    expect(rendered, 'plan-design-review/SKILL.md must render the Design Outside Voices heading').toContain(
      liveHeading,
    );
    expect(skipListEntry.replace(/^- /, '')).toBe(liveHeading.replace(/^## /, ''));
  });

  test('the stale pre-M2 skip-list entry never reappears', () => {
    // The exact stale string that caused the drift M2 fixed: M1 renamed the
    // section this used to point at, so this string stopped matching
    // anything without anyone noticing.
    expect(AUTOPLAN_SKILL_MD).not.toContain('Outside Voice — Independent Plan Challenge');
  });
});

/** Minimal TemplateContext for calling `generateOutsideVoices` directly. */
function buildOutsideVoicesCtx(host: 'claude' | 'codex' = 'claude'): TemplateContext {
  return {
    skillName: 'autoplan',
    tmplPath: `/tmp/autoplan/SKILL.md.tmpl`,
    host,
    paths: HOST_PATHS[host],
  };
}

// fix1 test-task (feat-outside-voices-panel-20260830-224457) — gate-grok:
// "renderProcedure is a hand-duplicated 18 KB copy... test/skill-recipe-
// invariants.test.ts greps the resolver FILE, so a procedure-only drop of
// nonce/boundary/redaction/sandbox prose still passes while renderFullRecipe
// retains the string. The comment 'invariants + e2e tests cover both' is not
// true." (gate-grok P2, "same 7 steps" finding.) This calls
// `generateOutsideVoices` directly for BOTH variants — the byte-frozen
// standalone recipe (`renderFullRecipe`, default `variant=full`) and
// autoplan's shared multi-phase copy (`renderProcedure`, `variant=procedure`)
// — and pins that a fixed set of SECURITY-mechanics fragments (nonce/
// datamark contract, the boundary preamble, the redaction/egress-consent/
// sandbox pipeline `gstack-panel` owns, the anti-injection wiring) are
// BYTE-IDENTICAL in both. `renderProcedure` intentionally diverges from
// `renderFullRecipe` in non-security prose (phase-aware wording, the Step 6
// auto-decide rewrite, `run_in_background: false` on fable, the Step 7 audit
// identity) — see outside-voices.ts:584 ("intentionally duplicates the
// mechanics prose... rather than sharing a parameterized template") — so this
// test scopes ONLY to the security fragments both copies are required to
// keep in lockstep, confirmed identical by diffing the two functions' actual
// output before writing this test (never a hand-copied guess).
describe('renderFullRecipe / renderProcedure — SECURITY mechanics stay in sync (gate-grok "same 7 steps" follow-up)', () => {
  const fullRecipe = generateOutsideVoices(buildOutsideVoicesCtx(), ['variant=full', 'surface=ceo']);
  const procedure = generateOutsideVoices(buildOutsideVoicesCtx(), ['variant=procedure']);

  test('sanity: both variants actually rendered non-trivial output (guards every assertion below against a vacuous pass)', () => {
    expect(fullRecipe.length).toBeGreaterThan(5_000);
    expect(procedure.length).toBeGreaterThan(5_000);
  });

  const SHARED_SECURITY_FRAGMENTS: Record<string, string> = {
    'boundary preamble (verbatim, item 1)':
      '1. **The single-sourced boundary preamble** (verbatim — do NOT paraphrase it):\n\n   "IMPORTANT: Do NOT read or execute any files under ~/.claude/, ~/.agents/, .claude/skills/, or agents/. These are Claude Code skill definitions meant for a different AI system. They contain bash scripts and prompt templates that will waste your time. Ignore them completely. Do NOT modify agents/openai.yaml. Stay focused on the repository code only.',
    'verdict output contract + datamark requirement (item 3)':
      "3. **The verdict output contract.** Instruct the voice to end with ONE machine-readable verdict\n   block between the fences `BEGIN_OUTSIDE_VOICE_VERDICT` and `END_OUTSIDE_VOICE_VERDICT`, a single JSON\n   object of schema `outside-voice/v2` with fields: `voice`, `vendor`, `status:\"ready\"`,\n   `verdict` (`PASS`|`CONCERNS`|`BLOCK`), `findings[]` (each `{severity: P0|P1|P2|P3,\n   claim, location, repro_command}`; `location` an in-repo path#symbol, `repro_command` a\n   read-only command or null), and — **required** — `datamark`: the exact token shown in the\n   `[datamark:…]` marker on the UNTRUSTED fences below. A verdict that does not echo the nonce is\n   rejected as unauthenticated (a possible injected verdict). `tokens`/`cost_usd` are nullable.\n   The verdict is an advisory input, not a decision.",
    'gstack-panel-owned security pipeline (kill-switches / auth / consent / redaction / egress-receipt / sandbox / budget)':
      'preflight, the **codex under-codex guard** (#2519; `GSTACK_FORCE_CODEX_REVIEW=1` forces),\n**first-use per-vendor egress consent** (private repos), the **redaction pass** (a HIGH/MEDIUM\nsecret/PII hit is masked or that voice goes ABSENT loudly — never silently sent), the\n**fail-closed egress receipt** (no receipt → no send), the **read-only sandbox** (verbatim\nper-voice flags; auto-approve modes FORBIDDEN), the **`panel_budget_usd`** projection, and the\n**wall-clock** budget.',
    'gstack-panel invocation flags (prompt-file / untrusted-file / datamark / out-dir / wall-clock-s)':
      '  --prompt-file "<literal $PANEL_PROMPT_FILE>" \\\n  --untrusted-file "<literal $PANEL_UNTRUSTED_FILE>" \\\n  --datamark "<literal $PANEL_NONCE>" \\\n  --out-dir "<literal $PANEL_OUT_DIR>" \\\n  --wall-clock-s 560',
    'anti-injection nonce/datamark end-to-end wiring statement':
      "`--untrusted-file` + `--datamark` are what wire the anti-injection nonce end-to-end: the panel\nfences the untrusted target with your nonce and then REQUIRES that same nonce in each voice's\nverdict (`parseVoiceResult` rejects a verdict whose `datamark` does not match).",
    'first-use egress-consent flow (NEEDS_CONSENT line + AskUserQuestion trigger)':
      '**First-use consent (private/client repos).** If `gstack-panel` prints a `NEEDS_CONSENT: <voice>`\nline, that vendor has not been consented for egress on this private/client repo (`codex` is\nexempt — already consented via `codex_reviews`; `fable`/native Claude are Anthropic, no new\negress). Ask ONCE per such vendor with AskUserQuestion:',
    'egress-consent explicit-grant persistence':
      '`~/.claude/skills/gstack/bin/gstack-config set <voice>_reviews_consent enabled` (only an explicit positive\ngrant — `enabled` or `granted:<date>` — satisfies the gate).',
    'gstack-vote nonce enforcement (CODE-ENFORCEs the anti-injection nonce on every ready verdict)':
      '--nonce "<literal $PANEL_NONCE>" \\\n  --budget-usd "$(~/.claude/skills/gstack/bin/gstack-config has panel_budget_usd 2>/dev/null || echo 1.50)"',
  };

  for (const [label, fragment] of Object.entries(SHARED_SECURITY_FRAGMENTS)) {
    test(`both copies carry — ${label}`, () => {
      expect(fullRecipe, `renderFullRecipe (variant=full) is missing this security fragment — drifted from renderProcedure`).toContain(fragment);
      expect(procedure, `renderProcedure (variant=procedure) is missing this security fragment — drifted from renderFullRecipe`).toContain(fragment);
    });
  }
});

// fix2 P1-1 (gate2-review [P1] / gate2-eng-review B-1 / gate2-codex "Gate Fable
// egress on Codex hosts" + "Suppress the native-Claude pass on Codex hosts") —
// round-1 made `procedure`/`invoke` RENDER on a Codex host (instead of leaving
// dangling "see the Procedure above" pointers), but Step 3 and the host notes
// were not host-adapted: a Codex host was told to dispatch `fable` via a
// nonexistent Agent tool and to "run the same review yourself" writing
// `voice:"claude", vendor:"anthropic"` — a GPT self-review fabricating
// Anthropic provenance (the registry derives vendor FROM the voice name, so
// `tallyVoices()` would count it in the anthropic vendor-median). Round 2
// fixes this by marking BOTH Anthropic voices explicitly ABSENT on a Codex
// host with an honest "no Agent-tool transport" reason, never dispatched and
// never self-attested.
//
// The rendered `.agents/skills/gstack-autoplan/SKILL.md` (codex-host output)
// is gitignored (build artifact, host-specific) so it can't be pinned by
// reading a file off disk in CI — this calls `generateOutsideVoices` directly
// with `host: 'codex'`, the same entry point `gen-skill-docs.ts` uses to
// produce that file, so the pin holds even when the file hasn't been
// regenerated locally.
describe('Outside Voices — codex-host output marks fable + native Claude ABSENT, never fabricates Anthropic provenance (fix2 P1-1 regression pin)', () => {
  const codexCtx = buildOutsideVoicesCtx('codex');
  const claudeCtx = buildOutsideVoicesCtx('claude');
  const codexProcedure = generateOutsideVoices(codexCtx, ['variant=procedure']);
  const codexInvoke = generateOutsideVoices(codexCtx, ['variant=invoke', 'surface=ceo']);
  // Sanity contrast: the claude-host branch must still carry the dispatch
  // text the codex-host branch is required to NOT carry — proves the
  // `.not.toContain` assertions below are pinning something real, not
  // asserting the absence of a string that never existed anywhere.
  const claudeProcedure = generateOutsideVoices(claudeCtx, ['variant=procedure']);

  test('sanity: codex-host procedure/invoke actually rendered non-trivial output (guards against a vacuous pass)', () => {
    expect(codexProcedure.length).toBeGreaterThan(1_000);
    expect(codexInvoke.length).toBeGreaterThan(500);
  });

  test('sanity: the claude-host branch DOES carry the Agent-tool dispatch + self-review text the codex-host branch must not (proves the negative pins below are meaningful)', () => {
    expect(claudeProcedure).toContain('dispatch via the Agent tool with runtime `model: fable`');
    expect(claudeProcedure).toContain('run the same review yourself and write your verdict block');
    expect(claudeProcedure).toContain('you ARE the\nvoice');
  });

  test('codex-host Step 3 records fable AND native Claude explicit ABSENT with an honest no-Agent-tool-transport reason', () => {
    expect(codexProcedure).toContain(
      '### Step 3 — Anthropic voices (`fable` + native Claude) are ABSENT on a Codex host',
    );
    expect(codexProcedure).toContain('Never self-attest as an Anthropic voice.');
    expect(codexProcedure).toContain('for v in fable claude; do');
    expect(codexProcedure).toContain('"no Agent-tool transport on the Codex host"');
  });

  test('codex-host output never instructs Agent-tool dispatch or a native-Claude self-review self-attested as anthropic', () => {
    // The exact instruction class that fabricated provenance in round 1's
    // codex-host fix — must be absent from BOTH the shared procedure and the
    // per-phase invoke stanza.
    expect(codexProcedure).not.toContain('dispatch via the Agent tool with runtime `model: fable`');
    expect(codexProcedure).not.toContain('run the same review yourself and write your verdict block');
    expect(codexProcedure).not.toContain('you ARE the\nvoice');
    expect(codexInvoke).not.toContain('dispatch the fable subagent with `run_in_background: false`');
  });

  test('codex-host invoke stanza points at the ABSENT handling instead of dispatching fable', () => {
    expect(codexInvoke).toContain(
      '- **Anthropic voices (Procedure Step 3):** `fable` + native Claude are ABSENT on a Codex host (no',
    );
  });

  test('codex-host self-exclusion note is honest about the roster (no false "fable + native Claude still run" claim)', () => {
    expect(codexProcedure).toContain(
      'The two **Anthropic** voices (`fable` +\nnative Claude) are ALSO ABSENT here',
    );
    // The round-1-introduced overclaim this fix removed — pinned as a
    // `.not.toContain` so it can't silently come back.
    expect(codexProcedure).not.toContain('fable + native Claude** (plus any enabled grok/gemini) **still run**');
  });
});

// fix1 test-task — P1 #4 hardening (gen-time validation). `resolveVariant`
// used to silently fall back to `full` on an unknown `variant=` value (a typo
// on an invoke site would inline the ~18 KB full recipe, caught only
// indirectly by the size-budget gate) and `resolveCarry` title-cased any
// unknown key into the shipped skill. Both now THROW at generation time —
// this test calls `generateOutsideVoices` (the same entry point
// `gen-skill-docs.ts` calls) directly with typo'd args to confirm the throw
// is real, not just a comment claiming it.
describe('Outside Voices — variant=/carry= gen-time validation throws on a typo\'d placeholder arg (P1 #4 hardening)', () => {
  const ctx = buildOutsideVoicesCtx();

  test('an invalid variant= value throws at generation time (never silently inlines the ~18KB full recipe)', () => {
    expect(() => generateOutsideVoices(ctx, ['variant=bogus'])).toThrow(/invalid variant/i);
  });

  test('an invalid carry= key throws at generation time (never silently title-cases a typo into the shipped skill)', () => {
    expect(() => generateOutsideVoices(ctx, ['variant=invoke', 'surface=design', 'carry=desing'])).toThrow(
      /invalid carry key/i,
    );
  });

  test('a bad key inside a +-joined carry= list still throws (not just a single-key carry=)', () => {
    expect(() => generateOutsideVoices(ctx, ['variant=invoke', 'surface=eng', 'carry=ceo+xxx'])).toThrow(
      /invalid carry key/i,
    );
  });

  test('absent variant=/carry= still default cleanly and never throw (the byte-frozen callers pass only surface=)', () => {
    expect(() => generateOutsideVoices(ctx, ['surface=eng'])).not.toThrow();
    expect(() => generateOutsideVoices(ctx, ['variant=invoke', 'surface=ceo'])).not.toThrow();
    expect(() => generateOutsideVoices(ctx, ['variant=procedure'])).not.toThrow();
    expect(() =>
      generateOutsideVoices(ctx, ['variant=invoke', 'surface=eng', 'carry=ceo+design']),
    ).not.toThrow();
  });
});

// FIX2 gate coverage check — consent explicit-grant. Extracts and actually
// EXECUTES bin/gstack-panel's `_panel_repo_visibility` + `_panel_consent_ok`
// against an isolated ~/.gstack (GSTACK_STATE_ROOT), never the developer's
// real config and never the network (redact_repo_visibility is pre-set —
// same technique test/outside-voices-redaction.test.ts uses to keep the
// panel's visibility probe from ever shelling out to gh/glab).
describe('Outside Voices — consent gate (_panel_consent_ok), executed against the real bin/gstack-panel source', () => {
  const CONSENT_FNS = ['_panel_repo_visibility', '_panel_consent_ok']
    .map((name) => extractBashFunction(GSTACK_PANEL, name))
    .join('\n\n');

  /** Run the real, extracted `_panel_consent_ok <voice>` and return its exit code. */
  function consentCheck(voice: string, visibility: 'public' | 'private' | 'unknown', consent?: string): number {
    const state = fs.mkdtempSync(path.join(os.tmpdir(), 'gstack-panel-consent-state-'));
    try {
      spawnSync('bash', [CONFIG_BIN, 'set', 'redact_repo_visibility', visibility], {
        env: { ...process.env, GSTACK_STATE_ROOT: state },
        encoding: 'utf8',
      });
      if (consent !== undefined) {
        spawnSync('bash', [CONFIG_BIN, 'set', `${voice}_reviews_consent`, consent], {
          env: { ...process.env, GSTACK_STATE_ROOT: state },
          encoding: 'utf8',
        });
      }
      const script = `set +e\nCONFIG_BIN="${CONFIG_BIN}"\nVIS_CACHE=""\n${CONSENT_FNS}\n_panel_consent_ok "${voice}"\nexit $?\n`;
      const r = spawnSync('bash', ['-c', script], {
        env: { ...process.env, GSTACK_STATE_ROOT: state },
        encoding: 'utf8',
      });
      return r.status ?? -1;
    } finally {
      fs.rmSync(state, { recursive: true, force: true });
    }
  }

  test('a non-empty-but-not-granted consent value is REJECTED, never treated as permission (gate P1/P2-3)', () => {
    // The exact regression the fix closed: the old `[ -n "$consent" ]` check
    // treated ANY non-empty value — including a hand-synced/stale
    // "disabled"/"denied"/"revoked" — as permission to send.
    for (const badValue of ['denied', 'disabled', 'revoked', 'no', 'false', 'unset']) {
      expect(consentCheck('grok', 'private', badValue), `consent='${badValue}' must be rejected`).toBe(1);
    }
  });

  test('no consent recorded at all (default empty) is rejected — fail-closed default', () => {
    expect(consentCheck('gemini', 'private')).toBe(1);
  });

  test('an explicit positive grant (enabled / granted / granted:<date>) is accepted', () => {
    expect(consentCheck('grok', 'private', 'enabled')).toBe(0);
    expect(consentCheck('grok', 'private', 'granted')).toBe(0);
    expect(consentCheck('grok', 'private', 'granted:2026-08-29')).toBe(0);
  });

  test('codex is exempt from the consent gate regardless of visibility/consent', () => {
    expect(consentCheck('codex', 'private')).toBe(0);
    expect(consentCheck('codex', 'private', 'denied')).toBe(0);
  });

  test('a public repo skips the per-vendor consent gate even with no consent recorded', () => {
    expect(consentCheck('grok', 'public')).toBe(0);
  });
});

// FIX2 gate coverage check — budget-from-estimate. A voice-reported cost_usd
// must never be able to move the spend accumulator (gate P1/P2 budget): the
// cap has to gate on the deterministic byte-based pre-estimate ONLY.
// Structural half pins the one real call site; behavioral half extracts and
// actually EXECUTES the real awk arithmetic to prove SPENT_USD tracks the
// estimate exactly even with an attacker-claimed cost_usd sitting in the same
// shell scope where _panel_add_spend runs (that is exactly where a parsed
// voice verdict's cost_usd field would land in the real panel).
describe('Outside Voices — budget gate: SPENT_USD tracks the estimate only, never a voice-reported cost_usd', () => {
  test('_panel_add_spend is called with the deterministic "$est" only — never a cost_usd-derived value (structural)', () => {
    const calls = [...GSTACK_PANEL.matchAll(/_panel_add_spend\s+"[^"]*"\s+"[^"]*"/g)].map((m) => m[0]);
    expect(calls.length, 'expected at least one _panel_add_spend call site in bin/gstack-panel').toBeGreaterThan(0);
    for (const call of calls) {
      expect(call, `_panel_add_spend call site must pass "$est": ${call}`).toContain('"$est"');
      expect(call, `_panel_add_spend call site must not reference cost_usd: ${call}`).not.toContain('cost_usd');
    }
    // Belt-and-suspenders: SPENT_USD is assigned exactly once, inside
    // _panel_add_spend, and never from an expression mentioning cost_usd.
    expect(GSTACK_PANEL).not.toMatch(/SPENT_USD=[^\n]*cost_usd/);
  });

  test('SPENT_USD accumulates only the byte-based pre-estimate — an attacker-claimed cost_usd (0, or deeply negative) has zero effect (behavioral, real awk arithmetic)', () => {
    const outputAllowanceMatch = GSTACK_PANEL.match(/OUTPUT_ALLOWANCE_TOKENS="(\d+)"/);
    expect(outputAllowanceMatch, 'OUTPUT_ALLOWANCE_TOKENS constant not found in bin/gstack-panel').toBeTruthy();
    const outputAllowanceTokens = outputAllowanceMatch![1];

    const budgetFns = ['_panel_rate_in', '_panel_rate_out', '_panel_cost_estimate', '_panel_over_budget', '_panel_add_spend']
      .map((name) => extractBashFunction(GSTACK_PANEL, name))
      .join('\n\n');

    const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gstack-panel-budget-'));
    const payloadPath = path.join(fixtureDir, 'payload.txt');
    fs.writeFileSync(payloadPath, 'x'.repeat(4000), 'utf8'); // known byte size, drives a real non-trivial estimate

    try {
      const script = `
set +e
OUTPUT_ALLOWANCE_TOKENS="${outputAllowanceTokens}"
${budgetFns}
PAYLOAD_FILE="${payloadPath}"
BUDGET_USD="1000"
SPENT_USD="0"

est1="$(_panel_cost_estimate codex)"
echo "EST1:$est1"
# A voice-reported cost sitting in the SAME shell scope _panel_add_spend runs
# in — a real parsed verdict's cost_usd would land in a variable exactly like
# this. It must have NO effect on the accumulator.
cost_usd="0"
_panel_add_spend codex "$est1"
echo "SPENT1:$SPENT_USD"

cost_usd="-1000000"
est2="$(_panel_cost_estimate grok)"
echo "EST2:$est2"
_panel_add_spend grok "$est2"
echo "SPENT2:$SPENT_USD"
`;
      const r = spawnSync('bash', ['-c', script], { encoding: 'utf8' });
      expect(r.status, `extraction harness failed: ${r.stderr}`).toBe(0);

      const out = r.stdout ?? '';
      const grab = (key: string): number => {
        const m = out.match(new RegExp(`${key}:([\\-0-9.]+)`));
        expect(m, `expected ${key} in harness output:\n${out}`).toBeTruthy();
        return parseFloat(m![1]);
      };

      const est1 = grab('EST1');
      const spent1 = grab('SPENT1');
      const est2 = grab('EST2');
      const spent2 = grab('SPENT2');

      // The estimate is real, deterministic byte-based math — strictly positive.
      expect(est1).toBeGreaterThan(0);
      expect(est2).toBeGreaterThan(0);

      // SPENT_USD tracks the estimate exactly: the co-resident cost_usd="0"
      // claim — which, if honored, would have kept SPENT_USD flat and let
      // every remaining voice fire unconstrained — had zero effect.
      expect(spent1).toBeCloseTo(est1, 5);

      // Accumulation continues normally: the co-resident cost_usd="-1000000"
      // claim — which, if honored, would have driven SPENT_USD deeply
      // negative and disabled the cap for the rest of the run — also had
      // zero effect.
      expect(spent2).toBeCloseTo(est1 + est2, 5);
    } finally {
      fs.rmSync(fixtureDir, { recursive: true, force: true });
    }
  });
});

// FIX3 round-2 (codex re-gate P1-3) — a MALFORMED spend cap must FAIL CLOSED, it
// must never bypass the budget gate. Extracts and actually EXECUTES the real
// `_panel_validate_budget` against controlled inputs, then proves a zero cap
// budget-caps a positive-estimate voice via the real awk `_panel_over_budget`.
describe('Outside Voices — budget cap validation fails closed on a malformed value (codex re-gate P1-3)', () => {
  const VALIDATE_FN = extractBashFunction(GSTACK_PANEL, '_panel_validate_budget');

  /** Run the real, extracted `_panel_validate_budget <raw>` and return its stdout. */
  function validate(raw: string): string {
    const script = `set +e\n${VALIDATE_FN}\n_panel_validate_budget "$1"\n`;
    // Pass raw as a positional arg (not string-interpolated) so no quoting or
    // shell-injection can distort the input under test.
    const r = spawnSync('bash', ['-c', script, 'bash', raw], { encoding: 'utf8' });
    return (r.stdout ?? '').trim();
  }

  test('valid non-negative decimals pass through unchanged', () => {
    for (const v of ['1.50', '2', '0.75', '0', '.50', '1.']) {
      expect(validate(v), `'${v}' is a valid cap and must pass through`).toBe(v);
    }
  });

  test('a malformed cap (non-numeric, negative, multi-dot, empty, scientific, injection) fails closed to "0"', () => {
    for (const bad of ['abc', '-5', '1.5.0', '', '1e5', '.', '  ', '$(touch pwned)', '1.50; rm -rf /']) {
      expect(validate(bad), `'${bad}' must fail closed to 0`).toBe('0');
    }
  });

  test('run_panel actually validates the cap through _panel_validate_budget before the gate (structural)', () => {
    expect(GSTACK_PANEL).toContain('BUDGET_USD="$(_panel_validate_budget "$BUDGET_USD")"');
  });

  test('a zero cap budget-caps a voice with a positive estimate — the fail-closed direction (real awk)', () => {
    const overFn = extractBashFunction(GSTACK_PANEL, '_panel_over_budget');
    const script = `set +e\n${overFn}\nSPENT_USD="0"\nBUDGET_USD="0"\nif _panel_over_budget "0.08"; then echo OVER; else echo OK; fi\n`;
    const r = spawnSync('bash', ['-c', script], { encoding: 'utf8' });
    // est 0.08 > cap 0 → over budget → the voice (and every remaining one) is capped.
    expect((r.stdout ?? '').trim()).toBe('OVER');
  });
});

// FIX3 round-2 (codex re-gate P1-4) — a config-read FAILURE must FAIL CLOSED,
// never default a voice to enabled. The old `[ -z "$enabled" ] && enabled=
// "enabled"` in the CLI kill-switch loop silently RE-ENABLED a default-off
// external voice (grok/gemini) whenever the gstack-config binary produced no
// output (broken/partial install), egressing to a third party.
describe('Outside Voices — config-read failure fails closed (codex re-gate P1-4)', () => {
  test('the CLI kill-switch loop no longer contains the fail-OPEN enabled default; it fails closed (structural)', () => {
    // The exact fail-open line is gone from the CLI loop, replaced by a
    // config-unavailable fail-closed branch. (The fable kill-switch — a FREE
    // Anthropic subagent with no egress — legitimately keeps its own default.)
    expect(GSTACK_PANEL).toContain('failing closed: config-unavailable');
    expect(GSTACK_PANEL).toContain('config read failed for ${voice}_reviews');
    // The removed fail-open pattern must not reappear immediately after the CLI
    // voice config read.
    expect(GSTACK_PANEL).not.toMatch(
      /enabled="\$\("\$CONFIG_BIN" get "\$\{voice\}_reviews"[\s\S]{0,40}\[ -z "\$enabled" \] && enabled="enabled"/,
    );
  });

  test('a broken gstack-config binary marks EVERY external voice ABSENT(config-unavailable), never enabled (behavioral, real panel)', () => {
    const PANEL_SRC = path.join(ROOT, 'bin', 'gstack-panel');
    const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gstack-panel-brokencfg-bin-'));
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gstack-panel-brokencfg-out-'));
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'gstack-panel-brokencfg-cwd-'));
    try {
      // Copy the REAL panel so its actual gate is exercised (its result-record
      // writer falls back to a pure-bash path when the sibling registry is
      // absent, so the absent records are still written correctly here).
      fs.copyFileSync(PANEL_SRC, path.join(binDir, 'gstack-panel'));
      fs.chmodSync(path.join(binDir, 'gstack-panel'), 0o755);
      // Broken gstack-config: NO output, non-zero exit — a missing/unexecutable/
      // errored binary on a partial install.
      fs.writeFileSync(path.join(binDir, 'gstack-config'), '#!/bin/sh\nexit 1\n');
      fs.chmodSync(path.join(binDir, 'gstack-config'), 0o755);
      // Clean redact stub (--json exit 0) so the redaction gate is a no-op and the
      // CONFIG gate is what we observe. gh/glab stubs keep repo-visibility offline.
      for (const [name, body] of [
        ['gstack-redact', '#!/bin/sh\nexit 0\n'],
        ['gh', '#!/bin/sh\nexit 1\n'],
        ['glab', '#!/bin/sh\nexit 1\n'],
      ] as const) {
        fs.writeFileSync(path.join(binDir, name), body);
        fs.chmodSync(path.join(binDir, name), 0o755);
      }

      const promptFile = path.join(cwd, 'prompt.txt');
      fs.writeFileSync(promptFile, 'Review this trivial change. No secrets here.\n');

      const r = spawnSync(
        'bash',
        [
          path.join(binDir, 'gstack-panel'),
          '--surface', 'eng',
          '--prompt-file', promptFile,
          // ROUND-4: run_panel refuses a run without a nonce, so pass --datamark
          // (the recipe always does); the config-read fail-closed is what we test.
          '--datamark', 'brokencfg-run-nonce',
          '--out-dir', outDir,
          '--budget-usd', '1.50',
          '--wall-clock-s', '560',
        ],
        { cwd, encoding: 'utf8', env: { ...process.env, PATH: `${binDir}:${process.env.PATH}` } },
      );

      expect(r.status, `panel should exit 0 (advisory): ${r.stderr}`).toBe(0);
      for (const voice of ['codex', 'grok', 'gemini']) {
        const p = path.join(outDir, `${voice}.result.json`);
        expect(fs.existsSync(p), `${voice}.result.json must exist`).toBe(true);
        const rec = JSON.parse(fs.readFileSync(p, 'utf8'));
        expect(rec.status, `${voice} must be absent, never treated as enabled`).toBe('absent');
        expect(rec.reason, `${voice} must fail closed with config-unavailable`).toContain('config-unavailable');
        // Belt-and-suspenders: no invoke artifact — the voice was never spawned.
        expect(fs.existsSync(path.join(outDir, `${voice}.raw`)), `${voice} must not have been invoked`).toBe(false);
      }
    } finally {
      fs.rmSync(binDir, { recursive: true, force: true });
      fs.rmSync(outDir, { recursive: true, force: true });
      fs.rmSync(cwd, { recursive: true, force: true });
    }
  });
});

// FIX3 round-2 (codex re-gate P2) — the --auto-redact masking pass is a SEPARATE
// invocation from the scan; if it crashes mid-write it can leave an EMPTY mask
// that re-scans "clean" and would adopt+send an EMPTY payload. Pin the
// fail-closed guard (exit-code + non-empty check) so it cannot regress.
describe('Outside Voices — auto-redact output is fail-closed checked (codex re-gate P2)', () => {
  test('a failed or empty auto-redact mask is never adopted (structural)', () => {
    expect(GSTACK_PANEL).toContain('autoredact_rc=$?');
    expect(GSTACK_PANEL).toMatch(/\[ "\$autoredact_rc" != "0" \] \|\| \[ ! -s "\$masked" \]/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ROUND-4 (external-vendor convergence: nonce is mandatory, config/budget edge
// cases fail-closed). A shared harness runs the REAL bin/gstack-panel with a
// stub gstack-config (so we can inject a hand-edited/garbage value the config
// binary would REJECT on `set`) and stub CLIs on PATH. The panel is copied into
// a bin dir with its stubs; a copied panel cannot reach its registry sibling, so
// a voice that RUNS falls back to a pure-bash error record — every gate we assert
// here (kill-switch, budget, nonce) fires BEFORE that, in bash, so the fallback
// never masks the behavior under test. No paid CLI ever runs (all voices are
// disabled or rejected at the kill-switch).
// ─────────────────────────────────────────────────────────────────────────────
function makePanelHarness(stubs: Record<string, string>): {
  binDir: string;
  outDir: string;
  cwd: string;
  run: (args: string[], env?: Record<string, string>) => ReturnType<typeof spawnSync>;
  cleanup: () => void;
} {
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gstack-panel-r4-bin-'));
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gstack-panel-r4-out-'));
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'gstack-panel-r4-cwd-'));
  fs.copyFileSync(path.join(ROOT, 'bin', 'gstack-panel'), path.join(binDir, 'gstack-panel'));
  fs.chmodSync(path.join(binDir, 'gstack-panel'), 0o755);
  // Default stubs (a clean redact, offline visibility) — overridable per test.
  const allStubs: Record<string, string> = {
    'gstack-redact': '#!/bin/sh\nexit 0\n',
    gh: '#!/bin/sh\nexit 1\n',
    glab: '#!/bin/sh\nexit 1\n',
    ...stubs,
  };
  for (const [name, body] of Object.entries(allStubs)) {
    fs.writeFileSync(path.join(binDir, name), body);
    fs.chmodSync(path.join(binDir, name), 0o755);
  }
  const promptFile = path.join(cwd, 'prompt.txt');
  fs.writeFileSync(promptFile, 'Review this trivial change. No secrets here.\n');
  return {
    binDir,
    outDir,
    cwd,
    run: (args, env) =>
      spawnSync('bash', [path.join(binDir, 'gstack-panel'), ...args], {
        cwd,
        encoding: 'utf8',
        env: { ...process.env, PATH: `${binDir}:${process.env.PATH}`, ...env },
      }),
    cleanup: () => {
      fs.rmSync(binDir, { recursive: true, force: true });
      fs.rmSync(outDir, { recursive: true, force: true });
      fs.rmSync(cwd, { recursive: true, force: true });
    },
  };
}

// ROUND-4 (garbage config re-enables a known-unsafe voice) — for the DEFAULT-OFF
// voices (grok, gemini) an unknown/garbage config value must NOT be treated as
// enabled. Only an explicit positive `enabled` proceeds; anything else fails
// closed to ABSENT and is never sent.
describe('Outside Voices — garbage config never re-enables a default-off voice (round-4)', () => {
  test('grok/gemini with a hand-edited garbage *_reviews value are ABSENT (kill-switch), never invoked', () => {
    // gstack-config STUB: codex disabled (so the flagship never spends here),
    // grok/gemini return a GARBAGE value a hand-edit/sync could leave behind.
    const configStub =
      '#!/bin/sh\n' +
      'if [ "$1" = "get" ]; then\n' +
      '  case "$2" in\n' +
      '    codex_reviews) echo "disabled" ;;\n' +
      '    grok_reviews|gemini_reviews) echo "garbage-not-a-real-value" ;;\n' +
      '    redact_repo_visibility) echo "public" ;;\n' +
      '    *) : ;;\n' +
      '  esac\n' +
      'fi\n' +
      'if [ "$1" = "has" ]; then exit 1; fi\n' +
      'exit 0\n';
    // grok/gemini stubs on PATH so `command -v` succeeds and the config value is
    // NOT overridden to "absent(not installed)" — the garbage value reaches the
    // kill-switch, which is what we are testing. They must never be invoked.
    const h = makePanelHarness({
      'gstack-config': configStub,
      grok: '#!/bin/sh\necho SHOULD_NOT_RUN\nexit 0\n',
      gemini: '#!/bin/sh\necho SHOULD_NOT_RUN\nexit 0\n',
    });
    try {
      const r = h.run(['--surface', 'eng', '--prompt-file', path.join(h.cwd, 'prompt.txt'),
        '--datamark', 'garbage-cfg-nonce', '--out-dir', h.outDir, '--budget-usd', '1.50', '--wall-clock-s', '560']);
      expect(r.status, `panel should exit 0 (advisory): ${r.stderr}`).toBe(0);
      for (const voice of ['grok', 'gemini']) {
        const p = path.join(h.outDir, `${voice}.result.json`);
        expect(fs.existsSync(p), `${voice}.result.json must exist`).toBe(true);
        const rec = JSON.parse(fs.readFileSync(p, 'utf8'));
        expect(rec.status, `${voice} garbage config must fail closed to absent`).toBe('absent');
        expect(rec.reason, `${voice} absent reason must reflect the fail-closed whitelist`).toContain("not an explicit 'enabled'");
        // Never invoked — no raw output artifact exists.
        expect(fs.existsSync(path.join(h.outDir, `${voice}.raw`)), `${voice} must NOT have been invoked`).toBe(false);
      }
    } finally {
      h.cleanup();
    }
  });
});

// ROUND-4 (budget cap: unset vs explicitly-empty) — an UNSET budget legitimately
// uses the $1.50 default; a budget flag PASSED but EMPTY/whitespace is a misconfig
// and must FAIL CLOSED to a $0 cap (which caps every external voice), not silently
// become the default.
describe('Outside Voices — budget unset vs explicitly-empty (round-4)', () => {
  test('run_panel distinguishes unset (default) from set-but-empty (fail-closed) via BUDGET_FLAG_SET (structural)', () => {
    expect(GSTACK_PANEL).toContain('BUDGET_FLAG_SET=1; shift 2');
    expect(GSTACK_PANEL).toContain('if [ "$BUDGET_FLAG_SET" != "1" ]; then');
  });

  test('an explicitly EMPTY --budget-usd "" fails closed to a $0 cap, with a loud warning', () => {
    // All voices disabled so nothing spends; we only observe the budget header.
    const configStub =
      '#!/bin/sh\n' +
      'if [ "$1" = "get" ]; then\n' +
      '  case "$2" in\n' +
      '    codex_reviews|grok_reviews|gemini_reviews) echo "disabled" ;;\n' +
      '    redact_repo_visibility) echo "public" ;;\n' +
      '    *) : ;;\n' +
      '  esac\n' +
      'fi\n' +
      // has: no config file in this stub scenario — every key is ABSENT, matching
      // a fresh install (round-5 FIX5: gstack-panel's budget resolution now calls
      // `has panel_budget_usd` instead of `get`, so this must behave realistically).
      'if [ "$1" = "has" ]; then exit 1; fi\n' +
      'exit 0\n';
    const h = makePanelHarness({ 'gstack-config': configStub });
    try {
      const r = h.run(['--surface', 'eng', '--prompt-file', path.join(h.cwd, 'prompt.txt'),
        '--datamark', 'budget-nonce', '--out-dir', h.outDir, '--budget-usd', '', '--wall-clock-s', '560']);
      expect(r.status).toBe(0);
      // Fail-closed: the cap is $0 (caps every external voice), and it says so.
      expect(r.stdout).toContain('budget=$0');
      expect(r.stderr).toContain('invalid budget cap');
    } finally {
      h.cleanup();
    }
  });

  test('an UNSET budget (no --budget-usd flag) legitimately uses the $1.50 default (no fail-closed)', () => {
    // Stub gstack-config returns NOTHING for panel_budget_usd → the built-in
    // $1.50 default applies (the unset case is legitimate, per the fix).
    const configStub =
      '#!/bin/sh\n' +
      'if [ "$1" = "get" ]; then\n' +
      '  case "$2" in\n' +
      '    codex_reviews|grok_reviews|gemini_reviews) echo "disabled" ;;\n' +
      '    redact_repo_visibility) echo "public" ;;\n' +
      '    *) : ;;\n' +
      '  esac\n' +
      'fi\n' +
      // has: no config file in this stub scenario — every key is ABSENT, matching
      // a fresh install (round-5 FIX5: gstack-panel's budget resolution now calls
      // `has panel_budget_usd` instead of `get`, so this must behave realistically).
      'if [ "$1" = "has" ]; then exit 1; fi\n' +
      'exit 0\n';
    const h = makePanelHarness({ 'gstack-config': configStub });
    try {
      const r = h.run(['--surface', 'eng', '--prompt-file', path.join(h.cwd, 'prompt.txt'),
        '--datamark', 'budget-nonce', '--out-dir', h.outDir, '--wall-clock-s', '560']); // NO --budget-usd
      expect(r.status).toBe(0);
      expect(r.stdout).toContain('budget=$1.50');
      expect(r.stderr).not.toContain('invalid budget cap');
    } finally {
      h.cleanup();
    }
  });
});

// ROUND-5 / FIX5 (budget cap: config present-but-empty) — round-4 fixed the
// CLI-flag empty case above (BUDGET_FLAG_SET) but left the config case open:
// `gstack-config get panel_budget_usd` folds a PRESENT-BUT-EMPTY config line
// (a bare `panel_budget_usd:` with nothing after it — e.g. a hand-edit or a
// bad sync) into the SAME $1.50 default it returns for an ABSENT key, so the
// paid-voice budget silently opened to the full default cap instead of
// failing closed. gstack-panel's config-derived-defaults block now calls
// `gstack-config has panel_budget_usd` instead, which distinguishes presence
// from value. These three tests execute the REAL bash budget-resolution path
// end to end (spawn the actual bin/gstack-panel, as the round-4 tests above
// do) for all three provenance states.
describe('Outside Voices — budget config present-but-empty fails closed (round-5 / FIX5)', () => {
  test('config panel_budget_usd PRESENT but EMPTY fails closed to a $0 cap — codex is budget-capped, never invoked', () => {
    // codex_reviews enabled (grok/gemini disabled to keep the assertion to one
    // voice) + a codex CLI stub on PATH so the kill-switch passes and the run
    // reaches the budget gate. `has panel_budget_usd` reports PRESENT (exit 0)
    // with an EMPTY raw value — a bare `panel_budget_usd:` line in config.yaml.
    const configStub =
      '#!/bin/sh\n' +
      'if [ "$1" = "get" ]; then\n' +
      '  case "$2" in\n' +
      '    codex_reviews) echo "enabled" ;;\n' +
      '    grok_reviews|gemini_reviews) echo "disabled" ;;\n' +
      '    redact_repo_visibility) echo "public" ;;\n' +
      '    *) : ;;\n' +
      '  esac\n' +
      'fi\n' +
      'if [ "$1" = "has" ]; then\n' +
      '  case "$2" in\n' +
      '    panel_budget_usd) exit 0 ;;\n' +  // present, prints nothing (empty raw value)
      '    *) exit 1 ;;\n' +
      '  esac\n' +
      'fi\nexit 0\n';
    const h = makePanelHarness({
      'gstack-config': configStub,
      codex: '#!/bin/sh\necho SHOULD_NOT_RUN\nexit 0\n',
    });
    try {
      // NO --budget-usd flag — the config-derived path is what we are testing.
      // Clear CODEX_THREAD_ID/CODEX_SANDBOX so the under-codex guard can never
      // intercept codex before the budget gate, regardless of the ambient shell.
      const r = h.run(
        ['--surface', 'eng', '--prompt-file', path.join(h.cwd, 'prompt.txt'),
          '--datamark', 'fix5-empty-nonce', '--out-dir', h.outDir, '--wall-clock-s', '560'],
        { CODEX_THREAD_ID: '', CODEX_SANDBOX: '' },
      );
      expect(r.status, `panel should exit 0 (advisory): ${r.stderr}`).toBe(0);
      // Fail-closed: present-but-empty config must behave exactly like an
      // explicit --budget-usd "" — a $0 cap, with the same loud warning.
      expect(r.stdout).toContain('budget=$0');
      expect(r.stderr).toContain('invalid budget cap');
      const p = path.join(h.outDir, 'codex.result.json');
      expect(fs.existsSync(p), 'codex.result.json must exist').toBe(true);
      const rec = JSON.parse(fs.readFileSync(p, 'utf8'));
      expect(rec.status, 'codex must be budget-capped, not enabled at the default cap').toBe('absent');
      expect(rec.reason, 'codex absent reason must reflect the budget gate').toContain('budget-capped');
      // Never invoked — no raw output artifact exists.
      expect(fs.existsSync(path.join(h.outDir, 'codex.raw')), 'codex must NOT have been invoked').toBe(false);
    } finally {
      h.cleanup();
    }
  });

  test('config panel_budget_usd ABSENT (key not in config.yaml at all) legitimately uses the $1.50 default', () => {
    // `has panel_budget_usd` reports ABSENT (exit 1) — no such key in the file.
    const configStub =
      '#!/bin/sh\n' +
      'if [ "$1" = "get" ]; then\n' +
      '  case "$2" in\n' +
      '    codex_reviews|grok_reviews|gemini_reviews) echo "disabled" ;;\n' +
      '    redact_repo_visibility) echo "public" ;;\n' +
      '    *) : ;;\n' +
      '  esac\n' +
      'fi\n' +
      'if [ "$1" = "has" ]; then exit 1; fi\n' +
      'exit 0\n';
    const h = makePanelHarness({ 'gstack-config': configStub });
    try {
      const r = h.run(['--surface', 'eng', '--prompt-file', path.join(h.cwd, 'prompt.txt'),
        '--datamark', 'fix5-absent-nonce', '--out-dir', h.outDir, '--wall-clock-s', '560']); // NO --budget-usd
      expect(r.status).toBe(0);
      expect(r.stdout).toContain('budget=$1.50');
      expect(r.stderr).not.toContain('invalid budget cap');
    } finally {
      h.cleanup();
    }
  });

  test('config panel_budget_usd present with a VALID number is used verbatim (not the default, not $0)', () => {
    // `has panel_budget_usd` reports PRESENT (exit 0) with raw value "2.25".
    const configStub =
      '#!/bin/sh\n' +
      'if [ "$1" = "get" ]; then\n' +
      '  case "$2" in\n' +
      '    codex_reviews|grok_reviews|gemini_reviews) echo "disabled" ;;\n' +
      '    redact_repo_visibility) echo "public" ;;\n' +
      '    *) : ;;\n' +
      '  esac\n' +
      'fi\n' +
      'if [ "$1" = "has" ]; then\n' +
      '  case "$2" in\n' +
      '    panel_budget_usd) echo "2.25"; exit 0 ;;\n' +
      '    *) exit 1 ;;\n' +
      '  esac\n' +
      'fi\nexit 0\n';
    const h = makePanelHarness({ 'gstack-config': configStub });
    try {
      const r = h.run(['--surface', 'eng', '--prompt-file', path.join(h.cwd, 'prompt.txt'),
        '--datamark', 'fix5-valid-nonce', '--out-dir', h.outDir, '--wall-clock-s', '560']); // NO --budget-usd
      expect(r.status).toBe(0);
      expect(r.stdout).toContain('budget=$2.25');
      expect(r.stderr).not.toContain('invalid budget cap');
    } finally {
      h.cleanup();
    }
  });
});

// ROUND-4 (mandatory nonce — panel entry point) — a review run carries content
// that must be authenticated. run_panel refuses to proceed without a nonce
// (fail-closed), including the pre-assembled --prompt-file path that cannot mint
// one; the correctly-nonced run proceeds past the guard.
describe('Outside Voices — panel refuses an un-nonced authenticated run (round-4)', () => {
  test('the pre-assembled --prompt-file path with NO --datamark is refused (structural)', () => {
    // The bun parse helper declares authentication mandatory, and run_panel
    // fails closed when no nonce is available.
    expect(GSTACK_PANEL).toContain('requireDatamark: true');
    expect(GSTACK_PANEL).toMatch(/if \[ -z "\$DATAMARK" \]; then\n\s*echo "gstack-panel: FATAL/);
  });

  test('run_panel exits 2 (refuses) on a prompt-file-only run with no --datamark; the nonced run proceeds', () => {
    const configStub =
      '#!/bin/sh\n' +
      'if [ "$1" = "get" ]; then\n' +
      '  case "$2" in\n' +
      '    codex_reviews|grok_reviews|gemini_reviews) echo "disabled" ;;\n' +
      '    redact_repo_visibility) echo "public" ;;\n' +
      '    *) : ;;\n' +
      '  esac\n' +
      'fi\n' +
      // has: no config file in this stub scenario — every key is ABSENT, matching
      // a fresh install (round-5 FIX5: gstack-panel's budget resolution now calls
      // `has panel_budget_usd` instead of `get`, so this must behave realistically).
      'if [ "$1" = "has" ]; then exit 1; fi\n' +
      'exit 0\n';
    // Refused: no --datamark, no --untrusted-file → nothing to authenticate against.
    const h1 = makePanelHarness({ 'gstack-config': configStub });
    try {
      const r = h1.run(['--surface', 'eng', '--prompt-file', path.join(h1.cwd, 'prompt.txt'),
        '--out-dir', h1.outDir, '--wall-clock-s', '560']);
      expect(r.status, 'un-nonced authenticated run must be refused').toBe(2);
      expect(r.stderr).toContain('must be authenticated');
    } finally {
      h1.cleanup();
    }
    // Proceeds: with --datamark the guard passes and the panel runs to completion.
    const h2 = makePanelHarness({ 'gstack-config': configStub });
    try {
      const r = h2.run(['--surface', 'eng', '--prompt-file', path.join(h2.cwd, 'prompt.txt'),
        '--datamark', 'proceed-nonce', '--out-dir', h2.outDir, '--wall-clock-s', '560']);
      expect(r.status, 'nonced run must proceed').toBe(0);
      expect(r.stdout).toContain('gstack-panel done');
    } finally {
      h2.cleanup();
    }
  });
});
