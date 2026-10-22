---
name: autobuilder-loop
preamble-tier: 3
version: 1.9.0
description: Use when asked to "autobuilder", "build loop", "auto-build", "keep building automatically", "drive the plan to completion", or "run the build loop" on an already-approved plan, spec, or backlog. (gstack)
triggers:
  - autobuilder loop
  - automatic build loop
  - auto build pipeline
  - drive plan to completion
allowed-tools:
  - Agent
  - Bash
  - AskUserQuestion
  - Workflow
---
<!-- AUTO-GENERATED from SKILL.md.tmpl — do not edit directly -->
<!-- Regenerate: bun run gen:skill-docs -->


## When to invoke this skill

Proactively suggest when the user has an approved plan (TODOS.md, spec, or
plan doc) and wants it built to completion unattended rather than driving
each milestone by hand.

Voice triggers (speech-to-text aliases): "auto builder", "build loop", "auto build loop".

# /autobuilder-loop - approved plan to verified checkpoints

Use this loop for an already-approved plan, spec or backlog. The plan on disk is the
contract: freeze its milestone set, re-read the next milestone before each iteration,
and keep discoveries in the follow-up ledger. If scope is not approved, suggest
`/autoplan` and stop. Planning and business skills remain user-owned.

You orchestrate decisions, dispatch, evidence and checkpoints. Implementers own source
reads/edits, diagnosis and conflict resolution. Keep their briefs and reports on disk;
receive compact envelopes with status, immutable commit, evidence paths and blockers.
The host may run the declared deterministic helpers directly, returning structured
results. Model judgment still follows the existing routing and review contracts.

Before the first action of a new or resumed run, load run setup. Before any dispatch,
load contracts. These references contain the unchanged startup, account probing,
model floors, authority and failure rules. Read each applicable reference in full;
missing instructions mean BLOCKED. Other references load at their named stage.

## Section index — Read each section when its situation applies

Read sections in full when directed; do not work from memory.

| When | Read this section |
|------|-------------------|
| executing a gate manually without Workflow, or diagnosing gate evidence | `sections/manual-gate.md` relative to the installed `autobuilder-loop`/`gstack-autobuilder-loop` SKILL.md directory |
| Seat C reviews an immutable range (reviewer reads this reference) | `sections/seat-c-review.md` relative to the installed `autobuilder-loop`/`gstack-autobuilder-loop` SKILL.md directory |
| starting or resuming a run, before any repository or provider action | `sections/run-setup.md` relative to the installed `autobuilder-loop`/`gstack-autobuilder-loop` SKILL.md directory |
| classifying or dispatching work, selecting a model or resolving an authority question | `sections/contracts.md` relative to the installed `autobuilder-loop`/`gstack-autobuilder-loop` SKILL.md directory |
| resolving the next milestone or building with the static-wave fallback | `sections/build.md` relative to the installed `autobuilder-loop`/`gstack-autobuilder-loop` SKILL.md directory |
| verifying a completed milestone, including Docker, mutation and either review seat | `sections/gate.md` relative to the installed `autobuilder-loop`/`gstack-autobuilder-loop` SKILL.md directory |
| checkpointing, merging, repeating or declaring the whole plan complete | `sections/release.md` relative to the installed `autobuilder-loop`/`gstack-autobuilder-loop` SKILL.md directory |
| launching or resuming Workflow, using PATCH, or diagnosing gate evidence | `sections/workflow-reference.md` relative to the installed `autobuilder-loop`/`gstack-autobuilder-loop` SKILL.md directory |
| using the experimental continuous queue or shared exploration, including recovery and cancellation | `sections/continuous-queue.md` relative to the installed `autobuilder-loop`/`gstack-autobuilder-loop` SKILL.md directory |

## Execution

1. **Initialize or recover.** > **STOP.** Before starting or resuming a run, before any repository or provider action, Read `sections/run-setup.md` relative to the installed `autobuilder-loop`/`gstack-autobuilder-loop` SKILL.md directory in full and follow it.
> Use this host's installed path, never the product working directory or another host's assets.
> Missing or unreadable section: BLOCKED. Never infer gate instructions from memory.
   Resolve absolute run/repository/lane paths, approved policy and immutable ship base.
   Preserve resume identity, PR mappings, lane health and evidence. Two configuration
   folders do not establish separate subscription quotas; deduplicate by authenticated
   identity. A missing identity or usage value is unknown, not available capacity.
2. **Route.** > **STOP.** Before classifying or dispatching work, selecting a model or resolving an authority question, Read `sections/contracts.md` relative to the installed `autobuilder-loop`/`gstack-autobuilder-loop` SKILL.md directory in full and follow it.
> Use this host's installed path, never the product working directory or another host's assets.
> Missing or unreadable section: BLOCKED. Never infer gate instructions from memory.
   Classify every dispatch as R or T0-T3 and name its lane/model/effort explicitly.
   Preserve model floors, substitutions, credit guards and reserved review capacity.
   Fable headless is not a subscription fallback. Never enable credit billing to make
   an unavailable lane appear available. Code implementation is not review evidence.
3. **Resolve and build one unit.** > **STOP.** Before resolving the next milestone or building with the static-wave fallback, Read `sections/build.md` relative to the installed `autobuilder-loop`/`gstack-autobuilder-loop` SKILL.md directory in full and follow it.
> Use this host's installed path, never the product working directory or another host's assets.
> Missing or unreadable section: BLOCKED. Never infer gate instructions from memory.
   Keep narrow verifiable slices, explicit dependencies, declared writes and named
   checks. Reuse approved public test seams; a materially different seam needs a decision.
   Static waves remain the default fallback. The experimental host queue is opt-in:
   load `continuous-queue` before using it. It adds private worktrees for every worker,
   persistent admission and a single integrator. Shared exploration is reusable only
   while its declared inputs match the task's starting and integration revisions.
4. **Integrate and gate.** > **STOP.** Before verifying a completed milestone, including Docker, mutation and either review seat, Read `sections/gate.md` relative to the installed `autobuilder-loop`/`gstack-autobuilder-loop` SKILL.md directory in full and follow it.
> Use this host's installed path, never the product working directory or another host's assets.
> Missing or unreadable section: BLOCKED. Never infer gate instructions from memory.
   For the original Workflow path, or after a host queue finishes building, load the
   Workflow reference. A queue result of BUILT is not reviewed, shippable or complete.
   Use the existing `prebuilt` path for queue-built code; retain integration verification,
   full/targeted checks, meter, both seats, Docker/mutation triggers, bounded fixes and
   immutable review endpoints. Freeze further unit writes while review is active.
5. **Checkpoint and repeat.** > **STOP.** Before checkpointing, merging, repeating or declaring the whole plan complete, Read `sections/release.md` relative to the installed `autobuilder-loop`/`gstack-autobuilder-loop` SKILL.md directory in full and follow it.
> Use this host's installed path, never the product working directory or another host's assets.
> Missing or unreadable section: BLOCKED. Never infer gate instructions from memory.
   Run the existing skip-listed `/ship` only after the required gate. Merge/deploy
   authority remains the approved policy. Re-read the plan for the next unit; do not
   admit work across an unresolved release boundary. Stop only at the existing completion
   criteria and report incomplete or waived evidence explicitly.

## Always-visible gate and authority contract

- Gate rule: a kept `[P1]` from EITHER model FAILs the gate. Union of kept findings, not consensus.
- INVALID never counts as ABSENT. Missing/unreadable rubric or checklist means
  REVIEW_INCOMPLETE on both L1 and L2; remembered methodology cannot replace a read.
- An absent seat makes the gate DEGRADED, never CLEAN. Retry/classify according to
  the existing contract. Critical/final/T3 work requires Astra: there is no Seat X waiver.
  Ordinary-gate Sol substitution remains limited to the existing timeout/error cases.
- P2 fix-now gets one owner-routed pass and scoped delta review. Preserve full-round
  caps and invalidation rules; limit failures do not count as negative code reviews.
- Preserve named acceptance checks and scoped Docker/mutation verification. Missing
  output, a dead server or red tests cannot establish completion. Record explicit waivers.
- Preserve ship sizing: warn at 2,000 production LOC, stop admission at 2,500, and
  keep the existing green-linear 3,000 maximum exception at integration. Test LOC
  warns at 5,000. Queue completion does not grant an exception or publication authority.
- Keep state atomic and fail closed. A held lock requires inspecting the writer and
  pending checkpoint; never delete it automatically or enlarge retry budgets.
- Secrets, paths, raw logs and provider transcripts stay out of compact reports.
  Keep source-bound evidence files and disclose what was not checked.

## Operations and measurement

Invoke `gstack-autobuilder-ops` as an executable, never `bun <launcher>`: the launcher
isolates Bun configuration and environment from unreviewed repositories. `state` accepts
one JSON request; `meter` accepts an absolute lane and ship base. The host queue and
exploration commands also accept explicit JSON. No agent reconstructs their algorithms.
Workflow itself has no native filesystem bridge, so its existing thin relays remain.
The host queue calls helpers directly instead of adding bookkeeping agents.

Workflow counters describe logical dispatches and explicit UTF-16 prompt/response
characters, including replay and measurement overhead. They exclude loaded references,
schemas, tool output and nested CLI usage. Tokens, cache disposition and duration remain
unknown unless observed. Preserve the final result, which includes the final checkpoint
relay; do not sum repeated checkpoints. Compare equivalent tasks and gate outcomes.
A shorter entrypoint is a packaging measurement, not a billing or quality result.

Before executing a gate manually without Workflow, or diagnosing gate evidence,
read `sections/manual-gate.md`. Seat C reads `sections/seat-c-review.md` plus the
canonical checklist. Before launching/resuming Workflow or PATCH, read
`sections/workflow-reference.md`. Missing required assets are BLOCKED.
