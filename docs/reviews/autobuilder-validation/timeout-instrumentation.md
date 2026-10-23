# Opt-in lifecycle timeout capture - 23 October 2026

Implementation: `9b8728af`. Historical timeout status: **unreproduced and unresolved**. Review gates, 30-second test/command deadlines and runner wall limits are unchanged.

## Capture boundary

The free shared-libs lifecycle replay accepts `GSTACK_LIFECYCLE_DIAGNOSTICS_DIR`, an existing directory outside its fixture. With the variable absent, no trace files are created. Each fixture gets a private directory (0700) and append-only JSONL file (0600). This is local diagnostic output, never acceptance or native-review evidence.

The trace records runtime paths, PID, cwd, temporary directory, load averages, and the start/end/error of the replay's Bash commands and actor hooks. Error records retain bounded message/stderr, code, status, signal and elapsed time. Command/error text is bounded to 4096 characters. It does not dump environment variables or successful command output.

Before deleting a fixture, cleanup retains up to eight regular `.failure.json` files from its known `.context/shared-libs-captures` directory, up to 64KiB each, with explicit truncation markers. Symlinked directories/files and nonregular files are rejected. Append failures are reported by `LIFECYCLE_DIAGNOSTIC_WRITE_FAILED` and separately retained error codes; they cannot replace the original work error or prevent cleanup.

An abrupt process kill can prevent the cleanup snapshot and terminal record. Previously appended starts remain outside the fixture, identifying an unfinished command or hook. Individual subprocesses inside a hook are not separately traced. This change does not establish the historical cause.

## Verification

- Unit and timeout-detector batch: **7 pass, 0 fail, 23 assertions**. It exercises a real child timeout, exact original-error preservation, retention after fixture removal, private permissions, bounded captures, symlink rejection, tracing disabled, and loss of the output directory during execution.
- Initial actual-runner reproduction: the unchanged exact valid case passed in **11.44 seconds**, 94 assertions. Its two traces survived fixture cleanup.
- Final actual-runner verification after the diagnostic-write correction: **2 pass, 0 fail**, runner elapsed **22.787 seconds**. The exact valid case and the stale-receipt negative case ran sequentially under the original limits. All four fixture traces survived cleanup; all 58 started steps settled, and no diagnostic-write warning occurred. The stale-receipt case continued to reject invalid evidence.
- Source hashes remained unchanged during the final run. The runner reported complete terminal capture and no cleanup error. Credential scan found zero HIGH, MEDIUM or LOW findings. Independent read-only review found and closed the write-error preservation defect; no further actionable finding remained.

Successful trace samples put review-log startup around 1.27-1.53 seconds and finish/read around 1.49-2.83 seconds. These are observations from successful runs, not evidence that they caused the historical timeout. No performance claim or timeout repair follows from them.

## Retained evidence and next use

Evidence: `/Users/stefanandrei/Skill Master/research/validation-path-fixes/timeout-instrumentation/`. Final results are under `final/`: `lifecycle-actual-shard.json`, `lifecycle-actual-shard.log`, `source-manifest.json`, `trace-readback.json`, `parent-runtime-identities.json`, and the four `lifecycle-*/events.jsonl` files. Unit logs are `diagnostics-final-unit.log` in the parent validation-path-fixes directory. Parent Node/Git paths, resolved file hashes and versions were captured immediately after the final run; they do not independently prove every descendant executable identity during it.

The retained `targeted-runner.ts` preserves the actual runner environment, supervision and limits and adds only the two exact case selectors. For a future justified reproduction, use a fresh external diagnostic directory and new log names; preserve every failed attempt. Inspect unmatched start IDs and error records before changing code. The complete-suite timeout, empirical evaluations and adoption remain open. No full-suite retry or provider invocation occurred in this follow-up.
