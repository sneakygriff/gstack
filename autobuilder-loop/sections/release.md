<!-- AUTO-GENERATED from release.md.tmpl — do not edit directly -->
<!-- Regenerate: bun run gen:skill-docs -->
<!-- PRESERVED:round1-7:BEGIN -->
**f. LOC meter + ship checkpoint (the anti-balloon gate).** <!-- retro-2026-10-19 item 6 --> Measure
everything accumulated since the last checkpoint — tracked diff PLUS brand-new untracked files (a
`git diff` against a commit cannot see them) — split into production and test LOC. Test = paths
matching `test/`, `__tests__/`, `*.test.*`, `*.spec.*`, `e2e*/`. Noise is excluded on both sides
(lockfiles, build output, committed codegen, migration snapshots, test snapshots):

```bash
# Run from the unit lane; paths and base are arguments, never shell-evaluated.
eval "$(~/.claude/skills/gstack/bin/gstack-slug)" 2>/dev/null || true
SHIP_BASE_FILE="$HOME/.gstack/projects/$SLUG/autobuilder/${BRANCH}-ship-base"
SHIP_BASE=$(cat "$SHIP_BASE_FILE" 2>/dev/null)
~/.claude/skills/gstack/bin/gstack-autobuilder-ops meter "$PWD" "$SHIP_BASE"
# Nonzero exit or SHIP_METER FAIL: STOP before another coding task; repair the meter first.
```

- **Production ≥ 2,500 — HARD STOP** (default; operator to confirm). No further coding task; the
  ship-unit is over whether or not its planned milestones are all built. **Exception:** a built,
  integrated, green, linear branch (no merge commit from the base branch after `ship_base`; the unit's
  own wave-integration merges do not count) may exceed the production cap by up to 20% and gate as ONE
  unit when you record the reason in the audit trail; a split is never automatic on a green branch.
- **Production ≥ 2,000 — WARNING.** Print `"SHIP_METER WARNING: <prod> prod LOC — approaching the
  2,500 cap."` and checkpoint after THIS milestone.
- **Test ≥ 5,000 — WARNING only**; test LOC never stops a unit.
- **Ship-unit boundary reached** (planned in step 0) — checkpoint now even if the meter is low.
  Planned boundaries are a ceiling the meter may tighten, never loosen.

The meter runs at THREE points — step 1.0 before dispatch, step b after each wave (milestones
projected > 1,000 production LOC), and here (the authoritative reading). The completion banner
reports the ACTUAL max unit size — never claim a cap the mechanism didn't enforce.

**The checkpoint itself:** everything in the increment must be gate-clean and Docker-verified — or
covered by the recorded Docker waiver (step d option B). A milestone still "built — gate pending"
gets its covering gate run NOW — **never ship ungated code** — and is then re-marked `complete`.

**Run /ship as a skip-listed dispatch.** <!-- retro-2026-10-19 item 8 --> A Haiku (max) subagent
READS `~/.claude/skills/gstack/ship/SKILL.md` from disk and executes ship for this increment (the
unit script re-dispatches a merge-conflicted prepare on Opus 5.5 itself; `shipModel` is only an
override). When the unit's gate is `CLEAN` (or `DEGRADED` with an operator-accepted record — `acceptDegraded`), its brief carries the
SKIP LIST, named by heading text, never step number — the gate is the review: skip everything from
**Pre-Landing Review** through **Fix-First and persistence** (Review Army specialists, exploratory QA,
finding dedup), **Address Greptile review comments (if PR exists)**, **Adversarial review
(always-on)**, **Outside Voices — Advisory Panel (recommendation only; the user decides)**, and replace
**Bind the reviews** with saving `gstack-wtree` (after the base merge) as `reviewed_tree`; skip the
**Verification Gate** too — the script binds `reviewed_tree` to the merged gated tree and refuses a
pushed tree that differs beyond release bookkeeping. Do only merge base, that snapshot, version bump,
CHANGELOG entry, commit, push, PR, CI bind. CHANGELOG accuracy is ONE Haiku-max fact-check, claim by claim against the code at the PR head, BEFORE the CI run, folded into the same
commit — no multi-member delta gate. A code change /ship still makes (e.g. a merge-conflict
resolution) gets the scoped delta review. **Fail closed (ship and PATCH):** a delta review, fact-check,
file inventory or push whose result is missing, incomplete or not an explicit PASS blocks publication —
never a pass, never a `[P1]`; an incomplete one re-runs once, then the unit is `BLOCKED` with the
reason. Prepare returns `reviewed_tree` (missing → `BLOCKED`); publish returns `PUBLISHED | BLOCKED`,
and only `PUBLISHED` (pushed, at the guarded head) counts as published. The /ship checkpoint is part of THIS loop's contract — an
operational step, not one of the human-owned business skills.

**After /ship returns, resolve the PR before building on top of it.** /ship updates the SAME PR on
re-invocation — stacking N checkpoints on one branch makes the final PR the full-run diff again. With
**merge-on-green = yes**, wait for green CI and squash-merge it yourself (no question). Otherwise
AskUserQuestion ONCE per checkpoint (unattended: queued — merging is a one-way door):
- **A) Land it now (recommended)** — the user merges (or /land-and-deploy runs); the next unit gets
  its own clean PR, review scope, and version entry.
- **B) Stack onto the same PR** — legal, but the cap then applies per-checkpoint, NOT to the final PR.
Then reset the meter base ATOMICALLY — capture first, write only on success:
`_NB=$(git rev-parse HEAD) && printf '%s\n' "$_NB" > "$SHIP_BASE_FILE"` — and append an audit-trail
row (`ship-checkpoint N: <prod>+<test> LOC, <milestones>, <PR/commit ref>, <landed|stacked>, base
<old>-><new>`) BEFORE building anything on the new unit. If the unit was LANDED, first re-sync the
working branch onto the updated remote base (a subagent fetches and rebases/re-branches, and verifies
the new `SHIP_BASE` is an ancestor of HEAD) — a stale branch updates a closed PR and meters against
the wrong history.

**g. Report + state.** Emit a one-line milestone summary (what shipped, gate status, Docker status,
`SHIP_METER: <prod> prod + <test> test`) and rewrite `state.json` (unit, flow, phase, PR, lane head,
ship base, open decisions). <!-- retro-2026-10-19 item 11 --> Continue to the next milestone.
<!-- PRESERVED:round1-7:END -->

<!-- PRESERVED:round1-8:BEGIN -->
### 2. Repeat

Loop steps 1.0–1g until the plan is COMPLETE: every milestone built, locally Docker-verified
functional, review-gated clean over the frozen milestone set, and **every ship-unit
checkpointed through /ship** — completed work that never hit a checkpoint is unshipped risk,
not progress. A milestone left "built — gate pending" is NOT complete.

**Round cap.** <!-- retro-2026-10-19 item 1 --> <!-- retro-2026-10-19 item 4 --> A gate that is not
`CLEAN` after the policy packet's max full rounds (default 3; one automatic 4th when round 3 found a
NEW `[P1]` whose fix is in scope) → ask the operator (unattended: auto-decide the recommendation unless
it is a one-way door), never spin. INVALID evidence is resolved first (that seat re-run clean at the
same `REVIEWED_SHA`): only then are the round-cap question, `shipOpenP1` and a `DEGRADED` acceptance
reachable. A stop caused by a limit is a limit stop (Resume paths), never a round-cap stop.

**Hardening batch.** <!-- v1.8 decision D-E --> Gate-born follow-ups (deferred P2s, milestone-gate
findings, ship-step discoveries) append to `$RUN_DIR/hardening.json` (`{id, source_unit, finding,
severity, files, owner_tier}`). ONE `HARDEN-<milestone>` unit per milestone runs after its planned
units, sized by the same rules (usually LITE) — never one unit per item. Exception: a kept `[P1]`
outside any open unit that is live on production gets its own FULL unit at once, announced.

---
<!-- PRESERVED:round1-8:END -->

<!-- PRESERVED:round1-9:BEGIN -->
## Completion & hand-off

When the whole plan is done + Docker-verified + review-clean + every ship-unit checkpointed:
STOP the loop. Delete the meter base file (`rm -f "$SHIP_BASE_FILE"`), ARCHIVE `$RUN_DIR/state.json` to
`state.final.json` (`mv`; never delete — PATCH needs its `prs` records while a PR stays open)
<!-- retro-2026-10-19 item 11 -->, and stop the step-0 `caffeinate` and Docker watchdog. Present a
concise completion report (fixed-vocabulary verdict + boxed summary), then write the machine-readable
artifact and suggest — do NOT run — the business skills.

```
╔══════════════════════════════════════════════════════════════╗
║  AUTOBUILDER-LOOP — COMPLETE                                  ║
╠══════════════════════════════════════════════════════════════╣
║  Milestones:   N/N built                                     ║
║  Ship units:   K/K via /ship — max unit <P> prod LOC (cap 2.5k)║
║  Review gate:  CLEAN | DEGRADED (<k>/N gates missing a seat) ║
║                — Seat C + Seat X <only the seats PRESENT;    ║
║                never list an ABSENT seat as if it reviewed>  ║
║  Docker:       VERIFIED FUNCTIONAL (port PORT, 0 console err) ║
║  Residual risk: <one line, or "none">                        ║
╚══════════════════════════════════════════════════════════════╝
```

Verdict is one of `COMPLETE_VERIFIED` / `COMPLETE_UNVERIFIED` / `BLOCKED`:

- `COMPLETE_VERIFIED` — every milestone gated `CLEAN` and Docker-verified functional, AND every
  ship-unit checkpointed through /ship. ILLEGAL if ANY gate was `DEGRADED` — such a run ends
  `COMPLETE_UNVERIFIED`.
- `COMPLETE_UNVERIFIED` — legal ONLY with (a) a recorded user Docker-verify waiver (step d,
  option B) captured in the audit trail (`waived_by_user`, timestamp, reason, residual risk), or
  (b) operator-accepted `DEGRADED` gates recorded in the audit trail — the verdict names the reason
  (`forum degraded: <gates>`) and the Completion Status is `DONE_WITH_CONCERNS`.
- `BLOCKED` — a task or gate could not be driven clean. It MUST list any milestones still marked
  "built — gate pending" and, when a limit caused it, name the limit's class and provider
  (`quota|throttle|auth|timeout|error`) and its reset time if known. <!-- retro-2026-10-19 item 5 -->

**Then SUGGEST (never auto-run) the human-owned business/decision skills** — these are the
user's calls, not the loop's:

- `/design-review` — visual + UX audit of the live, running result.
- `/plan-ceo-review` — strategy / scope / ambition, and positioning of the result.
- `/plan-design-review` — as relevant.

If the user intends a next plan iteration, `/office-hours` and `/autoplan` are theirs to run as
inputs to that next plan — this loop never invokes them.

State plainly: "These are business decisions you own. Run them when you're ready — I have
not run them." Finish with a Completion Status (`DONE` / `DONE_WITH_CONCERNS` / `BLOCKED` /
`NEEDS_CONTEXT`).

---
<!-- PRESERVED:round1-9:END -->
