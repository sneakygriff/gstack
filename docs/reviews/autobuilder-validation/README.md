# Autobuilder validation: local implementation handoff

Evidence status: **implementation retained; empirical acceptance blocked**. Six scoped tickets (01-06) are done; empirical tickets 07/08 and dependent adoption ticket 09 remain blocked. This is a partial delivery of the specification, not full-spec completion or release acceptance.

Integration branch: `codex/autobuilder-validation`. Last full-suite code revision: `9a7c8a2c764f3b34034242a2dfc9862dc9cb2f6a`; tree `f04ef5a0a637f4a003b8ced0eedaec105e6fcf3e`. Specification/review base: `ce0fe916d2550b21d6eb116aee483786060f730f`. Subsequent path-test repairs are recorded in the [path and timeout follow-up](path-timeout-followup.md); the historical full-suite outcome remains bound to its original revision. The original validation snapshot preceded publication and local installation. On 23 October 2026 the user authorized a fork PR, merge and local installation despite the disclosed validation gaps. This authorization does not change any test or review verdict; publication and installed-revision confirmation are reported separately in the PR.

## Path and timeout follow-up

Path-test assumptions and repository-path launching have been repaired on the isolated branch. The [follow-up report](path-timeout-followup.md) records red/green probes, adjacent checks and remaining limits. The historical lifecycle timeout did not reproduce in isolated, concurrent or actual-runner probes; it and the complete-suite timeouts remain unresolved. No fresh full-suite acceptance or model result is claimed. [Opt-in timeout instrumentation](timeout-instrumentation.md) now retains command/hook errors before cleanup; a targeted actual-runner reproduction and negative-control check passed, so the historical cause remains unresolved.

## Delivered behavior

- Strict public focused execution validates exact selectors before launch and reconciles selected files, actual headers, complete capture, process outcome and terminal summaries. Empty, missing, failed, cancelled and incomplete runs cannot become successful coverage.
- Dependent-check preview uses existing registries, explains reasons and separates free checks from model evaluations. Unknown dependencies and changed registries block automatic dispatch. The direct/package default-root CLI and helper-plus-test selection regressions are repaired.
- Usage reporting preserves observed provider data, deduplicates events and retains unknowns. Native cost readers and the actual downstream report/comment path preserve null instead of claiming zero cost.
- Acceptance assembly checks consumed inputs, environment, runtime, retained logs and native receipts. Registered workflow/section collectors can bind a new actual run; stale, corrupt, partial, manual or unsupported reused records earn no coverage. Failed attempts remain visible. Usage never substitutes for quality.
- Subscription readiness and historical failure inventory are documented with evidence. Authentication is separate from model/tool execution, independent account pools and remaining capacity.

The native binding trusts the operator's complete declaration of consumed inputs and relevant environment; it is not a signed external witness. Requested/resolved model metadata is distinguished from unavailable provider-observed identity. These limits are explicit in the acceptance contract.

Public entry points: `bun run test:focused -- <exact files>`, `bun run validation:select -- --plan -- <changed paths>`, `bun run validation:usage`, and `bun run validation:acceptance`. See [focused validation](../../testing-focused.md), [dependent selection command](../../../scripts/validation-select.ts), [usage](../../autobuilder-usage.md), and [acceptance](../../autobuilder-acceptance.md) for actual required arguments and evidence contracts.

## Review and focused verification

The original [Standards review](review-standards.md) found one documented-standard launcher defect and no heuristic findings. The [Spec review](review-spec.md) found two P2 defects plus a partial native/usage adapter requirement; its CLI defect duplicates the Standards finding and is not a fourth independent issue. [Follow-up disposition](review-disposition.md) closes those findings and subsequent cost/selection corrections. This scoped review does not certify the absent empirical results.

All final repair checks used byte-identical pinned Bun 1.4.0, SHA-256 `539598c775882420b9d8deb7dc14d845f20f7d26f5600c50ab067dde6ac3f3bf`, with `TMPDIR=/private/tmp`. Independent verification read source/evidence rather than rerunning these checks.

| Retained focused run | Result | Boundary |
| --- | --- | --- |
| Native binding and adjacent checks | 330 pass, 0 fail, 2,388 assertions, 15 files | Actual registered callbacks and public acceptance controls; no provider calls |
| Cost-summary completeness | 31 pass, 0 fail, 148 assertions, 4 files | Public CLI across missing cost/turn metadata |
| Selection follow-up | 76 pass, 0 fail, 302 assertions, 3 files | Helper/test cochange, reader dependencies, existing blockers |
| Nullable collector and comment | 46 pass, 0 fail, 3,210 assertions, 4 files | Public report plus actual workflow shell with local gh stub; no messages |

These runs overlap and must not be summed into a unique test total. Earlier passing/failing runs and their real runtimes remain in the ticket records. Final build passed at frozen code; final credential scan found 0 HIGH, 0 MEDIUM and 21 LOW local-path warnings. No thresholds, retry counts, model floors, review gates or credit guards were weakened.

## Complete-suite evidence

Final short-path run at `9a7c8a2c`: **exit 124, incomplete** (23 October 2026, 05:51:41-06:09:08 UTC). All six parallel shards exceeded the unchanged 1,041-second wall; no complete terminal totals exist for those shards. The separate exclusive shard completed with **1 pass / 0 fail / 35 skip**, 36 cases across one file. That is the only completed-shard subtotal, not the full-suite result. Complete pass/fail/skip totals remain **unknown**. Observed incomplete-body failure markers are not substituted for counts.

Two outer cleanup warnings retain `/private/tmp/gstack-free-shard-OtE5qE` and `/private/tmp/gstack-free-shard-4BHyJP`. Recorded outer group 136 and its PID were absent after termination; that observation does not prove every possible descendant is gone. Retained state directories are left intact. See [final reconciliation](final-free-reconciliation.md) for exact evidence and limits. No third full-suite run was attempted.

The preceding frozen `f9208680` full run terminated with exit 124: five shards hit the unchanged 1,041-second wall without terminal summaries. Completed shards alone recorded 3,584 pass / 48 fail / 105 skip over 157 file executions. This is a partial subtotal; complete totals are unknown. The older complete `2fdc4698` run remains 22,326 pass / 422 fail / 410 skip across 938 files; later passing subsets do not erase it. [Historical inventory](failure-inventory.md) separates demonstrated classifications from unresolved causes.

The final run is justified by concrete subsequent native/report/selection repairs and a demonstrated launcher correction: native fixture shebangs failed when the Bun executable path contained a space and succeeded with byte-identical Bun at a short path. A controlled lifecycle case still failed at its unchanged 30-second timeout after the path correction; this prevents claiming the old suite timeouts are fixed. No blind retry or larger budget was used. Both full-run outcomes remain retained. The short checkout under `/private/tmp` also exposes test assumptions: one temporary-path check expects the checkout to be outside the temporary directory, and a capture privacy assertion matches the literal word `private` inside a legitimate path. These were retained fixture failures, subsequently reproduced and repaired in the path follow-up. The short executable path remains required; both normal and temporary checkout topologies now have focused verification. That does not repair or supersede the incomplete full-suite result.

## Selection and blocked empirical work

[Final explicit-diff preview](final-selection.json) exits 2 with blocked status. It lists 14 free check files and 242 model registrations (217 E2E, 25 judge), with 14 uncertainties: the workflow file, local ticket documents, two fixtures and changed dependency registry. These are registrations, not executed model cases. The complete free suite is a separately explicit validation action, not an automatic bypass of selector uncertainty. Prior-map review and any unmapped dependencies must be reconciled before relying on automatic selection for future acceptance.

- **07 - model behavior:** required registered evaluations have not run. The existing API judge environment is missing; CLI/runtime and isolated transport prerequisites remain unresolved. Native binding implementation does not provide model results. The earlier narrow autobuilder preview is historical; shared harness edits select broader coverage. See [evaluation status](model-evaluations.md).
- **08 - live comparisons:** six preregistered pilot rows remain unstarted. Equivalent Workflow/gate transport and verified subscription pools are missing. Grok CLI is authenticated but sandbox startup rejects the OrbStack socket layout; no Grok model/tool execution is claimed. Claude observations do not establish two independent pools; available quotas are unknown. No paid-credit override, account switch or unsandboxed fallback was used. See [provider lanes](provider-lanes.md) and [comparison protocol](live-comparison-protocol.md).
- **09 - adoption:** this partial report retains the evidence, but missing 07/08 results and incomplete/failing full validation prevent a positive adoption decision.

## Practical decision and next work

Keep the updated skill in the local fork, with continuous execution opt-in. Do not claim actual token savings, representative speed gains, independent Claude capacity or release readiness. Text-size reductions and deterministic scheduler probes are not provider benchmarks.

The next session should diagnose the retained complete-suite failures without a blanket repository cleanup; establish supported Grok sandbox/tool execution and explicit Claude account identity; reconcile final model selection and declared inputs; then run required registered evaluations through their unchanged guards. Only after those prerequisites should the frozen six-run live pilot begin. Stop and retain failed/non-equivalent rows instead of replacing them with successful samples.

Confidence is high in the inspected deterministic behavior and retained evidence boundaries, medium in the absence of additional code defects, and unavailable for comparative efficiency because no equivalent live comparison was executed. Passing registered evaluations, a complete applicable free-suite result and comparable live observations could materially change the adoption decision.

## Retained evidence and cleanup

Raw logs, receipts, source manifests, failed attempts and worker handoffs are in `/Users/stefanandrei/Skill Master/research/validation-orchestration/`. Key files: `review-fixes-native-handoff.md`, `repaired-final-run-metadata.json`, `repaired-final-build.log`, `repaired-final-credential-scan.json`, `repaired-free.log`, `repaired-free-reconciliation.json`, `final-failure-reconciliation.json`, and `short-path-preflight.json`. Retained private archives preserve worker `.context` before removal. Worker branches remain available. All seven final child logs, the main log and metadata were copied and SHA-256 verified in `repaired-free-evidence/` before validation-worktree cleanup. All implementer and validation worktrees have now been removed; their branches and evidence archives remain. The installed and integration checkouts remain. Retained browser-state directories remain separate from worktree cleanup.
