# 01: Strict focused test execution

**What to build:** Run an explicit selection through the existing supervised free runner and certify only the files actually executed.

**Blocked by:** None (can start immediately)

**Status:** done - scoped implementation and review fixes verified; adoption remains blocked

- [x] Reject nonexistent or invalid selectors before any test child starts; exact paths, spaces, duplicates and empty selection have explicit behavior.
- [x] Expose a side-effect-free plan and a structured receipt through the public command.
- [x] Reconcile expected and observed files, terminal summary, capture integrity and real exit status; incomplete evidence cannot pass.
- [x] Retain diagnostics for failures, module-load errors, timeouts and cancellation; use existing supervision and log ownership.
- [x] Demonstrate red then green at the approved public command seam using isolated fixtures.

## Completion evidence

- Implementation `54cfc8da`, worker integration `14f35333bc75edf022141570aec9452a56422c3a`, merged with `--no-ff` at `29d7cec5c868c0ad91a6f8a1af2633b2f1fd0452`.
- Public command: `bun run scripts/test-focused.ts`; contract: `docs/testing-focused.md`. Fourteen isolated public-command cases cover strict selection, plan/no-work, execution, missing/unexpected headers, incomplete summary/capture, failures, timeout/cancellation, changed inputs and skips. Worker handoff records sequential red/green evidence for selection, planning, execution, mutation and skip controls.
- Final retained focused check: Bun 1.4.0, 58 pass / 0 fail / 0 skip across five files, complete capture and observed headers, no cleanup error. Files: `test/test-focused.test.ts`, `test/test-free-shards-capture.test.ts`, `test/test-free-shards-sandbox-knobs.test.ts`, `test/strict-output-capture.test.ts`, `test/spawnsync-timeout-tripwire.test.ts`. Receipt and logs: `/Users/stefanandrei/Skill Master/research/validation-orchestration/01-final-tests{.json,.log,-full.log}`.
- The final check ran with implementation bytes uncommitted atop `8fb81481`; its receipt accurately records that HEAD. Those bytes were committed in `54cfc8da`; subsequent worker/integration merges did not change the consumed implementation. This is reused focused evidence, not a fresh final integration run or dependency-closure attestation.
- Earlier adjacent batch retained 141 pass / 3 fail / 5 skip. The exact three owned-browser-settlement cases (`cancel-force`, `full-state-mix`, `replaced-pid`) also failed on untouched baseline `8fb81481` with the same assertions: 0 pass / 3 fail / 89 filtered out. Retained baseline log: `/Users/stefanandrei/Skill Master/research/validation-orchestration/01-baseline.log`. This establishes only those failures predate ticket 01; their root causes remain unresolved and they remain acceptance blockers.
- Merger reviewed the five-file scope and retained evidence, merged cleanly, and passed the whitespace check. No full suite, provider call, package edit, installed-skill change or review-gate change was performed for this merge.

Historical review reopening is resolved by the repairs below. Original passing and failing checks remain retained; this ticket closure does not certify full-suite or empirical adoption acceptance.

## Review repair closure

Public default-root direct and package invocations repaired at `5caba140`, with 18 passing focused checks including the subprocess tripwire. Integration includes this repair at `9a7c8a2c`. The two-axis review independently confirmed closure. Original owned-browser failures remain unresolved and are not removed from acceptance.

Final code revision: `9a7c8a2c764f3b34034242a2dfc9862dc9cb2f6a`. See [adoption evidence](../../../docs/reviews/autobuilder-validation/README.md) for full-suite outcome, remaining blockers and retained raw evidence.
