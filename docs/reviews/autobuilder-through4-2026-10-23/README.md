# Autobuilder improvements through priority 4

Implemented on isolated branch `codex/autobuilder-efficiency-round1`. Final tested code: `2fdc4698`. The installed repository at `~/.claude/skills/gstack` remains separate. This is an opt-in experiment, not an installed release.

## Delivered

1. Confirmed Fable F1/F2/F4 fixes: isolated helper startup, useful fixed-vocabulary errors, and one consistent missing-reference rule for L2. Commit `9b8f68ba`. Existing judge-supervision/dependency fixes were preserved separately in `6b40634d`.
2. Trusted host executor: queue lifecycle, private worktrees, guarded clean integration, named checks with time/output/process limits, atomic journals, attempt IDs, receipts and ship-range measurement. No provider credentials or automatic billing override. Commit `ec041b40`.
3. Thin entrypoint with mandatory role contracts and conditional stage references. A source-to-reference preservation map checks all twelve moved blocks; explicit changes permit contracted helpers and remove the obsolete inline meter instruction. Canonical review extraction rejects ambiguous boundaries. Commit `d0310f5f`; generated references in `f9b852a8`. Final packaging repair `6e010ffe` restores canonical always-loaded question formatting and registers the carve, including a real periodic section-read test; regenerated output is `2fdc4698`.
4. Shared exploration sections bind to Git object IDs of declared inputs. Admission and completion reject stale inputs or changed pinned notes/briefs.
5. Continuous admission unlocks dependents only after successful integration/checks. Every worker has its own worktree. Write/resource reservations, longest remaining path priority and a maximum of three workers bound admission. Static waves remain available. Helper commands are serial; model workers may run concurrently.

The existing `autobuilder-unit.js` gate implementation has no changes between `6b40634d` and `2fdc4698`. The host queue hands back to its prebuilt path with the complete ship range, scope and owner metadata. Integrate, both review seats, Docker/mutation requirements, fixes and Ship remain controlling. BUILT is not a passed gate. No review-price experiment from priority 5 was adopted.

## Measurements and their limits

[Context measurement](context-measurement.json) uses whitespace word counts on explicit source revisions:

- Baseline entry: 17,211 words.
- New entry: 3,137 words, including the unchanged 1,672-word canonical question-format contract.
- New entry plus mandatory initial setup/contracts: 10,939 words.

The original 1,000-1,500 total-entry target is not met: the mandatory question-format block alone exceeds it. The router excluding that unchanged block remains within 1,500 words. The block appears once, not again in startup. Later stages load more references. Total context over a complete run can grow; these numbers do not establish billed-token savings, cache behavior or quality equivalence.

[Scheduling probe](queue-benchmark.json): four disposable real-Git runs in rotated order, with two scripted workers and graph A -> C, independent B. Same starting/final tree and checks. Worker delays were deliberately set to A=0.5 s, B=5 s, C=3.5 s.

- Static waves: 11.651 s and 11.589 s.
- Continuous: 7.980 s and 8.085 s.
- Each run made ten measured helper calls excluding status, zero model calls, and retained `review_required: true`.

These are small local scheduling observations, not provider latency, representative project throughput or a statistical speedup claim. [Reproduction script](queue-benchmark.ts.txt): copy to `.context/queue-benchmark.ts`, run from repository root with the pinned Bun 1.4.0 runtime and `TMPDIR=/private/tmp`; it creates/removes only its own temporary fixture roots. It does not execute reviews.

The [Fable walkthrough](fable-walkthrough.md) used the authenticated interactive subscription session. It followed all five policy scenarios and found a real ship-base accounting defect, repaired with a regression, plus lifecycle instruction gaps. [Dispositions](findings.md) distinguish verified fixes, hypotheses and deliberate behavior. Its [usage metadata](fable-metadata.json) is one review observation, not a benchmark or invoice. Grok's earlier findings remain in the prior review folder; a new Grok review of this iteration was not run.

## Verification

The first complete run at `f9b852a8` exited 1: 22,323 pass / 423 fail / 410 skip across 938 files. Its [counts and named failures](initial-full-counts.json) are retained. It exposed the always-loaded question-format regression and missing carve registration; both were repaired, then a second full run started on `2fdc4698`. The final result is recorded below. Focused counts overlap and must not be summed:

- 629 passed / 0 failed across 16 files before the final Fable follow-up.
- 247 passed / 0 failed across seven files after the ship-base/lifecycle fixes, including all 17 queue scenarios.
- Before the final carve registration: 14 passed / 0 failed for packaging, context budgets and historical parity.
- Final packaging repair: 443 passed / 1 failed across 18 adjacent files; the sole new failure identified missing dependency registration for the new periodic wrapper. After that concrete wiring repair, 100 passed / 0 failed across five dependency/sharding/deadline files. All outcomes are retained; the final full run is authoritative for the final source.
- 67 passed / 0 failed for test-only-code classification and judge input/cache checks.
- All-host generation, build, shell syntax/error-level ShellCheck and credential scan passed at their recorded stages. Final source identity is checked after the full suite.

The initial adjacent invocation accidentally named two nonexistent test files; Bun silently ran only the valid recipe file (132 passed). That result is counted only as that one file. The corrected three-file selection above ran the intended checks. This is retained as retrospective evidence rather than concealed by a green exit code.

## Remaining before adoption

- Resolve/classify the complete repository's free-suite failures. A passing autobuilder subset is not release acceptance.
- Run selected paid workflow/role judges when the required API-backed test environment is available. The current environment has no `ANTHROPIC_API_KEY`; the interactive walkthrough does not substitute for those judges.
- Run repeated equivalent live implementation units, compare packaging/executor/continuous arms, capture real token/cache/retry/latency and quota evidence, and choose an acceptable token-versus-time trade-off. Scripted workers establish executor behavior only.
- Verify distinct effective identities before budgeting two Claude pools. Grok's authenticated web review is not evidence of a working CLI code-review sandbox.
- Keep continuous execution opt-in until host dispatch, recovery and account-limit behavior are exercised on a representative project. Ambiguous integration recovery is deliberately manual. CANCELLING does not acknowledge that a worker stopped.
- Review and explicitly choose installation/adoption. No push, PR, merge, deployment or active-skill replacement was performed.

## Final result and morning handoff

At source `2fdc4698`, the complete free runner exited 1: **22,326 pass / 422 fail / 410 skip across 938 files**. [Final verification](final-verification.json) contains every shard, source identity, scoped results and named failures. [Case-label comparison](failure-comparison.json) records what changed between the two full runs without attributing causes.

The seven autobuilder files report **353 pass / 0 fail**: workflow harness 296, queue 17, operations 18, launcher 5, packaging 5, efficiency 3, forum divergence 9. The always-loaded question-format checks report 69 pass / 0 fail, and carve completeness passes. These are disjoint per-file results from the final full run; earlier focused counts overlap them. Final source fingerprints match the pre-run snapshot.

The runner again reported browser cleanup uncertainty for a retained temporary state directory. Subsequent read-only inspection found its recorded PID absent and no process referencing that directory. No process was killed manually; this does not prove every possible detached descendant was identified. The original diagnostic and state remain available.

The remaining adoption blockers are the general-suite failures, selected model-quality/section-loading evaluations, and a representative live comparison. The active installed skill is unchanged. Startup context is still 10,939 words with mandatory references; further trimming requires evidence about actual loading and caching, not another headline entry-size claim.

After the complete run, its case-label comparison exposed one additional stale inventory assertion: periodic cases increased from 73 to 74 with the new section-read probe. The assertion now names that probe and counts 74. The complete supervision file plus carve sharding and detached deadline checks passed afterward (50 pass / 0 fail across three files); all existing retry, worker, wall-clock and CI limits stayed unchanged. This was a test-only correction; the production source and generated instructions remain byte-identical to `2fdc4698`. The complete suite was not rerun a third time, and its observed 422 failures have not been arithmetically rewritten as a new result.

The requested separate retro session was started after these final checks: `01a165b2-764e-7160-ad0a-ada380dabdf2`. It is a read-only environment retrospective, not another implementation or install.

The retro session completed after independently checking the retained shard totals. Its four recommendations are: strict validation/reconciliation of explicit local test selections; automatic selection of dependent checks for skill structure changes; provider-observed usage bound to phase/role/instruction fingerprints; and a revision-bound acceptance manifest separating passed, failed and unexecuted evidence. The first suggested next action is the strict focused-test selector. No implementation or new test run occurred in the retro session.
