/**
 * M2 regression pins — autoplan's outside-voices panel integration.
 *
 * Context: autobuilder run feat-outside-voices-panel-20260830-224457, task T6.
 * See reports/m2-decompose.md (M2 contract + task decomposition), T2.md
 * (phase-machinery rewrite: the 4 inline Codex/Claude dual-voice blocks
 * replaced by `{{OUTSIDE_VOICES:variant=invoke:surface=...}}`), and T3.md
 * (6-principle decision-engine prose rewired to treat panel findings as
 * input, never a verdict).
 *
 * These are static-text pins over the GENERATED `autoplan/SKILL.md` (the
 * actual rendered skill an agent follows), plus a couple of pins over the
 * `.tmpl` source where the thing being pinned (the `variant=invoke` /
 * `carry=` placeholder shape) only exists pre-render. The generated file is
 * a build artifact (`bun run gen:skill-docs`) but per the M2 deliverable it
 * is already regenerated and committed at HEAD — reading it directly is
 * exactly what an agent running /autoplan actually sees.
 *
 * What a future template edit could silently break, that these pins catch:
 *   - dropping the per-voice-row consensus table for one phase (or bringing
 *     back the old Claude/Codex 2-column table);
 *   - breaking `carryContext` threading — a phase seeing prior-phase context
 *     it shouldn't (phase 1) or missing context it should have (phases 2/3/3.5);
 *   - turning the panel's advisory recommendation into a binding gate;
 *   - reintroducing the removed codex-exec / dual-voice mechanics; or
 *   - re-inlining the ~18 KB-per-expansion procedure into all 4 phases
 *     instead of referencing the shared one — which blew the ×1.50
 *     skill-size-budget gate before M2's variant=procedure/variant=invoke
 *     split (see test/skill-size-budget.test.ts).
 *
 * Skip-list anti-drift (the actual M2-era bug: a stale skip-list entry that
 * silently stopped matching the M1-renamed panel heading) is pinned
 * separately in test/skill-recipe-invariants.test.ts, next to that file's
 * other cross-file anti-drift checks.
 */
import { describe, test, expect } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(import.meta.dir, '..');
const AUTOPLAN_SKILL = fs.readFileSync(path.join(ROOT, 'autoplan', 'SKILL.md'), 'utf-8');
const AUTOPLAN_TMPL = fs.readFileSync(path.join(ROOT, 'autoplan', 'SKILL.md.tmpl'), 'utf-8');

// The generated file's autoplan-specific content starts at this H1 —
// everything before it is the shared, every-skill preamble, which
// legitimately keeps ONE boilerplate "codex exec"/"codex review" mention in
// its plan-mode safe-operations allowlist (present in every gstack skill,
// unrelated to autoplan's removed dual-voice flow). Scoping the
// codex-remnant guard to this slice keeps that boilerplate from producing a
// false failure, per the task's explicit instruction.
const BODY_MARKER = '# /autoplan — Auto-Review Pipeline';
const BODY_START = AUTOPLAN_SKILL.indexOf(BODY_MARKER);
const AUTOPLAN_BODY = AUTOPLAN_SKILL.slice(BODY_START);

/** Count non-overlapping occurrences of `needle` in `haystack`. */
function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

describe('fixture guard — the generated file loaded and the body slice is real', () => {
  // Several assertions below are `.not.toContain(...)` checks; those pass
  // vacuously against an empty string, so this guard exists to make sure a
  // broken BODY_MARKER (or a missing/truncated generated file) fails loudly
  // here instead of letting every remnant-guard test below pass for free.
  test('autoplan/SKILL.md and .tmpl loaded, and BODY_MARKER was actually found mid-file', () => {
    expect(AUTOPLAN_SKILL.length).toBeGreaterThan(50_000);
    expect(AUTOPLAN_TMPL.length).toBeGreaterThan(10_000);
    expect(BODY_START).toBeGreaterThan(500);
    expect(AUTOPLAN_BODY.length).toBeGreaterThan(30_000);
  });
});

describe('M2 — per-voice-row consensus table renders in all 4 autoplan phases (CEO, design, eng, DX)', () => {
  const PHASES = ['ceo', 'design', 'eng', 'devex'] as const;

  test('each phase has its own "Outside Voices — /plan-<phase>-review voice" stanza, exactly once', () => {
    for (const phase of PHASES) {
      const heading = `### Outside Voices — \`/plan-${phase}-review\` voice (advisory; run the shared Procedure above)`;
      expect(occurrences(AUTOPLAN_SKILL, heading), `${phase} stanza heading must appear exactly once`).toBe(1);
    }
  });

  test('each phase wires the per-voice-row table (VOICE/VENDOR/STATUS/VERDICT/TOP FINDING + RECOMMENDATION), never the old Claude/Codex two-column table', () => {
    const perVoiceRowPresentation =
      "- **Present:** `gstack-vote`'s **per-voice-row** consensus table VERBATIM, phase-labeled — the\n" +
      "  `VOICE / VENDOR / STATUS / VERDICT / TOP FINDING` rows plus the `RECOMMENDATION:` line (NOT a\n" +
      '  Claude/Codex two-column table).';
    // Exactly 4 — one identical presentation instruction per phase. A phase
    // silently missing this (or reverting to the old 2-column table) changes
    // this count.
    expect(occurrences(AUTOPLAN_SKILL, perVoiceRowPresentation)).toBe(4);
    expect(AUTOPLAN_SKILL).not.toContain('DUAL VOICES — CONSENSUS TABLE');
  });

  test('each phase passes its own --surface to gstack-panel/gstack-vote (never a shared/hardcoded surface)', () => {
    for (const phase of PHASES) {
      expect(AUTOPLAN_SKILL).toContain(`pass \`--surface ${phase}\` to \`gstack-panel\`/\`gstack-vote\`.`);
    }
  });

  test('the shared procedure documents the per-voice-row table shape exactly once (referenced, not re-described, by each phase)', () => {
    expect(occurrences(AUTOPLAN_SKILL, 'VOICE   VENDOR     STATUS   VERDICT')).toBe(1);
  });
});

describe('M2 — carryContext threading: phases 2/3/3.5 carry frozen prior-phase summaries; phase 1 (CEO) does not', () => {
  test('Phase 1 (CEO) explicitly carries NO prior-phase context — it is the first review phase', () => {
    expect(AUTOPLAN_SKILL).toContain(
      '- **Cross-phase carryContext:** none — first review phase; run the voices with no prior context.',
    );
  });

  test('Phase 2 (Design) carries CEO; Phase 3 (Eng) carries CEO + Design; Phase 3.5 (DX) carries CEO + Eng', () => {
    // fix1 P1 #1: carryContext moved out of the trusted prompt file into the
    // UNTRUSTED-target file (see the "carryContext threading is UNTRUSTED"
    // describe block below), so the carry label now sits in the
    // "(Procedure Step 1, item 4): **<label>**" clause instead of the old
    // "...to the panel\n  prompt (Procedure Step 1, item 4)" phrasing.
    expect(AUTOPLAN_SKILL).toContain(
      '(Procedure Step 1, item 4): **CEO**. Every voice then sees them via\n  `panel.payload.txt`, inside the untrusted fence.',
    );
    expect(AUTOPLAN_SKILL).toContain(
      '(Procedure Step 1, item 4): **CEO + Design**. Every voice then sees them via\n  `panel.payload.txt`, inside the untrusted fence.',
    );
    expect(AUTOPLAN_SKILL).toContain(
      '(Procedure Step 1, item 4): **CEO + Eng**. Every voice then sees them via\n  `panel.payload.txt`, inside the untrusted fence.',
    );
  });

  test('exactly 4 "Cross-phase carryContext" stanzas exist: 1 "none" line (Phase 1) + 3 labeled "(UNTRUSTED)" that append the frozen prior-phase summaries', () => {
    // fix1 P1 #1 relabeled the 3 carrying stanzas "Cross-phase carryContext
    // (UNTRUSTED):" (the carryContext is voice-derived and must never land in
    // the trusted prompt file) while Phase 1's "none" line keeps the plain
    // "Cross-phase carryContext:" label (nothing to mark untrusted when
    // there's no prior-phase context at all).
    expect(
      occurrences(
        AUTOPLAN_SKILL,
        '- **Cross-phase carryContext:** none — first review phase; run the voices with no prior context.',
      ),
    ).toBe(1);
    expect(occurrences(AUTOPLAN_SKILL, '- **Cross-phase carryContext (UNTRUSTED):**')).toBe(3);
    expect(
      occurrences(
        AUTOPLAN_SKILL,
        '- **Cross-phase carryContext (UNTRUSTED):** append the frozen prior-phase consensus summaries the\n  native review received into the UNTRUSTED-target file, fenced + datamarked with the panel nonce',
      ),
    ).toBe(3);
    // Total across both label variants — never a 5th or a missing stanza.
    expect(occurrences(AUTOPLAN_SKILL, '- **Cross-phase carryContext')).toBe(4);
  });

  test('the shared procedure documents carryContext as UNTRUSTED (never written to the trusted prompt file), reaching EVERY voice via the untrusted fence, and that a phase with no prior phase adds nothing', () => {
    // fix1 P1 #1 (gate-review P2 #4 / gate-grok / gate-eng-review follow-up
    // #5): carryContext is voice-derived (it distills what the outside
    // voices said in earlier phases), so a phase-N voice's injected line
    // could otherwise reach phase-N+1's TRUSTED instruction channel unfenced.
    // The fix moved it out of `$PANEL_PROMPT_FILE` into
    // `$PANEL_UNTRUSTED_FILE`, where `gstack-panel` fences + datamarks it
    // with the panel nonce like the review target — this replaces the old
    // "EVERY voice (CLI + fable + native Claude) sees it" / "same-phase
    // independence is unchanged" pins, which described the PRE-fix
    // (unsafe) routing and no longer appear in the rendered skill.
    expect(AUTOPLAN_SKILL).toContain(
      'Cross-phase carryContext is UNTRUSTED — NOT in this instructions file.',
    );
    expect(AUTOPLAN_SKILL).toContain(
      'Do NOT write it into `$PANEL_PROMPT_FILE`; append\n   it to `$PANEL_UNTRUSTED_FILE`',
    );
    expect(AUTOPLAN_SKILL).toContain('No prior phase → add nothing.');
    expect(AUTOPLAN_SKILL).toContain(
      'the carried context thus reaches EVERY voice\nvia `panel.payload.txt`, always inside the untrusted fence',
    );
  });
});

describe('M2 — panel findings are INPUT / NON-BLOCKING: never a binding verdict, never a new gate', () => {
  test('the master framing (Procedure Step 6) states findings are never a binding verdict and never a new gate', () => {
    expect(AUTOPLAN_SKILL).toContain(
      'the native findings; they are **never a binding verdict and never a new gate**. Do NOT auto-incorporate',
    );
  });

  test('every phase stanza intro is explicitly labeled ADVISORY + NON-BLOCKING (once per phase, 4 total)', () => {
    expect(
      occurrences(
        AUTOPLAN_SKILL,
        "Standard step for this phase, but **ADVISORY** and **NON-BLOCKING**: the\nrecommendation is display-only INPUT to this phase's decision",
      ),
    ).toBe(4);
  });

  test('every phase\'s override-rules bullet ends "...never a gate." (4 occurrences, one per phase)', () => {
    expect(occurrences(AUTOPLAN_SKILL, 'never a gate.')).toBe(4);
  });

  test("every phase's Route bullet is advisory + non-blocking and never opens a per-tension human gate (4 occurrences, one per phase)", () => {
    // fix1 P1 #3 (gate-codex P1 #1 / gate-grok P1 #1 / gate-review P2 #1 /
    // gate-eng-review P2-1): the invoke Route bullet used to interpolate
    // `${profile.routing}` — text written for the STANDALONE plan-*-review
    // skills' "present each tension — the user decides" flow, which does not
    // exist in autoplan and would fire a blocking per-tension
    // AskUserQuestion gate. `renderInvoke` now has its own advisory routing
    // sentence and no longer references `SURFACES[].routing` at all — the
    // old "never sets the" pin (0 occurrences now) is replaced by this text.
    expect(occurrences(AUTOPLAN_SKILL, '- **Route (advisory — NON-BLOCKING):**')).toBe(4);
    expect(
      occurrences(
        AUTOPLAN_SKILL,
        'never a\n  per-tension human gate or "user decides" sub-flow, and never a verdict, block, or new AskUserQuestion.',
      ),
    ).toBe(4);
    expect(AUTOPLAN_SKILL).not.toContain('never sets the');
    expect(AUTOPLAN_SKILL).not.toContain('present each tension — the user decides');
  });

  test('"Important Rules" names exactly the same THREE non-auto-decided gates — the panel\'s first-use egress consent is the only new one', () => {
    // fix1 P1 #5 (gate-grok P1 #3 / gate-codex): the panel's first-use
    // vendor egress consent (NEEDS_CONSENT) used to be missing from the
    // never-auto-decided list, so P6 "bias toward action" could auto-grant
    // sending review content to an external vendor. It is now the THIRD
    // never-auto-decided exception, alongside the two pre-existing gates
    // (premise confirmation, User Challenges).
    //
    // fix2 P1-2 (gate2-codex "Keep egress consent fail-closed in spawned
    // sessions" / gate2-review / gate2-eng-review): a spawned session (a
    // subagent with no user channel, told to auto-choose the recommended
    // option) could not satisfy the interactive "ask ONCE with
    // AskUserQuestion" text above, which collided with the generic
    // auto-choice rule and risked auto-granting egress. The "Three gates"
    // line now explicitly states the spawned-session behavior is to FAIL
    // CLOSED (vendor stays ABSENT), never auto-granted — this is pinned
    // both here (inline in the Three-gates sentence) and in a dedicated
    // test below (the fuller item-3 exception text) so either wording
    // regressing independently is caught.
    expect(AUTOPLAN_SKILL).toContain(
      '- **Three gates.** The non-auto-decided AskUserQuestions are: (1) premise confirmation in Phase 1, (2) User Challenges (native review + panel agree the user\'s direction should change), and (3) the panel\'s first-use vendor egress consent (`NEEDS_CONSENT: <voice>` for a non-Anthropic, non-codex vendor on a private/client repo) — external-vendor egress is never auto-granted, even under "bias toward action", and in a spawned session it fails CLOSED (vendor stays ABSENT). Everything else is auto-decided using the 6 principles.',
    );
    expect(AUTOPLAN_SKILL).not.toContain('Two gates');
    expect(AUTOPLAN_SKILL).not.toContain('Two exceptions');
    // Belt-and-suspenders: "never auto-decided" (any case) appears exactly 3
    // times in the generated skill — the "Three exceptions" heading, the
    // User Challenge definition, and the CEO override-rule mention — all
    // describing the SAME three gates (premise, User Challenge, egress
    // consent), never a fourth panel-specific one.
    expect(occurrences(AUTOPLAN_SKILL.toLowerCase(), 'never auto-decided')).toBe(3);
  });

  test('egress-consent gate (item 3) fails CLOSED in a spawned/auto-choose session — never falls through to the generic auto-decision', () => {
    // fix2 P1-2: pins the fuller item-3 exception text (the "Three
    // exceptions" list under "What Auto-Decide Means"), not just the
    // "Three gates" summary line above. Two behaviors must both render:
    // (a) interactive sessions ask ONCE and persist only an explicit
    // grant; (b) spawned/auto-choose sessions (no user channel to ask)
    // fail CLOSED — the vendor stays ABSENT rather than being auto-granted
    // by the 6 principles. If a future edit collapses these back into one
    // undifferentiated auto-decided path, this pin catches it even if the
    // "Three gates" line above is left untouched.
    expect(AUTOPLAN_SKILL).toContain(
      '**Interactive:** ask ONCE with AskUserQuestion and\n   persist consent only on an explicit grant. **Spawned / auto-choose session (a subagent has no\n   user channel):** the gate FAILS CLOSED — the vendor stays ABSENT (no egress), never\n   auto-granted by the 6 principles.',
    );
  });

  test('the single-sourced outside-voice boundary preamble is interpolated verbatim (no paraphrase, no drift from registry.ts)', () => {
    expect(AUTOPLAN_SKILL).toContain(
      'Do NOT read or execute any files under ~/.claude/, ~/.agents/, .claude/skills/, or agents/',
    );
  });
});

describe("M2 — codex-remnant guard: no dual-voice mechanics survive in autoplan's body", () => {
  test('none of the removed codex-exec / dual-voice literals remain in the autoplan BODY (the preamble\'s one boilerplate "codex exec" mention is explicitly out of scope)', () => {
    // The shared preamble legitimately carries one "codex exec" mention (the
    // plan-mode safe-operations allowlist present in every gstack skill).
    // Confirm that IS where it lives (so the exclusion below is real, not
    // accidentally matching nothing), then assert the autoplan-specific BODY
    // has none of the removed dual-voice mechanics.
    expect(AUTOPLAN_SKILL.slice(0, BODY_START)).toContain('codex exec');

    for (const remnant of [
      'codex exec',
      '--yolo',
      '_gstack_codex_timeout_wrapper',
      '_gstack_codex_auth_probe',
      '_CODEX_AVAILABLE',
      'gstack-codex-probe',
      'DUAL VOICES — CONSENSUS',
      'Claude subagent',
      'CLAUDE SUBAGENT',
    ]) {
      expect(AUTOPLAN_BODY, `"${remnant}" must not remain in autoplan's body`).not.toContain(remnant);
    }
    expect(AUTOPLAN_BODY.toLowerCase()).not.toContain('codex says');
    expect(AUTOPLAN_BODY.toLowerCase()).not.toContain('dual voice');
  });

  test('CODEX_WEB_SEARCH_FLAG sites are gone entirely with the removed inline codex blocks', () => {
    expect(AUTOPLAN_SKILL).not.toContain('CODEX_WEB_SEARCH_FLAG');
  });
});

describe('M2 — the shared panel procedure is emitted exactly once; the 4 phase stanzas dispatch it via variant=invoke', () => {
  test('the generated SKILL.md carries exactly one "Outside Voices — Advisory Panel Procedure" section (never re-inlined per phase)', () => {
    expect(
      occurrences(
        AUTOPLAN_SKILL,
        '## Outside Voices — Advisory Panel Procedure (shared; recommendation only — the user decides)',
      ),
    ).toBe(1);
  });

  test('no unresolved {{OUTSIDE_VOICES...}} placeholder residue in the generated output', () => {
    expect(AUTOPLAN_SKILL).not.toContain('{{OUTSIDE_VOICES');
  });

  test('the .tmpl source uses variant=procedure exactly once and variant=invoke exactly 4 times, with the correct per-phase carry= chain', () => {
    expect(occurrences(AUTOPLAN_TMPL, '{{OUTSIDE_VOICES:variant=procedure}}')).toBe(1);
    expect(occurrences(AUTOPLAN_TMPL, 'variant=invoke')).toBe(4);

    const invokePlaceholders = [
      '{{OUTSIDE_VOICES:variant=invoke:surface=ceo}}',
      '{{OUTSIDE_VOICES:variant=invoke:surface=design:carry=ceo}}',
      '{{OUTSIDE_VOICES:variant=invoke:surface=eng:carry=ceo+design}}',
      '{{OUTSIDE_VOICES:variant=invoke:surface=devex:carry=ceo+eng}}',
    ];
    for (const placeholder of invokePlaceholders) {
      expect(occurrences(AUTOPLAN_TMPL, placeholder), `expected exactly one ${placeholder}`).toBe(1);
    }
  });

  test('run_in_background: false is preserved on the fable dispatch (shared procedure + each of the 4 phase invocations = 5)', () => {
    // The exact mechanism that keeps the panel's fable voice from racing
    // gstack-vote's tabulation (fable must finish before Step 4 runs) — a
    // future variant=invoke edit could drop it silently otherwise.
    // test/run-in-background-guidance.test.ts also gates this file-wide;
    // pinned here too because it is integral to the panel recipe itself.
    expect(occurrences(AUTOPLAN_SKILL, 'run_in_background: false')).toBe(5);
  });
});
