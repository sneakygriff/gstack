# Autobuilder: trustworthy validation and measured adoption

Status: `ready-for-agent` (local specification).
Testing boundaries: explicitly confirmed by the user on 23 October 2026.
Destination: local fork, branch `codex/autobuilder-efficiency-round1`.
Scope: remaining validation and retrospective improvements after ranked trims 1-4.

## Problem Statement

The operator wants lower token use, effective use of existing subscriptions, and faster parallel implementation without weakening review gates. The isolated autobuilder branch now implements deterministic helpers, staged instructions, shared exploration and an optional continuous queue. Those changes are not yet supported by enough evidence to adopt the updated skill confidently.

The latest complete free run reported 22,326 passes, 422 failures and 410 skips. Its seven autobuilder test files passed all 353 tests, but that subset is not release acceptance. A focused invocation previously named two nonexistent test files; Bun ignored them and passed the remaining file. Existing instruction-format and section-registration guards also ran too late in local validation. These incidents show that a successful command does not necessarily prove the intended coverage.

Text size and scripted scheduling results are available. Actual token savings, representative implementation speed and two independent Claude subscription pools remain unverified. The operator needs reliable execution evidence and a clear adoption decision rather than another headline reduction in entrypoint size.

## Solution

Extend the existing validation system so local focused runs validate their selection, include relevant dependent checks, and report what actually executed. Produce a revision-bound acceptance record that preserves failures and incomplete coverage. Add provider-observed usage evidence and controlled live comparisons before recommending adoption.

Deliver in four verifiable slices: strict focused execution; dependent-check selection; usage and subscription evidence; acceptance reconciliation and representative comparisons. Keep the installed skill unchanged and continuous execution opt-in until a separate adoption decision. These slices extend the work already completed through ranked trim 4; they do not introduce cheaper review profiles from ranked trim 5.

## User Stories

1. As an operator, I want a missing explicit test file rejected before execution, so that a partial run cannot look complete.
2. As an operator, I want exact test selectors, so that similarly named files do not expand coverage unexpectedly.
3. As an operator, I want selected files reconciled with executed files, so that a zero exit code alone cannot certify coverage.
4. As an operator, I want an empty selection reported explicitly, so that no-work is not presented as successful validation.
5. As an operator, I want a selection preview without process launches, so that I can inspect scope without spending resources.
6. As an operator, I want the real exit status preserved through log capture, so that logging cannot conceal a failure.
7. As an operator, I want timeout, cancellation and incomplete capture distinguished, so that each receives the right recovery action.
8. As an operator, I want raw evidence retained after temporary fixtures are cleaned, so that failures remain diagnosable.
9. As a skill maintainer, I want structural instruction changes to select their dependent checks, so that packaging defects surface before expensive evaluation.
10. As a skill maintainer, I want selection reasons from the existing registries, so that coverage can be explained without maintaining a competing map.
11. As a skill maintainer, I want changed templates and references covered together, so that generated output stays aligned with its source.
12. As an operator, I want free and API-backed checks listed separately, so that previewing or running free checks cannot trigger paid work.
13. As an operator, I want unavailable evaluations recorded as unavailable, so that missing credentials never become a pass or an automatic billing override.
14. As an operator, I want results tied to consumed source and instruction versions, so that unrelated documentation changes do not force unnecessary repeats.
15. As an operator, I want reused evidence visibly attributed to its original run, so that reuse cannot look like a fresh execution.
16. As an operator, I want observed token, cache, retry and latency data by phase and role, so that optimization targets actual overhead.
17. As an operator, I want missing usage fields preserved as unknown, so that unavailable measurements do not become invented savings.
18. As an operator, I want repeated provider events deduplicated, so that usage totals are not inflated.
19. As an operator, I want effective account identity verified for each configured lane, so that aliases are not budgeted as independent subscriptions.
20. As an operator, I want authentication and usable execution transport distinguished, so that a working web session does not imply a working CLI sandbox.
21. As an operator, I want representative comparisons with equivalent tasks and review requirements, so that time gains are not purchased through weaker acceptance.
22. As an operator, I want model calls separated from helper operations, so that scripted scheduling is not mistaken for a provider benchmark.
23. As an operator, I want each existing failure classified with evidence, so that speculative attribution does not hide regressions.
24. As an operator, I want passed, failed, skipped, cancelled and unexecuted coverage separated, so that remaining adoption blockers are immediately visible.
25. As an operator, I want experimental changes retained in the isolated fork, so that validation does not silently replace the installed skill.
26. As an operator, I want current review gates, retry limits and credit guards preserved, so that efficiency work retains the existing quality policy.

## Implementation Decisions

- Extend the existing free-runner planning, exact-selector, process-supervision and receipt-verification mechanisms. Expose strict focused execution through the existing runner surface or a thin adapter; do not build a competing runner.
- Validate explicit file selections before any test child starts. Resolve exact paths, handle duplicate inputs deterministically, reject missing or invalid inputs, and report the resulting plan. An empty plan is an explicit no-work result with no coverage credit.
- Execution succeeds only when process outcome, complete capture and observed file coverage agree with the plan. Preserve failures, module-load errors, incomplete summaries and unattributed errors. A mismatched or incomplete receipt cannot certify a pass.
- Build dependent-check selection from the current source-dependency and section registries. Cover generated-content freshness, always-loaded contracts, section registration, context/parity budgets and affected supervision checks. Add only missing relationships; do not duplicate existing CI protections as new policies.
- Explain why each check was selected. Planning and listing remain read-only and launch no workers, monitors, providers or tests. An uncertain dependency analysis must remain visible and must not silently omit coverage or launch a broad paid run.
- Keep free execution and API-backed evaluation distinct. Use existing prerequisites and billing guards. Interactive subscription reviews remain advisory evidence and do not replace the registered evaluation harness.
- Extend existing measurement records with run/attempt identity, phase, role, source and instruction fingerprints, observed provider/model identity, transport, duration and available usage fields. Deduplicate provider events using their stable identities. Preserve original evidence and distinguish observed fields from estimates.
- Effective account verification occurs outside skill prose. Store only the minimum non-secret identity evidence needed to detect shared pools. Authentication, transport capability and quota observations have separate states; do not infer remaining quota from successful authentication.
- Assemble the acceptance manifest from existing plans, receipts, logs and measurements. Bind every outcome to its consumed inputs and relevant environment. Reuse a passing result only when that evidence remains applicable, identifying its original run rather than relabeling it as fresh.
- Reconcile the complete free-suite total with named failures and unattributed or module-load failures. Classify demonstrated product defects, test expectations, fixtures and environment problems separately. Preserve unresolved causes as unknown. Proving a failure predates this branch requires comparison evidence.
- Prefer narrow repairs and focused rechecks. Broad repairs unrelated to this work are recorded for separate scope; do not turn this specification into an unbounded repository cleanup. Freeze final inputs before required acceptance runs and preserve earlier failed outcomes.
- Use repeated equivalent implementation units to compare the baseline/static approach, updated packaging and executor with static scheduling, and continuous scheduling. Preserve comparable starting trees, acceptance criteria, model assignments, review gates and concurrency limits; record unavoidable differences and rotate run order where feasible.
- Compare quality and completion alongside tokens, caching, retries and wall time. Report subscription usage separately from API charges. No numerical savings target or statistical confidence threshold has been agreed; present observations and uncertainty for the adoption decision.
- Preserve private worker worktrees, one integration writer, dependency and resource reservations, immutable review checkpoints, fail-closed recovery, current model floors, retries and credit guards. Queue BUILT remains distinct from passing the existing review and release gates.

## Testing Decisions

The confirmed primary seam is the public validation command: supply a selection or source change and observe the plan, child execution, exit status, retained logs and acceptance receipt. This is the highest practical boundary for the deterministic work. Reuse the existing model-evaluation boundary for instruction behavior; command-level tests cannot prove that a model reads required sections or follows the skill. The user explicitly confirmed both boundaries.

- Test observable behavior rather than private helpers, prose layout or implementation structure. Use disposable repositories and isolated child processes, following the existing free-runner, capture-integrity and real-Git queue fixtures.
- Reproduce the actual selection incident with one valid and one nonexistent test. The command must reject it before any test side effect occurs. Also cover exact-name collisions, spaces in paths, duplicate selections and an explicitly empty plan.
- Exercise complete execution, missing or unexpected executed files, missing terminal summaries, capture loss, nonzero exits, module-load failures, timeout and cancellation. Preserve the original outcome and diagnostic artifacts; never infer coverage from a green exit alone.
- Preview changes to templates, section manifests and shared contracts. Verify the required dependent checks appear with reasons and the preview launches nothing. Include controls showing that unrelated changes do not select unnecessary model work.
- Test evidence assembly through the same public command with controlled receipts and provider events. Missing usage remains unknown; duplicate events count once; stale input fingerprints invalidate applicability; valid reused evidence retains provenance.
- Reconcile historical retained results without changing their totals. In particular, the later 50-test passing run must remain separate from the earlier complete run's 422 failures.
- Run the already registered role/workflow judges and periodic section-read probe when their required environment is available. Observe actual public tool events and behavior, not a model's unsupported assertion that it read a section. Retain unavailable evaluations as adoption blockers.
- Run representative live comparisons only after the deterministic selection and evidence controls pass. Scripted workers validate scheduling mechanics; live equivalent units are required for claims about tokens, subscription use, latency and implementation quality.

## Out of Scope

- Reimplementing completed ranked trims 1-4 or already resolved Fable/Grok findings.
- Ranked trim 5: cheaper reviewers, reduced review coverage, lower model floors or different gate policy.
- Replacing the test framework, adding a separate orchestration platform, or introducing a new provider-routing service.
- Automatic purchases, credit overrides, account switching or assumptions of independent subscription capacity.
- Silent retries, weakened assertions, larger budgets or arithmetic removal of failures to obtain a green aggregate.
- Blanket repair of unrelated repository failures without demonstrated cause and scoped follow-up.
- Installing the experimental skill, pushing, opening a PR, merging or deploying as part of this specification.

## Further Notes

The local implementation handoff is [Autobuilder improvements through priority 4](reviews/autobuilder-through4-2026-10-23/README.md). It links the review dispositions, measurements and retained verification records. Production and instruction inputs were tested at `2fdc4698`; `64e08cbc` contains the subsequent test-only census repair, and `715ee089` closes the documentation handoff. This specification does not rerun or certify those results.

The entrypoint changed from 17,211 to 3,137 whitespace-delimited words, with 10,939 words including mandatory startup references. Those counts are not a billed-token comparison. The small scripted scheduling probe used zero model calls and is not evidence of representative project acceleration.

The separate retrospective recommended strict local test selection first, followed by dependent-check selection, provider-observed usage and a revision-bound acceptance manifest. This specification follows that sequence.

The user selected the local fork as the destination and confirmed the testing boundaries. This document carries the local `ready-for-agent` state; no remote issue or tracker label has been created. If remote tracker publication is wanted later, use the configured project tracker and its triage vocabulary rather than assuming the upstream repository.
