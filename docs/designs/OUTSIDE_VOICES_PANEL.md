# Design: Outside Voices Panel — Unified Multi-Model **Advisory** Review

Generated on 2026-08-29
Branch: skills/port-1.68.2 (fork: sneakygriff/gstack)
Status: LIVING DOCUMENT — **v2** (supersedes v1). v1 was BLOCKED by the adversarial
panel review (`OUTSIDE_VOICES_PANEL_REVIEW.md`, 24 confirmed findings OV-1..OV-24,
unanimous BLOCK). v2 re-anchors the design on two locked user decisions and resolves
every finding. Update as milestones land and gotchas surface.

**Approved:** user (2026-08-30) — approved for autobuilder build to completion, on feature
branch `feat/outside-voices-panel`.

## Version note (v1 → v2)

v1 proposed a **binding vote**: "majority of ready voices sets the verdict," with a
fail-closed escalation valve keyed on a self-asserted `reproducible` boolean. The panel
review found that this silently reversed gstack's most consistent invariant — outside
voices are *informational, never blocking, "the user decides"* — and shipped two P0
security holes (untrusted diffs fed to three agentic CLIs with no sandbox/fence/transport;
an injectable vote keyed on a field no CLI emits). It also over-scoped the consolidation,
mis-stated the config/dashboard mechanics, and left the vote function literally
unimplementable (2-2-1 and 1-1-1 have no majority).

**v2 removes the binding vote entirely.** The panel is an **advisory** layer: it produces
a *recommendation* plus surfaced tensions and dissents, and routes them through the
**existing human gate** (`review.ts` Outside-Voice flow — "present each tension, the user
decides"). No majority sets any verdict anywhere. This one change dissolves OV-1, most of
OV-3's severity, and OV-8 outright, and lets us keep the genuinely valuable 80% — one
resolver rendering N voices instead of six divergent copies.

### Two locked decisions (anchor the whole design)

1. **Authority = ADVISORY.** Outside voices are INFORMATIONAL. Aggregation yields a
   RECOMMENDATION plus surfaced tensions/dissents — **never a binding outcome**. Panel
   findings route through the EXISTING human gate and the EXISTING fix-first/finding
   pipeline; they add **no new blocking gate** on any surface, including pre-landing
   `review`. Invariant preserved verbatim: *outside voices never block; the user decides.*
2. **Roster = all four default-on** (`codex`, `grok`, `gemini`, `fable`) on every review
   surface — **precisely because they are advisory** (a wrong advisory voice costs a
   sentence of the user's attention, not a blocked ship). `fable` stays in. Because it is
   all-four-default-on-and-paid, v2 adds three structural guards as M1 requirements:
   a `panel_budget_usd` cap, egress receipts + a redaction pass + first-use consent, and a
   Security & Threat Model section.
   > **M1 shipped deviation:** the M1 ship gate ("no external voice default-on until the
   > write-denial sandbox test passes for its CLI") outranked this locked default at ship
   > time — `grok_reviews`/`gemini_reviews` shipped **default-off** (grok: live canary
   > showed its CLI sandbox does not deny writes; gemini: auth-blocked, unverified). The
   > all-four-on roster resumes per-voice once each canary passes; see the config-key
   > table below.

### Five baked-in defaults (the other open questions, resolved)

- **Teeth: none.** Advisory on ALL surfaces incl. pre-landing `review`. Panel findings feed
  the existing fix-first/finding pipeline; they never add a blocking gate.
- **autobuilder-loop: OUT OF SCOPE** for the advisory layer. Its stricter union-FAIL forum
  (any `[P1]` from either external model FAILs the gate) is preserved **unchanged**; a test
  pins the divergence (see [Non-Goals](#non-goals)).
- **Egress:** public repo → external voices on; private/client repo → first-use per-vendor
  consent for the NEW vendors (grok, gemini); codex keeps its current behavior. A
  `redact-engine` pass runs over the assembled prompt before ANY external invoke; one egress
  receipt per external invocation.
- **Verdict mechanism:** a fully-specified `tallyVoices()` that emits an **advisory
  recommendation**, not a binding state machine. Defined completely and unit-tested.
- **Cost:** `panel_budget_usd` default **$1.50/run**; once projected spend would exceed it,
  remaining voices are marked **ABSENT (budget-capped)**, not run.

## What This Feature Does

Today gstack's review family gets one non-Claude "outside voice" — **Codex** — and only in
some surfaces. This feature turns that into a **unified advisory panel of four outside
voices** that review the same target independently, then are aggregated into a
**recommendation + surfaced dissents** that routes through the *existing* human gate:

| Voice | Vendor | Mechanism | Status today |
|-------|--------|-----------|--------------|
| `codex` | OpenAI | `codex` CLI (existing wrapper, `-s read-only`) | Fully wired |
| `grok` | xAI | `grok` CLI (reuses codex timeout wrapper, `--sandbox read-only`) | Works in `autobuilder-loop` + `plan-deliverables` |
| `gemini` | Google | `gemini` CLI (session-runner exists; **reviewer path must not use `--yolo`**) | Benchmark-only, never a reviewer |
| `fable` | Anthropic | Claude subagent, Agent tool, runtime `model: fable` | Overlay exists; never a reviewer |

Plus the **native Claude** review already present. The panel is **five informational
voices** (four outside + Claude), rendered through **one shared resolver** instead of the
genuinely-divergent copies, on the plan-time reviews **and** the pre-landing code review.
None of them blocks; all of them advise.

### Design decisions (locked with the user)

- **Scope:** unified advisory layer — plan reviews (`autoplan` + `plan-*-review`) **and**
  code `review`. `autobuilder-loop` is a non-goal (its stricter forum is preserved).
- **Participation:** independent within a phase → merged (voices never see each other's
  output). Cross-phase context that `autoplan` already threads forward is preserved (see
  [§7](#7-findings-pipeline-integration)).
- **Authority:** ADVISORY — recommendation through the existing human gate. No binding vote.
- **Panel roster:** all four voices default-on everywhere (advisory); **global**
  kill-switches trim (config is one global file — see [Config](#config--kill-switches)).
- **Teeth:** none. Findings feed the existing fix-first/finding pipeline; no new gate.

## The Core Problem: One Advisory Primitive Over Two Mechanisms and the Duplicated Copies

Three facts shape the design:

1. **Two invocation mechanisms.** `codex`/`grok`/`gemini` are external CLIs (bash +
   `_gstack_codex_timeout_wrapper`). `fable` is a **Claude model** dispatched by the
   orchestrator via the Agent tool (runtime `model: fable`, overlay `{{INHERIT:claude}}`).
   The panel hides both behind one adapter contract.

2. **The genuinely duplicated code is narrower than v1 claimed** (OV-19). CEO / eng / devex
   plan reviews **already share one resolver** — `generateCodexPlanReview`, emitted as
   `{{CODEX_PLAN_REVIEW}}` (`plan-ceo-review/sections/review-sections.md.tmpl` line 254,
   `plan-eng-review` line 60, `plan-devex-review` line 204). The real duplication is:
   **autoplan's four inline per-phase blocks** + **`design.ts` `generateDesignOutsideVoices`**
   + **`review.ts` `generateAdversarialStep`**. The unified layer consolidates *those*; the
   payoff is real but smaller than "duplicated ~6 ways."

3. **"One panel" spans two decision currencies** (OV-4). `autoplan` resolves each issue
   under its 6 principles (Mechanical / Taste / User-Challenge); `review` gates land/block
   with GATE FAIL on `[P1]`. A single PASS/CONCERNS/BLOCK enum drives *neither*. The panel
   therefore exposes two thin, currency-specific adapters over one shared invocation +
   aggregation layer, and **neither adapter sets a verdict** — both feed existing machinery.

```
   INDEPENDENT PASSES (per phase)        MERGE + TALLY (advisory)       ROUTES INTO (existing)
   ══════════════════════════════        ════════════════════════       ══════════════════════
   codex   (CLI, read-only) ─┐
   grok    (CLI, read-only) ─┤  bin/gstack-panel ─┐
   gemini  (CLI, read-only) ─┘  (seq-foreground,  │  bin/gstack-vote      ┌ planPanelAdvice()
                                 per-voice result  ├─ lib/outside-voices/  │  → plan human gate
   fable  (subagent) ─ Agent ──►│  files, budget)  │     vote.ts           │    (user decides)
   claude (native)  ─ Agent ───►┘                  │  tallyVoices() ───────┤
                                                    ▼                       └ diffGate()
                                          RECOMMENDATION + dissents            → existing fix-first
                                          (never binding)                        + [P1] rule (unchanged)
```

## Architecture

### 1. Voice registry & two adapter kinds — with a MANDATORY security contract

A single registry (new module `lib/outside-voices/registry.ts`) is the one place a voice is
declared. Two adapter *kinds*:

- **CLI adapter** (`codex`, `grok`, `gemini`): `preflight` (auth/version/model probe),
  `invoke` (command via `_gstack_codex_timeout_wrapper`), `killSwitch` (`{name}_reviews`
  config key), `parse` (stdout → normalized verdict), plus the four security fields below.
- **Subagent adapter** (`fable`): the Agent-tool dispatch spec (runtime `model: fable`,
  adversarial-reviewer prompt, structured-output contract) → the same normalized verdict.

Every adapter MUST declare these four **invariant-tested** security fields (OV-2). They are
not prose guidance; `test/skill-recipe-invariants.test.ts` asserts each adapter carries them,
and **no external voice is default-enabled until an OS-level write-denial test passes**:

| Field | Requirement | Grounded in |
|-------|-------------|-------------|
| `sandbox` | OS-level **read-only** sandbox. codex `-s read-only`; grok `--sandbox read-only`; gemini `-s read-only` with default (non-auto-approve) tool approval. **`--yolo` is FORBIDDEN for any reviewer.** | codex `bin/gstack-codex-probe` (`-s read-only`); grok `autobuilder-loop` (`--sandbox read-only`); gemini runner's `--yolo` is benchmark-only (`test/helpers/gemini-session-runner.ts` line 128) and MUST NOT be the reviewer path |
| `boundary` | A **single-sourced** boundary preamble prepended to every prompt. Promote the existing `CODEX_BOUNDARY` (`review.ts` line 21) to a shared `OUTSIDE_VOICE_BOUNDARY` exported once; no per-call copies to drift. | `review.ts` `CODEX_BOUNDARY` |
| `fences` | **BEGIN/END UNTRUSTED** fences around ALL diff/plan/spec content, with a datamark instructing the model to treat fenced content as data, never instructions. | new; mirrors the datamark idea in OV-16 |
| `transport` | **File-based** prompt transport: assemble the prompt into a temp file, pass via `"$(cat FILE)"` / `-p "$(cat FILE)"`. **Never inline argv/heredoc** a diff's bytes could break out of. | existing `plan-deliverables` pattern (`codex exec "$(cat "$GAP_PROMPT_FILE")"`, `grok -p "$(cat "$GAP_PROMPT_FILE")"`) |

New wiring required:
- `grok`: kill-switch already present (`grok_reviews`, `bin/gstack-config` line 148); add a
  reviewer probe. Add the **only genuinely-missing** taxonomy/pricing row (`scripts/models.ts`,
  `test/helpers/pricing.ts` — grok is absent from both; see OV-17 inventory correction).
- `gemini`: add `gemini_reviews` kill-switch + a reviewer probe modeled on the session
  runner **but with `-s read-only`, not `--yolo`** (`model-overlays/gemini.md` exists;
  `models.ts`/`pricing.ts` already carry `gemini`).
- `fable`: add `fable_reviews` kill-switch; no CLI. Runtime dispatch is `model: fable` with
  the autobuilder loop-start probe + `claude-opus-4-8` fallback pattern (`autobuilder-loop`
  line 111), **not** `claude-fable-5` (that is the taxonomy id in `models.ts`, not the
  runtime dispatch id — OV-17).

### 2. Invocation primitive — orchestrator-coordinated, durable, budgeted

It cannot be one self-contained script, because `fable` must be dispatched by Claude. The
resolver emits coordinated steps, generalized from the flow `autoplan` already uses
(dispatch a subagent **and** run codex, then tabulate). Control flow and durability are
specified explicitly (OV-12):

1. Orchestrator assembles the prompt for the surface/phase, applies the redaction pass
   (§Security), wraps untrusted content in UNTRUSTED fences, and writes it to a temp file.
2. **`bin/gstack-panel`** runs the CLI voices. **Precedent is sequential-foreground**:
   `autoplan` states "NEVER run phases in parallel" (line 110) and runs its dual voices
   "sequentially in foreground" (line 307). v2 follows that precedent — external CLIs run
   **sequentially, foreground, each timeout-wrapped**, so it does not blow the 600000ms Bash
   ceiling and a harness kill cannot destroy all voices at once. **This corrects v1's "run
   concurrently" claim.** If a surface genuinely needs parallelism, the sanctioned
   divergence is **background + Monitor** (never one blocking Bash call spanning a ~22-min
   ladder) — documented as an explicit, justified exception, not the default.
3. **Durability:** each voice writes its OWN normalized `<voice>.result.json` on completion.
   `bin/gstack-panel --collect` is a **salvage mode** that reads whatever result files exist
   — a mid-run kill still yields partial results; a missing file → that voice **ABSENT**.
4. **Per-voice ladder cap:** each voice's timeout ladder is bounded **< 600s − slop** (e.g.
   540s, matching the existing adversarial codex call) OR moved to background+Monitor for
   longer ladders. Never a single Bash call that can exceed the harness ceiling.
5. Claude dispatches the **`fable` subagent** (`model: fable`) and runs the **native Claude**
   pass; both write the same JSON shape to result files.
6. **`bin/gstack-vote`** reads all result files, runs `tallyVoices()`, prints the consensus
   table + recommendation. It is the **ONLY** tabulation path (v1's "or an inline TS call"
   is deleted — one code path, one place to test).
7. **Hard per-surface wall-clock budget** (OV-22): any voice still running past the budget is
   marked **ABSENT (wall-clock)**. Each voice also logs a `bin/gstack-review-log` entry.

### 3. Normalized verdict schema — machine-readable, validated, parse-fail = ERROR

Every voice returns the same shape so aggregation is mechanism-agnostic. v1's self-asserted
`reproducible` boolean is replaced by `repro_command` (OV-3), and the block is a **strict,
delimited, machine-readable JSON** object the parser extracts by fence:

```jsonc
{
  "schema": "outside-voice/v2",
  "voice": "grok",                 // codex | grok | gemini | fable | claude
  "vendor": "xai",                 // openai | xai | google | anthropic
  "status": "ready",               // ready | absent | error
  "verdict": "CONCERNS",           // PASS | CONCERNS | BLOCK   (advisory recommendation input)
  "findings": [
    {
      "severity": "P1",            // enum: P0 | P1 | P2 | P3
      "claim": "…",                // size-capped, datamarked
      "location": "path#symbol",   // stable symbol/anchor ref; validated to resolve in-repo
      "repro_command": "bun test test/foo.test.ts -t 'name'"  // nullable; a COMMAND, not a bool
    }
  ],
  "tokens": 12043,                 // nullable; CLI-only best-effort (OV-18)
  "cost_usd": 0.031                // nullable; CLI-only best-effort (OV-18)
}
```

- **Parse failure = ERROR, never a silent guess** (OV-3). A voice that ran but whose JSON
  block cannot be parsed → `status: error` — it is surfaced loudly (not silently ABSENT) and
  casts no vote.
- **Output validation before it becomes agent-facing** (OV-16): strict **schema** check,
  **enum** check (`verdict`, `severity`, `status`), **size caps** on free-text fields,
  **location validation** (a `location` that does not resolve to an in-repo path/symbol
  marks the finding "unlocated" and it cannot be promoted — see §7), and **datamark** so the
  model's own text can never be read as an instruction to the orchestrator.
- **`repro_command` is for ranking, not vetoing** (OV-3 residue is moot under advisory). The
  orchestrator MAY run it read-only to *promote* a finding's confidence (§7); it never
  triggers an auto-outvote, because nothing here is binding.
- **Cost is best-effort, CLI-only** (OV-18). `tokens`/`cost_usd` are nullable; the Agent-tool
  dispatch does not expose subagent tokens, so per-run totals that include native Claude and
  fable are **not** promised.

### 4. Two decision currencies — `planPanelAdvice()` and `diffGate()`

One aggregation layer, two thin currency-specific adapters that **share only the invocation
layer** (OV-4). Neither sets a verdict:

- **`planPanelAdvice(tally)`** (plan surfaces): renders the advisory recommendation +
  surfaced tensions/dissents into the **existing** plan-review human-gate flow (the
  `{{CODEX_PLAN_REVIEW}}` "present each tension, the user decides" contract, `review.ts`
  lines 707–737). `autoplan`'s 6-principle auto-decision consumes panel findings **as input**
  (exactly as it consumes codex today) but the panel never sets the phase verdict.
- **`diffGate(tally)`** (pre-landing `review`): normalizes panel findings into the existing
  review-finding contract and hands them to the **existing fix-first pipeline**. The current
  `[P1]` GATE FAIL rule is **unchanged** and is driven by the native review, not by the
  panel. Outside-voice findings are tagged advisory and **never by themselves set GATE FAIL**
  (teeth = none). `diffGate()` is a normalizer, not a new gate.

The v1 parenthetical "(plan reads: PROCEED|REVISE|STOP)" is **deleted** — the enum does not
carry that mapping; the plan currency lives in the existing 6-principle engine.

**Per-surface action matrix:**

| Surface | Panel auto-runs? | Aggregation adapter | Recommendation routes to | Can it block? |
|---------|------------------|---------------------|--------------------------|---------------|
| `autoplan` (CEO phase + per-phase) | Yes | `planPanelAdvice()` | 6-principle auto-decision as input + human gate on taste | No |
| `/review` (pre-landing diff) | Yes | `diffGate()` | existing fix-first pipeline + `[P1]` rule (unchanged) | No |
| `plan-{ceo,eng,devex}-review` (interactive, direct) | **Only if the user asks** (OV-22) | `planPanelAdvice()` | existing human gate | No |
| `design-review` / `plan-design-review` | Per its existing opt-in (design-review auto; others opt-in) | `planPanelAdvice()` | existing human gate | No |
| `autobuilder-loop` | **No (non-goal)** | — (its union-FAIL forum preserved) | — | (unchanged: its own strict forum) |

Reconciliation with the locked all-four-default (OV-22): "default-on everywhere" governs
**which voices are in the roster when the panel runs**, not that the panel force-runs on
every interactive invocation. On interactive plan reviews the panel is offered, not
auto-fired, so a human reviewing a plan by hand does not pay four cold CLI preflights unless
they ask. It auto-runs on the unattended/high-value surfaces (`autoplan` CEO + `/review`).

### 5. `tallyVoices()` — fully specified advisory aggregation

The heart of "advisory." One tested function in `lib/outside-voices/vote.ts` (co-located
with `registry.ts` — **not** `lib/gstack-decision.ts`, which is an append-only
institutional-memory store and the fork's merge-risk surface; OV-13). It returns a
**recommendation for display**, never a decision:

```
tallyVoices(results[]) -> {
  recommendation: PASS | CONCERNS | BLOCK | null,   // null when no recommendation is emitted
  status: OK | SINGLE_VENDOR_ANTHROPIC | INSUFFICIENT_QUORUM | NO_VOICES,
  quorum: { readyVoices, readyVendors },
  perVoice[], perVendor[],
  tensions[], dissents[], diversityFlags[]
}
```

**Ordinal scale:** `PASS = 0`, `CONCERNS = 1`, `BLOCK = 2`.

**Vendor-collapsed median** (implements "count each vendor once" — OV-6/OV-11 — so the
correlated Anthropic pair cannot double-weight the recommendation):

1. Consider only `status: ready` voices. `absent` and `error` voices cast no ordinal.
2. Group ready voices by **vendor** (`openai`, `xai`, `google`, `anthropic`; note native
   Claude **and** fable are both `anthropic`).
3. Per vendor, reduce to one ordinal = the **median** of that vendor's ready voices'
   ordinals (so Claude + fable collapse to a single anthropic ordinal), using the same
   even-count tiebreak as step 4.
4. `recommendation` = the **median across the per-vendor ordinals**. **Even-count tiebreak:**
   when the two middle ordinals are **equal**, use that value; when they **differ** (a genuine
   split, e.g. `[PASS, BLOCK]`), the recommendation is **CONCERNS** — an advisory panel
   surfaces cross-vendor disagreement as "look closer," never resolving a tie into PASS or
   BLOCK. Map back to PASS/CONCERNS/BLOCK.

This makes the previously-unimplementable cases well-defined (OV-5): a 3-way one-each split
`[PASS, CONCERNS, BLOCK] = [0,1,2]` → median `1` = **CONCERNS**; a `[PASS, PASS, CONCERNS,
BLOCK, BLOCK]`-shaped spread → middle value `1` = **CONCERNS**. No "majority" is ever
required, and no distribution is undefined.

**Numeric quorum:** `readyVoices ≥ 2` to emit any recommendation.

**Ordered degradation guards** (evaluated top-to-bottom; the FIRST match sets `status`, so
each absence pattern hits **exactly one** rule — OV-5):

1. `readyVoices == 0` → `status: NO_VOICES`, `recommendation: null`. The surface proceeds
   exactly as it does **today with zero outside input** (pre-feature behavior). Never a
   block, never an auto-pass.
2. `readyVoices == 1` → `status: INSUFFICIENT_QUORUM`, `recommendation: null`. Present the
   single voice as informational; defer entirely to the human gate.
3. `readyVoices ≥ 2` **and** `readyVendors == 1` (only Anthropic voices ready — native
   Claude and/or fable, all external CLIs absent/errored) → emit the median recommendation
   but tag `status: SINGLE_VENDOR_ANTHROPIC`; the recommendation is explicitly marked
   **low cross-vendor diversity** (fable adds no external diversity — OV-6/OV-11).
4. `readyVoices ≥ 2` **and** `readyVendors ≥ 2` → `status: OK`; emit the median
   recommendation + surfaced dissents/tensions.

**Orthogonal annotations** layered on any emitting path:

- `[claude-voice-errored]` when native Claude specifically errored/absent but ≥1 external
  voice is ready (native Claude is one voice; its absence does not halt the tally — OV-5).
- **Dissent surfacing** (OV-6): whenever an Anthropic-collapsed recommendation would differ
  from a dissenting **non-Anthropic** voice, surface that non-Anthropic dissent prominently
  in the table. Agreement across correlated voices is not treated as extra confirmation.

**`ran-but-unparseable = ERROR, not ABSENT`** (OV-5): a voice that produced output that fails
schema/parse is `status: error` and is surfaced loudly; only genuinely-not-run voices
(off / unauth / quota / **budget-capped** / timeout-before-output / host-self-exclusion /
wall-clock) are `absent`.

**`bin/gstack-vote` is the ONLY tabulation path** (OV-5). `tallyVoices()` is pure and
unit-tested; nothing re-implements it inline.

**Unit-test truth table** (asserted in `test/outside-voices-vote.test.ts`):

| # | Ready voices (vendor:verdict) | Expected recommendation | Expected status / tags |
|---|-------------------------------|-------------------------|------------------------|
| 1 | openai:PASS, xai:PASS, google:PASS | PASS | OK |
| 2 | openai:PASS, xai:CONCERNS, google:BLOCK | CONCERNS | OK (one-each → median) |
| 3 | openai:PASS, xai:PASS, anthropic(claude:CONCERNS, fable:BLOCK) | PASS | OK (anthropic collapses to CONCERNS; vendor medians [0,0,1] → 0) |
| 4 | openai:BLOCK, anthropic(claude:PASS, fable:PASS) | CONCERNS | OK (vendors [openai:2, anthropic:0] differ → CONCERNS; surfaces the split) |
| 5 | anthropic(claude:CONCERNS, fable:PASS) only | CONCERNS | SINGLE_VENDOR_ANTHROPIC |
| 6 | openai:PASS only | null | INSUFFICIENT_QUORUM |
| 7 | (none ready) | null | NO_VOICES |
| 8 | openai:BLOCK, xai:PASS; native claude ERROR | PASS-vs-BLOCK → CONCERNS | OK + [claude-voice-errored] |
| 9 | openai:CONCERNS, xai:CONCERNS, google ran-but-unparseable | CONCERNS | OK; google = error (surfaced), not absent |
| 10 | openai:PASS, xai:BLOCK (non-Anthropic dissent) | CONCERNS | OK + dissent surfaced |

> Note on rows 4 & 8: two vendor ordinals that **differ** (e.g. `[PASS, BLOCK]`) resolve to
> **CONCERNS**, not to either extreme — the panel surfaces a genuine cross-vendor split as
> "look closer" rather than letting one vendor's verdict win the tie. Both rows share the
> `[PASS, BLOCK]` shape and therefore share the CONCERNS result; the test pins this so the
> even-count rule cannot silently flip.

This is **advisory**: `recommendation` is a display value that routes into the existing human
gate / fix-first pipeline. It sets nothing.

### 6. One generation-time resolver replaces the genuinely-duplicated copies

New `scripts/resolvers/outside-voices.ts`, registered in `scripts/resolvers/index.ts`
(`RESOLVERS` record, currently ~59 entries at line 40), emitting
`{{OUTSIDE_VOICES:surface=…}}`. It renders **N advisory voices** (per-voice-row table +
recommendation), under the security contract, budget cap, and consent flow.

Because CEO/eng/devex **already share** `generateCodexPlanReview` (OV-19), the migration
renames that function to **`generateOutsideVoices`** and repoints the three templates'
`{{CODEX_PLAN_REVIEW}}` placeholder to `{{OUTSIDE_VOICES:surface=…}}` — lighting up all three
plan reviews at once (which is exactly why "wire ONE plan surface" was impossible — OV-10).

| Surface | Today | After |
|---------|-------|-------|
| `plan-{ceo,eng,devex}-review` (`{{CODEX_PLAN_REVIEW}}`, shared) | one shared codex resolver | `generateOutsideVoices` → `{{OUTSIDE_VOICES:surface=…}}`, N advisory voices |
| `plan-design-review` / `design-review` (`generateDesignOutsideVoices`, `design.ts:541`) | own copy | delegate to the shared resolver (keep its host guard, §OV-17) |
| `review` adversarial step (`generateAdversarialStep`, `review.ts:473`) | own copy | delegate to the shared resolver |
| `autoplan` phase blocks (4 inline dual-voice blocks + 2-col tables) | hardcoded 2-voice | `{{OUTSIDE_VOICES:…}}` + N-voice per-row tables |

The 2-column consensus table generalizes to the **per-voice-row** layout in
[§Consensus table](#consensus-table-mockup-terminal-width) (a voice-per-column table wraps at
five voices — OV-24). Authoring stays: edit `.tmpl`/resolver → `bun run gen:skill-docs` →
`bun run skill:check` (fails on stale `.md`; never hand-edit generated `SKILL.md`).

`autoplan` deliberately **skips** the loaded plan-review skills' own outside-voice sections
(skip list includes "Design Outside Voices") and runs its own per-phase voices. After
consolidation both paths call the *same* resolver, so the skip-list stays (it prevents
double-running the identical block) and behavior converges.

### 7. Findings pipeline integration

- **Same-phase independence vs cross-phase context** (OV-21): within a phase, voices are
  blind to each other (independent → merged). But `autoplan` **deliberately feeds
  prior-phase findings forward** ("each builds on the previous," line 110); the panel
  receives the same cross-phase context the native review gets — a flat "same target
  independently" resolver that strips it would regress `autoplan`. The resolver takes an
  explicit `carryContext` input for the cross-phase case.
- **Run the panel BEFORE dedup + Fix-First** (OV-21): panel findings are emitted before
  `generateCrossReviewDedup` and the fix-first step, so they are deduped and prioritized
  **alongside** native findings, not bolted on after.
- **Normalize into the existing review-finding contract** (OV-21): each panel finding is
  mapped to the existing finding shape with **confidence**, **fingerprint**, and
  **AUTO-FIX-vs-ASK** classification, so downstream machinery treats a panel `[P1]` exactly
  like a native `[P1]` (fixed-first; never a new gate — teeth = none).
- **Rank by reproduction, not seat count** (OV-23): "agreement is signal, not proof." A
  finding is **promoted** (surfaced in the main table) when it **quotes the exact line/symbol**,
  **is corroborated by a second voice**, **or** its `repro_command` reproduces read-only.
  Unreproduced / unlocated findings drop to an **appendix**. Seat count alone never promotes a
  finding. `gemini` gets a seat in the roster but its findings, like every voice's, must earn
  promotion by reproduction.

### 8. review-log + dashboard

**Correction (OV-15):** v1 claimed the `/ship` dashboard would show "the full panel and its
vote." It cannot today. `{{REVIEW_DASHBOARD}}` (`generateReviewDashboard`) keys on a **fixed
skill-name list** and reads only the **latest `codex-plan-review`** entry for the Outside
Voice row; the per-voice `source` field is **audit-only** — `review.ts:36` says
`autoplan-voices` / `design-outside-voices` entries "are not checked by any consumer."

v2 plan:
- Until the dashboard rework lands (M3), the panel writes **audit-only** `bin/gstack-review-log`
  entries (matching today's semantics), and the dashboard shows the codex row as before —
  **no false claim**.
- The dashboard rework is enumerated as an explicit M3 task: teach `generateReviewDashboard`
  to read a new `outside-voices` log record (per-voice sub-entries + `tallyVoices()`
  recommendation) and render the N-voice consensus row. Listed in Files Touched.

## Security & Threat Model

New section (its absence was a P0 — OV-2). The panel systematically sends untrusted-by-
definition input to third-party agentic CLIs; this section is a **hard M1 gate** before any
external voice is invoked default-on.

**Assets:** repo secrets (`.env`, keys — codex/grok run read-only against the *whole* repo,
not just the diff), private/client source, the orchestrator's own action authority.

**Adversary:** a prompt-injection payload embedded in the untrusted content the panel reviews
— any-author diffs, plan docs quoting external material, dependency READMEs, issue text.

**Threats:**
- **T1 — Code execution / exfil:** an injected diff drives a CLI tool-action (the one in-repo
  gemini precedent, `gemini … --yolo`, auto-approves *every* tool action with cloud creds and
  repo cwd — a prompt-injected diff becomes code execution).
- **T2 — Advice poisoning / orchestrator injection:** injected content makes a model emit an
  attacker-chosen verdict/findings to skew the advisory tally, or embeds instructions in
  findings text that the orchestrator then reads.
- **T3 — Systematic egress:** default-on transmission of private/client source to
  OpenAI/xAI/Google.
- **T4 — Secret leakage:** secrets in the egressed prompt.

**Mitigations** (the first four are the MANDATORY, invariant-tested adapter fields from §1;
the rest are M1 requirements):

1. **OS-level read-only sandbox per CLI** (T1). `--yolo` FORBIDDEN for reviewers. No external
   voice is default-enabled until an **OS-level write-denial test** passes — a canary that
   asks the sandboxed CLI to write a sentinel file and asserts the write fails.
2. **Single-sourced boundary preamble** (T2) — shared `OUTSIDE_VOICE_BOUNDARY`.
3. **BEGIN/END UNTRUSTED fences + datamark** around all diff/plan/spec content (T1/T2).
4. **File-based prompt transport** (T1) — never inline argv/heredoc.
5. **Redaction pass before ANY external invoke** (T4 — OV-9): run `lib/redact-engine.ts`
   `scan()` over the assembled prompt file. A **HIGH-tier** hit → `applyRedactions()` to mask,
   or, if masking would gut the review, mark that voice **ABSENT loudly** (never silently
   send). `repoVisibility` recorded on findings drives sterner wording on private/client
   repos. (This mirrors `lib/gstack-decision.ts`, which already rejects HIGH-tier secrets on
   write via the same engine.)
6. **Per-invocation egress receipt** (T3 — OV-9): every external voice call writes a receipt
   **before** the send, fail-closed (no receipt → no send), via
   `bin/gstack-egress-receipt write --sink outside-voice:<voice> --host <api-host>
   --class review-prompt --payload-file <the-same-prompt-file> --consent "<voice>_reviews=enabled"`.
   The payload file hashed by the receipt is the *same* file passed to the CLI, so the hash
   matches the exact bytes sent. Each of the three external voices is added to the pinned
   sink list in `test/egress-receipt-wiring.test.ts` with **fail-closed** polarity, so a
   future un-receipted call site fails CI.
7. **First-use per-vendor consent** (T3 — OV-9): repo visibility comes from
   `redact_repo_visibility` (empty → gh/glab detection). **Public repo** → external voices on.
   **Private/client repo** → first-use per-vendor consent for the NEW vendors (`grok`,
   `gemini`) via AskUserQuestion, persisted as a consent key (`grok_reviews_consent`,
   `gemini_reviews_consent`). `codex` keeps its current behavior (already consented via
   `codex_reviews`). `fable`/native Claude are Anthropic — no new egress, no new consent.
8. **Output validation** (T2 — OV-16): external model OUTPUT is schema/enum/size/location-
   validated and datamarked before it becomes agent-facing (§3).

**M1 ship gate:** no external voice is default-on until (a) the write-denial sandbox test
passes, (b) `test/egress-receipt-wiring.test.ts` includes it, and (c) the redaction pass is
wired.

## Roster, Cost & Budget

Default: **all four voices on, every review surface** (locked). Because they are advisory,
the failure mode is **silent cost creep, not silent authority creep** — so the structural
guard is a budget cap, not a default-off (OV-7):

- **`panel_budget_usd`** (M1 requirement): default **$1.50/run**. External voices run in a
  defined order (codex first — the proven one — then grok, gemini). Before each external
  invoke, if projected spend would exceed the cap, the remaining un-run external voices are
  marked **ABSENT (budget-capped)**, not run. The cap governs **external CLI spend**; native
  Claude + fable are Anthropic subagents whose tokens the Agent tool does not expose
  (OV-18), so they do not draw against the USD cap in a metered way — documented, not hidden.
- **Honest decay note** (OV-7): all-four-default-on-and-paid predictably trends toward
  "codex-only in practice" as users hit quotas/paywalls and voices drop to ABSENT. v2 accepts
  this because it is advisory: a decayed panel is simply *less* advice, never a broken gate.
  The budget cap makes the decay **explicit and bounded** (voices ABSENT with a reason)
  rather than a silent runaway bill.
- **Cost accounting is best-effort, CLI-only** (OV-18): `tokens`/`cost_usd` nullable; no
  promise of per-run totals that include native Claude/fable.

`autoplan` at all-four can reach ~4 phases × 3 external CLIs = up to **12 external CLI calls
per run** + 4 fable subagents + the native pass per phase — which is exactly why the budget
cap and ABSENT-on-cap degradation are M1, not follow-ups.

## Config & Kill-Switches

**Correction (OV-20):** `bin/gstack-config` is **ONE GLOBAL config** (`~/.gstack/config.yaml`)
with no repo lookup, so switches are **GLOBAL**, not "per-repo" as v1 claimed. And
`plan-tune` manages **question-sensitivity only** — it does not manage voice config, so v1's
"plan-tune surfaces them" claim is **dropped**.

Typed config-key table, each key wired through `bin/gstack-config`'s
**header / DEFAULTS / normalization / validation / `list`** (mirroring the existing
`codex_reviews`/`grok_reviews` alias-normalization at lines 341/414 and the `list` output at
lines 470/486):

| Key | Type | Default | Purpose | Paid? |
|-----|------|---------|---------|-------|
| `codex_reviews` | `enabled`/`disabled` | `enabled` | existing master switch, OpenAI voice | paid |
| `grok_reviews` | `enabled`/`disabled` | `disabled` (shipped; design said `enabled`) | existing switch, xAI voice — default-off until the OS-level write-denial canary passes (M1 gate: the grok CLI sandbox did not deny writes live) | paid |
| `gemini_reviews` | `enabled`/`disabled` | `disabled` (shipped; design said `enabled`) | **NEW** switch, Google voice — default-off until live auth + write-denial are verified (M1 gate: invocation fixed but auth-blocked) | paid |
| `fable_reviews` | `enabled`/`disabled` | `enabled` | **NEW** switch, Anthropic voice — **FREE** (subagent), **not** counted against `panel_budget_usd` | **free** |
| `panel_budget_usd` | number | `1.50` | **NEW** hard per-run USD cap on external voice spend; exceed → remaining external voices ABSENT (budget-capped) | — |
| `grok_reviews_consent` | consent record | unset | **NEW** first-use per-vendor egress consent (private/client repos) | — |
| `gemini_reviews_consent` | consent record | unset | **NEW** first-use per-vendor egress consent (private/client repos) | — |

`fable` is explicitly the **free** voice; it must **not** be misclassified as a paid call
(OV-20). The existing paid-call kill-switch safety (`codex_reviews`/`grok_reviews` normalized
so a common alias cannot accidentally enable a paid call, lines 335–414) is extended to
`gemini_reviews`.

## Non-Goals

- **`autobuilder-loop` is out of scope** for the advisory layer (OV-14). Its stricter
  **union-FAIL forum** — any `[P1]` from either external model FAILs the gate
  (`autobuilder-loop/SKILL.md.tmpl` line 352) — is preserved **unchanged**. It is an
  unattended headless loop that must not hang on a human gate, so the advisory panel's
  human-gate routing is fundamentally incompatible with it. A test
  (`test/autobuilder-forum-divergence.test.ts`) **pins the divergence**: it asserts the
  autobuilder forum still uses union-FAIL and does NOT import `tallyVoices()`, so a future
  "cleanup" cannot silently swap the strict forum for the advisory tally.
- **No binding vote, no new blocking gate, no sovereignty change** on any surface.
- **`fable` stays IN** (user wants it), but honestly noted (OV-11): fable is the *sole*
  reason the primitive cannot be one self-contained script (it is a Claude model via the
  Agent tool), and it is a **correlated Anthropic voice** that adds **no cross-vendor
  diversity**. Under a binding vote this would be a reason to cut it; under an **advisory**
  panel it is harmless — it is retained as an informational voice, **counted once** against
  the `anthropic` vendor in the diversity accounting, and never inflates confidence.

## Staged Rollout

- **M1 — the advisory primitive + its safety rails + the first real surface.**
  `lib/outside-voices/registry.ts` (adapter contract incl. the four MANDATORY security
  fields), `lib/outside-voices/vote.ts` (`tallyVoices()` **+ unit tests**), `bin/gstack-panel`
  (seq-foreground, per-voice result files, `--collect`, per-voice ladder < 600s−slop,
  wall-clock budget), `bin/gstack-vote` (only tabulation path), `grok`/`gemini`/`fable`
  reviewer adapters + `gemini_reviews`/`fable_reviews` config keys + `panel_budget_usd`, the
  **Security & Threat Model** wiring (write-denial sandbox test, redaction pass, egress
  receipts, first-use consent), and wire the **shared plan-review resolver** — rename
  `generateCodexPlanReview` → `generateOutsideVoices`, repoint the three
  `{{CODEX_PLAN_REVIEW}}` placeholders — so all three plan reviews render N advisory voices
  (OV-10). Ship + confirm before touching anything else. **No external voice default-on until
  the M1 ship gate (§Security) passes.**
- **M2 — autoplan.** Replace the four hardcoded dual-voice blocks with the resolver; widen
  consensus tables to the per-voice-row layout; feed panel findings into the 6-principle
  auto-decision **as input** (not as a verdict); preserve cross-phase `carryContext` and the
  skip-list.
- **M3 — code review + cleanup + dashboard.** Wire `review`'s adversarial step and
  `design.ts` (delegate to the shared resolver, keep host guards); **delete the duplicated
  copies**; rework `generateReviewDashboard` to read the new `outside-voices` record and
  render the N-voice row (OV-15); add `grok`-as-reviewer and `gemini`-as-reviewer e2e tests
  alongside `test/codex-e2e.test.ts`.

## Testing

- **Unit — `tallyVoices()` truth table** (`test/outside-voices-vote.test.ts`): the ten rows
  in §5 (vendor-collapsed median, upper-mid tiebreak, quorum, each ordered guard exactly
  once, ran-but-unparseable = error not absent, single-vendor-anthropic, dissent surfacing).
- **Security invariants** (`test/skill-recipe-invariants.test.ts`, extending its existing grok
  gate-shape assertion): every adapter carries the four security fields; `--yolo` appears in
  **no** reviewer path; `gemini_reviews`/`fable_reviews`/`grok` gate shapes; the shared
  `OUTSIDE_VOICE_BOUNDARY` is the single source.
- **Sandbox write-denial** (`test/outside-voices-sandbox.test.ts`, EVALS-gated): each external
  CLI, under its read-only sandbox, fails to write a sentinel file. Gates default-on.
- **Egress receipt wiring** (`test/egress-receipt-wiring.test.ts`): the three external voices
  are pinned sinks with fail-closed polarity.
- **Redaction** (`test/outside-voices-redaction.test.ts`): a HIGH-tier secret in the assembled
  prompt is masked or the voice is marked ABSENT — never sent.
- **e2e (EVALS-gated, skip if CLI missing):** extend the `codex-e2e` pattern to a real
  `grok -p … --sandbox read-only` and `gemini -p … -s read-only` reviewer call path (today
  only `codex-e2e` proves a full review call; `gemini-e2e` is a smoke test; there is no
  `grok` e2e).
- **Autobuilder divergence pin** (`test/autobuilder-forum-divergence.test.ts`): the forum
  keeps union-FAIL and does not import `tallyVoices()`.
- **Generation:** `bun run skill:check` must pass (no stale `.md`) after every `.tmpl` edit.

## Acceptance Criteria & Deliverables (autobuilder contract)

The frozen milestone set for the build. Each milestone lists measurable acceptance criteria
and the **Deliverable** (the exact check that validates it). The `<!-- status: pending -->`
marker is the autobuilder selector — the loop builds the first `pending` milestone, flips it
to `complete` only when its gate is clean and its Deliverable passes.

### M1 — advisory primitive + safety rails + shared plan-review resolver
<!-- status: complete -->
- `lib/outside-voices/registry.ts` defines the voice registry; every adapter (codex, grok,
  gemini, fable) declares the four security fields (`sandbox`, `boundary`, `fences`,
  `transport`); `--yolo` appears in no reviewer path.
- `lib/outside-voices/vote.ts` implements `tallyVoices()` exactly as §5 (vendor-collapsed
  median, even-split → CONCERNS, quorum ≥2, ordered degradation guards, ran-but-unparseable =
  ERROR); `bin/gstack-vote` is the only tabulation path.
- `bin/gstack-panel` runs CLI voices sequential-foreground, each timeout-wrapped < 600s−slop,
  writes per-voice `<voice>.result.json`, supports `--collect`, enforces the per-surface
  wall-clock budget and `panel_budget_usd`.
- `bin/gstack-config` gains `gemini_reviews`, `fable_reviews` (free), `panel_budget_usd`
  (default 1.50), `grok_reviews_consent`, `gemini_reviews_consent`, each wired through
  header / DEFAULTS / normalization / validation / list; fable is not classified paid.
- Security wired: OS-level write-denial sandbox test passes for each external CLI; a
  `redact-engine` pass runs before every external invoke; each external voice is a pinned
  fail-closed sink in `test/egress-receipt-wiring.test.ts`; first-use per-vendor consent for
  grok/gemini on private repos.
- Shared plan-review resolver: `generateCodexPlanReview` renamed to `generateOutsideVoices`;
  the three `plan-{ceo,eng,devex}-review/sections/review-sections.md.tmpl` repoint
  `{{CODEX_PLAN_REVIEW}}` → `{{OUTSIDE_VOICES:surface=…}}`; renders N advisory voices
  (per-voice-row table + recommendation, non-blocking, routed to the existing human gate).
- `scripts/models.ts` and `test/helpers/pricing.ts` gain the grok row (the only missing one).

**Deliverable:** `bun test test/outside-voices-vote.test.ts test/skill-recipe-invariants.test.ts test/outside-voices-sandbox.test.ts test/egress-receipt-wiring.test.ts test/outside-voices-redaction.test.ts` green, and `bun run gen:skill-docs --host all && bun run skill:check` clean.

### M2 — autoplan integration
<!-- status: complete -->
- autoplan's four inline per-phase dual-voice blocks are replaced by
  `{{OUTSIDE_VOICES:surface=…}}`; consensus tables use the per-voice-row layout; the skip-list
  is preserved.
- Cross-phase `carryContext` is threaded so each phase-N voice gets the same frozen
  prior-phase summary the native review gets.
- Panel findings feed the 6-principle auto-decision **as input**, never as a binding verdict
  (no new gate).

**Deliverable:** `bun run gen:skill-docs --host all && bun run skill:check` clean; autoplan generation + related tests green.

### M3 — code review + design + dashboard + e2e cleanup
<!-- status: pending -->
- `review`'s adversarial step and `design.ts` delegate to the shared resolver (host
  self-exclusion generalized to drop grok on a grok host, gemini on a gemini host); the
  duplicated copies are deleted.
- `generateReviewDashboard` reads the new `outside-voices` record and renders the N-voice row
  + recommendation + summed cost.
- `test/autobuilder-forum-divergence.test.ts` pins autobuilder-loop's union-FAIL forum
  (asserts it keeps union-FAIL and never imports `tallyVoices()`); grok-as-reviewer and
  gemini-as-reviewer e2e tests are added alongside `test/codex-e2e.test.ts`.

**Deliverable:** `bun test` (unit + e2e, EVALS-gated where CLI-dependent) green; `bun run skill:check` clean; no remaining duplicated outside-voice blocks.

**Verification note (for autobuilder):** gstack is a bun/TypeScript tooling repo, not a
Dockerized web app — the loop's "functional verification" step is satisfied by the Deliverable
checks above (`bun test` + `bun run skill:check` + the new e2e tests), not a Docker bring-up.

## Consensus table (terminal-width)

The panel renders a **per-voice-row** table (a voice-per-column table wraps at five voices —
OV-24). Symbol/anchor references, not stale line numbers. Realistic five-voice example, with
gemini dropped by the budget cap:

```
Outside Voices — advisory panel (recommendation only; the user decides)
Surface: /review (diff)    Budget: $0.41 / $1.50    Quorum: 4 ready · 3 vendors
─────────────────────────────────────────────────────────────────────────────
  VOICE   VENDOR     STATUS   VERDICT    TOP FINDING (promoted)
─────────────────────────────────────────────────────────────────────────────
  codex   openai     ready    CONCERNS   P1 race in queue.ts#drain           (repro ✓)
  grok    xai        ready    CONCERNS   P1 same race — corroborates codex    (2nd voice)
  gemini  google     absent   —          budget-capped after codex+grok
  fable   anthropic  ready    PASS       no P1s; style nits only
  claude  anthropic  ready    CONCERNS   P1 unbounded retry queue.ts#retry    (quotes line)
─────────────────────────────────────────────────────────────────────────────
  RECOMMENDATION: CONCERNS   (vendor-median; anthropic collapsed to one ordinal)
  Diversity: OK (openai + xai + anthropic)     Dissent: fable(PASS) noted
  → Routed to the existing fix-first pipeline + human gate.  NON-BLOCKING.
─────────────────────────────────────────────────────────────────────────────
  Appendix (unreproduced / unlocated): 3 findings — see gstack-review-log
```

## Risks & Open Questions

- **Fork/upgrade safety.** Local fork work on `skills/port-1.68.2`; must be captured in the
  restoration map so a `reset --hard` during an upstream port does not wipe it. New files
  (`lib/outside-voices/*`, `bin/gstack-panel`, `bin/gstack-vote`, resolver) are low-conflict;
  the merge-risk surface is the shared `review-sections` templates + `autoplan/SKILL.md.tmpl`
  — keep edits minimal and resolver-delegated. **`lib/gstack-decision.ts` is deliberately NOT
  touched** (append-only memory store + fork merge-risk surface — OV-13).
- **Advisory decay is accepted, not solved.** All-four-default-on-and-paid trends toward
  codex-only as voices hit quotas; the budget cap bounds cost but not the diversity decay.
  Because it is advisory, a decayed panel is less advice, never a broken gate — but the
  `[single-vendor-anthropic]` tag and ABSENT reasons keep the decay visible.
- **Latency.** Sequential-foreground external CLIs + a subagent add wall-clock; the
  per-surface budget bounds it, and interactive plan reviews skip the panel unless asked
  (OV-22).
- **Output-validation coverage.** Datamark + schema/enum/size/location validation reduce but
  do not eliminate advice-poisoning (T2); reproduction-based ranking (§7) is the backstop —
  an injected "reply PASS" cannot promote a finding it cannot reproduce, and cannot block
  anything because nothing here blocks.

## Files Touched (map for the implementation plan)

**New:** `lib/outside-voices/registry.ts`, `lib/outside-voices/vote.ts` (`tallyVoices`),
`bin/gstack-panel`, `bin/gstack-vote`, `scripts/resolvers/outside-voices.ts`, unit +
security + sandbox + redaction + e2e + divergence tests.

**Edit:** `scripts/resolvers/index.ts` (register `{{OUTSIDE_VOICES}}`),
`scripts/resolvers/review.ts` (rename `generateCodexPlanReview` → `generateOutsideVoices`;
promote `CODEX_BOUNDARY` → shared `OUTSIDE_VOICE_BOUNDARY`; delegate `generateAdversarialStep`;
rework `generateReviewDashboard` for the N-voice row — M3),
`scripts/resolvers/design.ts` (delegate `generateDesignOutsideVoices`, keep the `host ===
'codex'` self-exclusion and generalize it to drop grok on grok host / gemini on gemini host —
OV-17), `plan-{ceo,eng,devex}-review/sections/review-sections.md.tmpl` (repoint
`{{CODEX_PLAN_REVIEW}}` → `{{OUTSIDE_VOICES:surface=…}}`), `autoplan/SKILL.md.tmpl` (M2: phase
blocks + per-voice-row tables + `carryContext`), `bin/gstack-config` (new keys
`gemini_reviews`, `fable_reviews`, `panel_budget_usd`, `grok_reviews_consent`,
`gemini_reviews_consent` — wired through header/DEFAULTS/normalization/validation/list),
`scripts/models.ts` (**add the grok row — the only one missing**),
`test/helpers/pricing.ts` (add the grok row), `test/egress-receipt-wiring.test.ts` (pin the
three external voice sinks), `test/skill-recipe-invariants.test.ts` (security-field +
gemini/fable/grok gate-shape invariants).

**NOT touched:** `lib/gstack-decision.ts` (OV-13), `plan-tune` (manages question-sensitivity
only, not voice config — OV-20).

**Regenerate:** `bun run gen:skill-docs --host all` then `bun run skill:check`.

## Revision Log (v1 → v2)

| Finding | Disposition | How v2 addresses it |
|---------|-------------|---------------------|
| **OV-1** — "majority sets the verdict" reverses user-sovereignty | **Resolved** | Authority = advisory; `tallyVoices()` emits a *recommendation* routed through the existing human gate; "majority sets the verdict" deleted; §Authority + §4 rewritten. |
| **OV-2** — untrusted diff → agentic CLIs, no sandbox/fence/transport | **Resolved** | New **Security & Threat Model** section; §1 adapter contract carries four MANDATORY invariant-tested fields (read-only sandbox, `--yolo` forbidden; shared boundary preamble; UNTRUSTED fences; file-based transport); no external voice default-on until a write-denial test passes. |
| **OV-3** — injectable vote keyed on `reproducible` no CLI emits | **Resolved** (veto portion **Moot — advisory**) | `reproducible` → `repro_command`; strict machine-readable JSON per voice; parse failure = ERROR. No auto-outvote exists because nothing is binding; `repro_command` is used only for ranking (§7). |
| **OV-4** — one enum can't serve two decision currencies | **Resolved** | Split into `planPanelAdvice()` (feeds the plan human gate) and `diffGate()` (feeds the existing fix-first `[P1]` rule), sharing only invocation; per-surface action matrix added; the "(plan reads: PROCEED\|REVISE\|STOP)" parenthetical deleted. |
| **OV-5** — `ensembleVote` unimplementable; drops "garbage = FAIL" | **Resolved** | Fully-specified `tallyVoices()`: vendor-collapsed **median** (2-2-1 and 1-1-1 → CONCERNS), numeric quorum ≥2, ordered degradation guards (each pattern once, incl. claude-errored / all-absent), ran-but-unparseable = ERROR not ABSENT, `bin/gstack-vote` the ONLY path, ten-row unit truth table. |
| **OV-6** — correlated Anthropic votes; diversity flag too late | **Resolved** | Vendor-collapsed median counts each vendor once (Claude+fable → one anthropic ordinal); `[single-vendor-anthropic]` tag; non-Anthropic dissent surfaced whenever it differs from an Anthropic-collapsed recommendation. |
| **OV-7** — wrong default polarity; no budget cap | **Downgraded** — roster locked | All-four-default **kept** (locked, advisory). Instead of default-off: `panel_budget_usd` cap added as an M1 requirement + an honest decay note; ABSENT-on-cap degradation. |
| **OV-8** — fail-closed valve is a human-gate DoS | **Moot — advisory** | No fail-closed escalation gate exists; the panel never escalates on its own, so there is no DoS. Recommendation routes through the one existing human gate. |
| **OV-9** — systematic egress, no redaction/receipt/consent | **Resolved** | Redaction pass before any external invoke (HIGH-tier → mask or ABSENT); one egress receipt per external invocation (pinned in the wiring test, fail-closed); first-use per-vendor consent for grok/gemini on private/client repos; codex unchanged. All M1. |
| **OV-10** — M1 self-contradictory ("wire ONE surface") | **Resolved** | M1 wires the **shared** plan-review resolver (rename `generateCodexPlanReview` → `generateOutsideVoices`), lighting up all three plan reviews at once; "wire one surface" corrected as impossible. |
| **OV-11** — fable drives the machinery, adds least value | **Downgraded** — fable kept | User wants fable; advisory dissolves the vote-skew risk. Fable retained, counted once against the anthropic vendor, tagged `[single-vendor-anthropic]` when no external vendor is ready; honest note that it is the sole reason the primitive isn't one script. |
| **OV-12** — concurrency/durability unspecified; 600s ceiling | **Resolved** | Sequential-foreground (matches autoplan precedent; v1's "concurrently" corrected); each voice writes its own result file; `--collect` salvage; per-voice ladder < 600s−slop or background+Monitor; hard per-surface wall-clock budget (still-running = ABSENT). |
| **OV-13** — `ensembleVote` in `lib/gstack-decision.ts` | **Resolved** | Moved to `lib/outside-voices/vote.ts` (co-located with `registry.ts`); the `lib/gstack-decision.ts` edit is removed from Files Touched. |
| **OV-14** — autobuilder's stricter union-FAIL left divergent | **Resolved** | autobuilder-loop declared an explicit **non-goal**; its union-FAIL forum preserved unchanged; a pin test asserts it keeps union-FAIL and never imports `tallyVoices()`. |
| **OV-15** — dashboard claim is false | **Resolved** | §8 corrects it: `REVIEW_DASHBOARD` keys on a fixed skill list and reads only the latest `codex-plan-review`; `source` is audit-only. Panel writes audit-only entries until the M3 dashboard rework, which is enumerated in Files Touched + M3. |
| **OV-16** — external OUTPUT crosses a trust boundary unvalidated | **Resolved** | §3 requires schema + enum + size caps + location validation + datamark before model output becomes agent-facing. |
| **OV-17** — self-exclusion not generalized; wrong id; stale inventory | **Resolved** | Per-host self-exclusion generalized (drop grok on grok host, gemini on gemini host, mirroring the codex guard); runtime id corrected to `model: fable` (+ probe/`claude-opus-4-8` fallback); inventory corrected — models.ts/pricing.ts already carry gemini (+fable in taxonomy), **only grok is missing**. |
| **OV-18** — per-voice tokens/cost promised without a contract | **Resolved** | `tokens`/`cost_usd` nullable, best-effort, CLI-only; per-run totals including native Claude/fable are no longer promised. |
| **OV-19** — "duplicated ~6 ways" inflated | **Resolved** | Core-Problem #2 + §6 rescoped: CEO/eng/devex already share one resolver; the genuine duplication is autoplan's four inline blocks + design.ts + review.ts adversarial. |
| **OV-20** — kill-switch/config claims inaccurate | **Resolved** | Switches described as **global** (one `~/.gstack/config.yaml`, no repo lookup); plan-tune claim dropped; typed config-key table wired through header/defaults/normalization/validation/list; fable classified as the **free** voice, not paid. |
| **OV-21** — cross-phase context misread; finding schema incomplete | **Resolved** | §7 distinguishes same-phase independence from cross-phase `carryContext` (preserved); panel runs before dedup/Fix-First; findings normalized into the existing review-finding contract (confidence/fingerprint/AUTO-FIX-vs-ASK). |
| **OV-22** — latency; no wall-clock budget; interactive preflights | **Resolved** | Hard per-surface wall-clock budget (still-running = ABSENT); panel skipped on interactive plan reviews unless asked; auto-runs on autoplan CEO + /review. Reconciled with all-four-default (roster ≠ force-run). |
| **OV-23** — equal-weight majority manufactures false confidence | **Resolved** | Findings ranked by independent reproduction (quotes the line / corroborated by a 2nd voice / repro_command reproduces → promoted; else appendix); seat count never promotes. |
| **OV-24** — stale line citations; N-column table unproven | **Resolved** | Stable symbol/anchor references replace line numbers; a realistic five-voice **per-voice-row** consensus mockup at terminal width is included (row layout chosen because voice-per-column wraps). |

**Summary.** v2 is anchored on **two locked decisions**: (1) **Authority = ADVISORY** — the
panel produces a recommendation plus surfaced tensions/dissents that route through the
*existing* human gate and fix-first pipeline, with no binding vote and no new blocking gate
anywhere, preserving gstack's invariant that outside voices never block and the user decides;
and (2) **Roster = all four voices (codex, grok, gemini, fable) default-on** on every review
surface *because* they are advisory, with fable kept in. Five defaults fall out of those:
**teeth = none** (advisory on all surfaces incl. pre-landing `review`); **autobuilder-loop is
out of scope** (its stricter union-FAIL forum preserved and pinned by a test);
**egress** is gated by a redaction pass + per-invocation receipts + first-use per-vendor
consent (public-on / private-consent for the new vendors); the **verdict mechanism** is a
fully-specified, unit-tested `tallyVoices()` that emits an advisory recommendation rather than
a binding state machine; and **cost** is bounded by a `panel_budget_usd` cap (default
$1.50/run; over-budget voices become ABSENT). Together these dissolve the P0 sovereignty and
DoS findings, close the P0 security holes with a dedicated threat-model section, and keep the
validated 80% — one resolver rendering N informational voices instead of the genuinely-
divergent copies.
