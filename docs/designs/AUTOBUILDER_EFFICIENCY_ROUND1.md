# Autobuilder efficiency, round 1

Scope: local implementation based on `ba1a3153`. No changes to review policy,
reviewer seats/model floors, retry caps, wave scheduling, merge/deploy authority,
Docker/mutation triggers, or completion criteria. Do not install until validation
requirements below are satisfied.

## What changed

- State transitions now call `bin/gstack-autobuilder-ops state` with a structured
  request. The script preserves unknown keys and resume identity, deduplicates
  decisions, merges per-unit maps, and atomically replaces the checkpoint under
  an exclusive lock. Malformed state/rosters, unsafe checkpoint files, contention
  or write failures fail closed. A leftover `.state.lock` requires operator
  investigation; the helper never guesses that a writer is dead.
- The same helper's `meter` operation owns the existing tracked/untracked
  production/test arithmetic and path exclusions. Git failures cannot become
  zero LOC. Unreadable or symlinked untracked files now fail explicitly instead
  of being hidden by the old `cat | wc` pipeline. Tracked binary files retain
  Git shortstat semantics; untracked bytes retain newline-count semantics.
- Workflow `ask()` counts logical requests and explicit UTF-16 prompt/response
  characters. Phase checkpoints store compact totals; the final result also
  groups requests by requested model. It stores no prompt/report content.
- Seat C loads a generated methodology reference and the unchanged canonical
  `review/checklist.md`. The reference extracts authoritative source blocks;
  edits to those sources flow through the existing document generator.
- Manual gate recipes moved into an on-demand section, generated on every host.
  Their policy remains inline in the entrypoint. Repeated rationalizations were
  removed; operative requirements remain in the core, milestone steps and rules.

The Workflow VM provides agents but no native filesystem/command runner. Its
Haiku relays remain: this round removes agent-authored mechanics, not agent
launches. Direct command-capable hosts can call the same helpers inside the
existing top-level command boundary. No undocumented Workflow API was added.

## Measurement contract

`measurement.version = 1` describes one unit execution/replay, not an account or
an entire run. Logical dispatches include cached Workflow replays; neither the
cache disposition nor nested provider usage is visible. `actual_tokens` and
`duration_ms` are null, never zero or an inferred bill. File reads, tool output,
schemas and nested CLI calls are excluded. Final output includes the final state
relay; checkpoint totals precede their own relay. Preserve the final output in
the run report rather than summing repeated checkpoint snapshots.

Reproduce the static/mock comparison with:

```sh
bun scripts/measure-autobuilder.ts ba1a3153
```

It uses fake agents and local Git only. It compares identical fixtures and
requires identical dispatch labels/models and terminal outcomes. Direct-read
sizes include the canonical checklist on both sides, but exclude transitive
reads. Main entrypoint size excludes conditionally loaded manual recipes.
Savings in billed tokens, quota or elapsed time require real equivalent runs;
none are claimed here. Prompt caching and extra reference reads can change the
real cost even when character counts fall.

## Requirement preservation map

| Requirement/source | Retained location/check |
| --- | --- |
| Orchestrator-only, explicit routing, compact envelopes, plan reread | Core principle, routing, Quick reference, Important Rules; removed rationalization table added no unique permissions |
| Union of kept P1 findings; invalid versus absent; critical Astra; accepted degradation | Entrypoint forum policy and unchanged Workflow gate code; divergence pins scan entrypoint plus all sections |
| Manual seat models, immutable ranges, marker, adjudication, isolated worktrees, retry/substitution rules | `sections/manual-gate.md.tmpl`, moved verbatim except focused Seat C reference |
| Engineering preferences, cognitive patterns, diagrams | Canonical `plan-eng-review/SKILL.md.tmpl` block, extracted by `scripts/resolvers/autobuilder.ts` |
| Architecture, code quality, tests, performance, shared-code rubric/test coverage | Canonical `plan-eng-review/sections/review-sections.md.tmpl`, all four sections, including their existing resolver expansions |
| Failure mode coverage and silent-failure critical gap | Canonical Failure modes block, extracted verbatim |
| Checklist availability, both passes, suppressions, enum completeness, current docs, shared-code evidence, confidence, TODOs and documentation | Canonical checklist directive and core `review/SKILL.md.tmpl` block; `/review` calibration context explicitly preserved |
| Seat C findings-only/no writes/no interactive planning | Reference preface and unchanged parent skip rules override interactive output instructions inside extracted methods |
| Missing reference is incomplete, never clean | Parent Seat C prompt and reference preface; existing completion marker checks remain |
| Docker, mutation, bounded fixes, scoped delta review, ship/CI checks | Existing Workflow functions unchanged; regression harness |
| State failures before publication block and retry once | Existing `writeState` callers and retry loop unchanged; helper failure tests |
| Accurate SHIP_METER with same thresholds/exclusions | Script tests plus existing meter failure/stop scenarios |

## Validation and rollout

Focused deterministic checks cover malformed state, lock contention, preservation
of resume/PR identifiers, literal shell quoting, Git failure, size exclusions,
untracked symlinks, metrics accounting, canonical-source extraction and host
section generation. Existing Workflow scenarios continue to enforce the gate
policy. The full free suite is the final acceptance run.

A dedicated `autobuilder-loop/SKILL.md workflow` judge is registered with its
consumed prompts and generator sources. It reads the entrypoint, both sections
and canonical checklist. The existing PR selector retains full-fallback behavior
for unknown dependencies; no evaluation gate was weakened. Paid execution needs
`ANTHROPIC_API_KEY`; a subscription CLI login does not satisfy the API judge.

Before installation: resolve any final free-suite failures, run the selected paid
checks, and trial an equivalent small unit with measurement enabled. Keep the
current install until those checks pass. Worktree rollback is simply abandoning
this branch; no production state or active install is modified by implementation.
