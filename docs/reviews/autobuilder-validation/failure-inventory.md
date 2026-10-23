# Retained complete-run failure inventory

[Verified Fact] The retained complete run remains **failed: 22,326 passed, 422 failed, 410 skipped, across 938 runner-reported file executions; exit 1**. The historical record attributes it to `2fdc46980f64bec62d38555c4949df11284bcf40`. This report reconciles that evidence; it does not certify the current integration branch or rerun any tests.

The [machine inventory](failure-inventory.json) contains all 422 outer failures, their owning test files, body and summary line numbers, bounded diagnostic spans, classifications, and the 53 nested failure-marker occurrences. The original [verification record](../autobuilder-through4-2026-10-23/final-verification.json), its totals and raw logs are unchanged. The JSON records SHA-256 hashes for the source record and all seven logs so future readers can verify the same bytes.

## Count reconciliation

| Quantity | Count | Meaning |
|---|---:|---|
| Outer failing tests in terminal Bun summaries | 422 | The historical failure total |
| Unique outer failure names | 422 | Every one is present in the historical named list |
| Historical named entries | 465 | Includes 43 unique names emitted by nested test children |
| Additional nested `(fail)` marker occurrences | 53 | Those 43 names, including repeated child scenarios |
| Outer summary repetitions | 422 | The terminal failure list repeats the earlier body markers |
| Raw `(fail)` markers across the seven logs | 897 | 422 body + 422 summary + 53 nested; not 897 failures |
| Distinct owning files with outer failures | 80 | Failing-file count, distinct from the 938 reported executed files |
| Unnamed outer failure | 1 | Shared-libs interface case, already included in 422 |
| Additional outer unhandled/module-load markers observed | 0 | No additional retained outer error marker to add; not proof that unrecorded errors were impossible |

The 43 additional names break down as follows. The complete name/line mapping is in JSON.

| Child output | Unique names | Occurrences | Outer owner and evidence |
|---|---:|---:|---|
| Docs fault callbacks | 35 | 35 | `test/docsync-fault-interface.test.ts`, S3:1874-2491 |
| Docs report capture callbacks | 5 | 5 | `test/docsync-report-interface.test.ts`, S3:2503-2690 |
| QA-only callback | 1 | 9 | `test/qa-only-capability.test.ts`, S3:5479-5811 |
| Native launch, labeled attempt 2 | 1 | 3 | `test/ci-native-evidence.test.ts`, S5:1154-1305 |
| Eng section-read capture | 1 | 1 | `test/section-capture-native-tools.test.ts`, S5:4324-4361 |

These are nested diagnostics included in their parents' failed assertions. The native child output explicitly shows an attempt-2 label and two assertion traces per child; those attempts are preserved, not reclassified as additional outer failures. The nine QA-only occurrences belong to nine parent scenarios, and the three native occurrences to three CI identity scenarios. General retry deduplication is therefore not an adequate explanation for 465 versus 422. Some retained fixture strings also contain synthetic runner summaries; these are not outer terminal summaries.

### Raw log index

`S1` through `S7` below refer to exact retained files listed in the JSON `shards` array. All reside in `/Users/stefanandrei/Skill Master/autobuilder-efficiency-round1/.context/free-test-logs/`. Line references are one-based.

| Shard | Filename | Pass | Fail | Skip | Files | Outer summary starts / terminal line |
| S1 | `gstack-free-test-2026-10-22T22-03-35-858Z-47139-1.log` | 3689 | 64 | 70 | 155 | 5388 / 5458 |
| S2 | `gstack-free-test-2026-10-22T22-03-35-863Z-47139-2.log` | 4392 | 58 | 117 | 155 | 6032 / 6096 |
| S3 | `gstack-free-test-2026-10-22T22-03-35-863Z-47139-3.log` | 3548 | 88 | 24 | 156 | 6589 / 6683 |
| S4 | `gstack-free-test-2026-10-22T22-03-35-864Z-47139-4.log` | 3938 | 45 | 66 | 157 | 5467 / 5518 |
| S5 | `gstack-free-test-2026-10-22T22-03-35-865Z-47139-5.log` | 3269 | 64 | 92 | 157 | 5205 / 5275 |
| S6 | `gstack-free-test-2026-10-22T22-03-35-866Z-47139-6.log` | 3489 | 103 | 6 | 157 | 5971 / 6080 |
| S7 | `gstack-free-test-2026-10-22T22-16-35-019Z-47139-7.log` | 1 | 0 | 35 | 1 | no failure list / 45 |

All seven logs identify Bun `v1.4.0 (34cbb9a40)`; retained child diagnostics identify macOS arm64. This is environment evidence from the logs, not a claim about the current shell. The sum of terminal summaries matches every historical total. No selected-file plan is reconstructed here, so the 938 figure remains runner-reported execution count rather than a new selection-coverage certificate.

## Demonstrated obstacles and unresolved causes

Counts partition the 422 outer failures exactly. File counts within groups overlap and must not be summed. Groups identify the first supported obstacle or mismatch, not all possible defects behind it. In particular, 81 launch-ENOENT cases plus 128 other cases remain unresolved at root-cause level. A failed setup does not prove the intended product behavior passed or failed.

| Group | Outer failures | Distinct files | Evidence assessment |
| `fixture-shell-path` | 149 | 10 | demonstrated immediate cause |
| `fixture-shebang` | 17 | 1 | demonstrated immediate cause |
| `environment-inotify` | 41 | 5 | demonstrated immediate cause |
| `launch-enoent` | 81 | 32 | demonstrated symptom; hypothesis for cause |
| `expectation-url-encoding` | 2 | 1 | demonstrated mismatch with source contract |
| `expectation-census` | 3 | 2 | demonstrated mismatch; only one later repair documented |
| `instruction-guard` | 1 | 1 | demonstrated structural violation; runtime effect unverified |
| `unresolved` | 128 | 32 | unresolved |

**fixture-shell-path.** Shell or node diagnostic resolves the executable/module at /Users/stefanandrei/Skill instead of the full path containing a space. This is a launch failure, not a verdict on the intended helper behavior.

[Recommendation] Use argument-array execution for the observed unquoted fixture commands. First check one builder-profile case and the browse build syntax case in a disposable checkout whose path contains a space. Preserve assertions; then recheck only callers with this signature.

**fixture-shebang.** The generated detector fixture executable reports /Users/stefanandrei/Skill as a bad interpreter. Seventeen cases explicitly retain this diagnostic.

[Recommendation] Inspect the generated fixture launcher, select a space-safe interpreter invocation, and check the captured positive case plus a negative-control case in design-detector-source-fixture. Do not infer that the seven other failures in this file are repaired.

**environment-inotify.** observeQAWrites rejects non-Linux execution with Linux inotify required; two outer docs tests include this cause in their retained child logs.

[Recommendation] Select one qa-functional-observer-atomic case and one docsync-fault-interface callback on the supported Linux environment; decide separately whether platform selection or a macOS observer implementation is required. An unavailable platform is not passing coverage.

**launch-enoent.** posix_spawn reports ENOENT for a generated fake CLI. The retained error does not distinguish a missing file from a missing/unusable shebang interpreter.

[Recommendation] Before rerunning the selected PTY case, preserve the fixture file, executable mode, first line, process.execPath and launch result. The historical plan-count fixture directly writes #!${process.execPath}; a spaced interpreter path is a hypothesis, not a confirmed cause for all 81 cases.

**expectation-url-encoding.** Tests require the raw cwd string, while normalizeFileUrl returns pathToFileURL(...).href. In this checkout the returned URL correctly contains Skill%20Master and the assertion requires Skill Master.

[Recommendation] Check the two named relative-file URL cases against an encoded URL or a decoded filesystem path, with a path containing a space and a simple-path control. Preserve URL query/fragment behavior.

**expectation-census.** The recorded expected/observed lengths are 71/74, 105/108 and 73/74. Census content and routing must be checked before treating all changes as valid. Only paid-retry-supervision has the separately retained later test-only repair.

[Recommendation] Inventory the added registered entries for eng-finding-retry-budget and verify completeness, allocation and wall calculations. Reuse the historical 50-test result only with its original source and applicability evidence; do not subtract it from 422.

**instruction-guard.** The structural scanner rejects autobuilder-loop/sections/contracts.md for an Agent dispatch imperative without run_in_background: false or a recognized justified exemption. This is one observed guard failure, not proof of model behavior.

[Recommendation] Inspect the complete contracts section and dispatch policy, resolve the intended foreground/background contract, regenerate if changed, then run the exact background-guidance check and dependent instruction checks. Preserve the existing review policy.

The shell-path group is supported directly by truncated-path diagnostics (for example S1:4444 and S4:1974, and the Node syntax-check error at S2:86). The interpreter group has explicit bad-interpreter diagnostics (for example S6:1227 and S6:1631). The platform group has explicit inotify rejection, including the two nested docs contexts at S3:1882 and S3:2530. Those groups support bounded fixture/platform work, not a blanket conclusion that the repository is healthy.

The URL expectation classification also uses the historical source: `browse/test/url-validation.test.ts:170-186` checks raw cwd, while `browse/src/url-validation.ts:184-188,211-213` uses `pathToFileURL(...).href`. The launch hypothesis is supported only as a hypothesis by `test/plan-count-fixture.test.ts:232`, which writes a direct `process.execPath` shebang. Source reads used `git show 2fdc4698:<path>` so current worker changes cannot explain historical failures.

The instruction guard at S4:4873 is an observed defect in the tested structural contract. This report establishes no independently reproduced functional product bug. Other potential product defects, such as freeze ownership release, remain in the unresolved table because the retained assertion alone cannot distinguish product logic from fixture effects. No failure is labeled pre-existing: this report contains no before-branch comparison.

## Bounded follow-ups for the remaining 128 cases

Each row covers every unresolved failure for that file; individual names and log locations are preserved in JSON. These are proposed diagnostic checks, not executed reproductions or permission to expand into a repository-wide repair.

| Owning file | Cases | Representative evidence | Retained symptom and smallest useful follow-up |
| `browse/test/chromium-profile-isolation.test.ts` | 2 | S5:70, S5:85 | EPERM at safeKill during fixture cleanup. Capture owned child identity and allowed signal operation in a single isolation case; distinguish sandbox denial from wrong ownership before changing cleanup. |
| `browse/test/dia-macos-qualification.test.ts` | 1 | S3:222 | Real UID process inspection reports unavailable. Capture the exact process-table command status and stderr for the numeric-UID case; do not infer unsupported OS from false alone. |
| `test/artifacts-init-migration.test.ts` | 11 | S2:629, S2:643 | Ten status-127 assertions and one missing migration marker. Run only one v1.38.1 and one v1.40 migration fixture with captured stderr and quoted paths. Exit 127 suggests command lookup; retained output does not name the missing command. |
| `test/auq-native-capture.test.ts` | 1 | S6:727 | Missing capture/observed.json. Preserve fake-child launch diagnostics before reading the output artifact; absence does not prove the observer itself failed. |
| `test/ci-native-evidence.test.ts` | 3 | S5:1205, S5:1255 | Each nested native launch ends exit_code_1; outer shard status is failed. Preflight the fake child and retain its stderr for one rendered CI identity. The three identical nested names are separate parent scenarios, not three outer retries. |
| `test/cso-cli.test.ts` | 1 | S1:1666 | Offline start returns 1 instead of 0. Capture the start command stderr for the wallet-shaped-path fixture only. |
| `test/cso-docker-mounts.test.ts` | 1 | S1:1713 | lstat of the fixture Unix socket returns EOPNOTSUPP. Verify socket creation and lstat on the same filesystem/runtime before invoking the container builder; do not infer a Docker mount defect. |
| `test/cso-git-hardening.test.ts` | 1 | S1:1733 | Manifest contains tracked.ts, expectation requires TRACKED.ts. Check case sensitivity and actual directory entries in this fixture. Case-insensitive filesystem behavior is a hypothesis. |
| `test/cso-snapshot-identity.test.ts` | 1 | S5:1424 | Bounded ls-files reports path unavailable. Retain the bounded Git invocation and stderr for the large-file fixture, with its temporary repository lifecycle. |
| `test/design-detector-source-fixture.test.ts` | 7 | S6:1163, S6:1177 | Seven remaining cases show missing output or wrong retained exception/receipt flags. After the separately demonstrated interpreter repair, check one positive callback and retention control with exact launch output; do not count these seven as already explained. |
| `test/freeze-owned-lifecycle.test.ts` | 1 | S1:2105 | release with empty owner token exits 0 where nonzero is required. Inspect the release argument parser and retained state in this one negative control before deciding product behavior versus fixture expectation. |
| `test/gbrain-structured-busy.test.ts` | 11 | S3:2968, S3:2982 | Status is no-cli in ten cases, with one failed availability assertion. Check the fixture gbrain executable, interpreter and PATH in one engine-locked case before testing all response variants. |
| `test/gen-skill-docs.test.ts` | 1 | S1:2402 | Consultation dispatch subprocess status is null after approximately five seconds. Retain spawn error, signal and stderr and confirm the stub is selected. Timeout is plausible, but status null alone is not a root cause; do not increase timeout. |
| `test/gstack-artifacts-init.test.ts` | 1 | S4:3348 | Injected allowlist assembly failure unexpectedly exits 0. Check whether the intended failure stub executes and whether original/temporary files are preserved in this one case. |
| `test/gstack-design-detect.test.ts` | 1 | S2:2030 | Clean fixture is blocked with redact-exit=127. Capture the redactor command and stderr for the clean control; keep the dirty negative control. |
| `test/gstack-memory-ingest.test.ts` | 39 | S5:2239, S5:2254 | 39 stage/import/scan assertions fail; some retain missing gitleaks, most lack child diagnostics. Preflight the fixture scanner and import shim in one interrupted-stage case and one clean case. Preserve gitleaks ENOENT at S5:2707; do not extend that explanation to all 39 or treat scan refusal as a product defect. |
| `test/office-hours-attempt.test.ts` | 4 | S4:3750, S4:3768 | Missing captured output and timeout/startup outcomes differ from expected process exits. Capture fake process start, output and drain events for one cancellation case; diagnose launch/timing before changing abort semantics or budgets. |
| `test/outside-voice-receipt.test.ts` | 4 | S5:3427, S5:3439 | Unexpected exit 1 and missing receipt filename. Capture one nonce-bound fake-child launch and receipt writer result; a missing receipt is downstream evidence, not a demonstrated receipt-validation defect. |
| `test/plan-review-cases.test.ts` | 1 | S3:4521 | Eng handoff label count is four, expected three. Read the evaluated Next Steps section and verify each option against the intended handoff contract before updating the expected set. |
| `test/plan-seed-submission.test.ts` | 1 | S3:4689 | One seed submission exceeds its existing case budget. Retain this case child events and launch result; do not extend the other 22 launch-ENOENT findings to it without evidence or enlarge the budget. |
| `test/pty-output-wake.test.ts` | 1 | S3:5293 | One expected started.json is missing. Preserve the fake-child launch and startup log for the not-ready scenario; do not generalize the neighboring ENOENT cause. |
| `test/qa-browser-deadline-evidence.test.ts` | 2 | S4:4589, S4:4623 | Expected 0/124, received 127/2. Capture executable lookup and guard stderr in the no-browser and timeout cases before interpreting deadline semantics. |
| `test/qa-deadline.test.ts` | 4 | S4:4683, S4:4698 | Four timeout/signal cases return 2 instead of the required status. Capture the guard and direct child outcomes on one timeout and one signal path. Preserve owned-child settlement evidence; do not weaken expected statuses. |
| `test/qa-evidence.test.ts` | 2 | S2:3784, S2:3813 | Two timed capture cases return 2 instead of 124. Capture the selected guard invocation and child stderr for one case before attributing the shared exit code. |
| `test/qa-only-capability.test.ts` | 9 | S3:5507, S3:5545 | Nine nested child cases cannot open facts.json; outer expected outcomes fail. Preflight one success and one restrictive capability fake CLI, retaining launch diagnostics and the facts writer. Repeated child names are fixture scenarios, not proof of model failures. |
| `test/section-capture-native-tools.test.ts` | 5 | S5:4361, S5:4413 | Five expected successful captures produce exit_code_1. Retain the fake actor startup diagnostic for one Eng capture, then inspect its read/report evidence. The log does not establish section-reading behavior. |
| `test/setup-plan-tune-hooks-noninteractive.test.ts` | 1 | S3:6284 | One command with redirected stderr fails without retained output. Capture the out-of-domain-value invocation as an argument array. A quoting defect is plausible from adjacent cases but unverified for this case. |
| `test/shared-libs-checker-interface-evidence.test.ts` | 1 | S5:4601 | Unnamed failure passes diff text to a TOKEN interface; usage error and a truncated-path diagnostic occur. Trace the fixture start-token creation and command quoting, then call --check-shared-libs with its actual returned token. Do not choose one root cause from the compound symptom. |
| `test/spec-quality-gate-secret-sink.test.ts` | 2 | S4:5190, S4:5217 | Two hosts return the expected blocked code but no expected pending artifact. Inspect the pending-artifact write path and retain filesystem/command diagnostics in one host case, then check parity. Keep the no-dispatch assertion. |
| `test/sync-gbrain-source-probe.test.ts` | 4 | S2:5571, S2:5586 | Four cases have empty health fields or no recorded shim calls. Check PATH/interpreter and captured stderr for one pretty-state fixture before judging source selection. |
| `test/test-free-shards.test.ts` | 3 | S2:5653, S2:5677 | cancel-force reports two unattributed failures instead of one; two liveness vectors are true instead of false. Retain owned browser identities and cleanup decisions in those three focused modes. No historical baseline comparison is included here; later ticket-specific comparison evidence must remain separate. |
| `test/timeline-stop-hook.test.ts` | 1 | S4:5344 | Stored command includes quoting around a spaced path; assertion expects the unquoted string. Inspect hook command execution semantics and check the actual target invoked. Quoting may be necessary; establish the contract before removing it or changing the assertion. |

## Historical boundaries and review confidence

The later `64e08cbcc1f5730315d2bbc025d4c911d93c3b60` change only updates the paid-retry census from 73 to 74 and asserts the new section-read probe is present. The retained verification record separately reports 50 passes, zero failures, across three files in `.context/goal-census-final.log`. This report inspected the commit and retained metadata, not that focused run's raw log. Its result remains separate: **422 is not reduced to 421**, and the earlier complete run is not relabeled as passing. It also does not prove that the two `eng-finding-retry-budget` mismatches were repaired.

The seven autobuilder test files' 353 historical passes likewise remain subset evidence. No provider call, complete-suite rerun, product change, installed-skill update, or fresh model review was performed for this report. This inventory was produced by Codex; no Grok review is claimed.

**Confidence: high in count reconciliation and quoted diagnostic observations; medium in the bounded group interpretation; low in the root causes explicitly marked unresolved.** Missing fixture files, omitted child stderr, absent launch-environment snapshots and lack of baseline comparison are the main limits. A preserved minimal reproduction or a comparable baseline could materially change a cause classification, but would be new evidence and must not overwrite these historical outcomes.

To reproduce the report-only reconciliation: read each log's last terminal summary; take the final contiguous failure list immediately before it; match each normalized name (only trailing timing removed) to its earlier body marker; retain all unmatched body markers as nested output. Compare the unique name union with the historical 465-entry list. Attribute an outer failure using its final repository test stack frame, not merely the most recent header, because child output changes that header. For example, historical `test/native-launch.test.ts`, `callback.test.ts` and `capture.fixture.test.ts` headers are nested fixture names, not the owning outer files. The JSON preserves both values. Diagnostic spans are bounded excerpts ending at each outer failure; explicit additional spans are supplied for the two docs parents whose relevant child cause appears earlier.

Report checks performed: all seven original log hashes computed; 422 outer names matched in body and footer; all 465 historical names reconciled exactly; 53 nested occurrences and 43 unique nested names verified; all group counts sum to 422; every outer failure has a repository owning file and an evidence location. These are consistency checks on retained evidence, not test-suite executions.
