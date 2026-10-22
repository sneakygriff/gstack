# Review disposition - improvements through ranked trim 4

Experimental branch: `codex/autobuilder-efficiency-round1`. No active installation or gate-policy change.

## Original Fable/Grok findings

| Finding | Disposition | Evidence |
|---|---|---|
| F1 helper startup isolation | Fixed in `9b8f68ba` | Real preload positive control and isolated launcher regressions in `test/autobuilder-launcher.test.ts` |
| F2 erased diagnostics | Fixed in `9b8f68ba` | Allowlisted stderr reasons, preserved stdout/exit contracts, lock recovery guidance |
| F3 nonregular untracked files | Deliberately fail closed | Returning a zero count would hide unknown size. Failure reasons now identify the problem. |
| F4 L2 missing-reference conflict | Fixed in `9b8f68ba` | Core and L2 instructions both require REVIEW_INCOMPLETE; actual workflow harness exercises adjudication |
| F5 missing absolute-path validation | Not confirmed | `runUnit()` already checks required paths with SAFE_PATH before work. No redundant second validation was retained. |
| F6 cache coupling | Open hypothesis | Workflow cache-key behavior was not observed. Counters describe logical calls and characters, not billed tokens. |
| F7 telemetry caveats | Documented limitations | Serialized UTF-16 characters include punctuation and measurement overhead; unknown token/duration fields remain unknown. |
| G1 obsolete inline meter permission | Fixed | Contracts authorize meter arithmetic only through the helper. |
| G2 interactive source language | Existing explicit review override retained | The reference forbids user questions/writes and requires findings-only output. Model-quality evaluation remains separate. |
| Canonical extraction ambiguity | Hardened | Missing or duplicate markers fail generation; a negative-control test covers both. |

## New Fable walkthrough

The authenticated interactive Claude Max session used observed model `claude-fable-5-1`. Its [full response](fable-walkthrough.md) and [metadata](fable-metadata.json) are retained. It used Read/Grep/Glob only. It did not run tests or execute the skill. This is advisory inspection, not a passed release gate.

All five walkthrough scenarios followed the controlling policy: dependencies wait for successful integration; unknown dispatch remains uncertain; L2 cannot replace missing references with memory; P1 union and Seat X requirements remain; BUILT and the size stop do not imply completed review.

| New finding | Adjudication and repair |
|---|---|
| D1 unit base used for ship meter | Confirmed and fixed. Contract requires separate `base` and `shipBase`, verifies ancestry, refuses a new unit at 2,000 unshipped production LOC, and stops admission at 2,500 across the ship range. A real-Git test starts with 1,900 prior LOC and adds 600; the result is 2,500/BLOCKED, not 600. The existing Workflow meter also uses its base argument, so handoff explicitly supplies shipBase and all approved scope/owner evidence for that range. |
| D2 bind versus long-held integration lock | Instruction gap confirmed. The host protocol now serializes helper calls, binds an entire admitted batch before waiting, and keeps only model workers concurrent. No automatic lock deletion or new retry allowance was added. `status` is read-only and was already unlocked. |
| D3 long helper versus foreground timeout; cancellation marker | Launch risk plausible, not reproduced as a real host outage. Each admission now exposes a conservative completion deadline; instructions require an owned background process and terminal result. Cancellation retains an `integrating` marker and its base/receipt identity. Regression tests cover deadline calculation and preservation after a failed check. |

Additional local inspection found that prebuilt Workflow derives owners and tiers from `waves`, not a separate task-ID field. Handoff instructions now require that metadata and the existing critical gate class for T3/FINAL. Missing prior scope or incompatible brief paths blocks handoff. No Workflow gate implementation was changed in this iteration.

Remaining limits: the queue is an opt-in host adapter, not a new native Workflow API. Original Workflow relays remain. Recovery from an ambiguous integration is manual and preserves evidence; CANCELLING is not a terminal-process acknowledgement. Full representative provider benchmarks and the selected paid judges are still required before adoption.

## Full-suite packaging repairs

The first full run found that moving the generic preamble also stranded the mandatory AskUserQuestion format in the setup reference. Existing `test/auq-format-always-loaded.test.ts` caught the regression; it was not weakened. The canonical generator now emits that unchanged block in the root, and the startup resolver removes exactly that same block from the setup reference. The new router budget excludes only this byte-checked mandatory block; total entry size is reported honestly as 3,137 words, not 1,463.

The canonical CARVE_GUARDS registry was missing autobuilder's section manifest. All nine sections are now registered, with static invariants and a genuine periodic Read-observation wrapper. Dependency closure and process-budget checks cover the new wrapper. The wrapper itself was not run against a model because the paid evaluation environment is unavailable.

The source stayed fixed during the first full run. Repairs were made only after it exited; the failed run is retained separately. No blanket claim is made that its other failures predate this branch.
