# Focused free validation

Use the focused adapter when you already know the exact free test files:

```sh
bun run scripts/test-focused.ts --plan -- test/example.test.ts
bun run scripts/test-focused.ts -- test/example.test.ts 'test/name with spaces.test.ts'
```

`--root <directory>` selects the checkout (default: current directory).
`--wall-timeout <seconds>` overrides the existing free runner's deadline.
Use `--` before file selectors. Paths may be absolute or relative to the root.
Duplicate canonical paths run once. Missing files, directories, glob patterns,
file symlinks, paths outside the root and registered paid tests are rejected
before a test starts. An empty selection returns `no-work`, with no coverage
credit. Preview reads files but creates no artifacts or subprocesses.

Execution uses the existing free runner's process supervision, private state,
full-stream capture and cleanup. It does not retry. JSON is written to stdout;
runner diagnostics go to stderr. A private JSON receipt is retained alongside
the full log under the checkout's `.context/free-test-logs`. The result names
both paths. Preserve these artifacts when investigating failures.

A passing child exit is insufficient: observed file headers must match the
selection, capture and the terminal summary must be complete, the evidence log
must be retained, and selected input bytes must remain unchanged. Results
distinguish `passed`, `failed`, `incomplete`, `timed-out` and `cancelled`.
Exit codes are 0 for passed/no-work, 1 for failed/incomplete/preflight errors,
124 for timeout, and 130/143 for SIGINT/SIGTERM cancellation. A passed run with
skipped cases still has `coverageCredit: false`; pass/fail/skip counts remain
in `outcome.evidence`.

Receipts identify Git HEAD when available and SHA-256 digests of the selected
test files before and after execution. These are deliberately **not** a complete
dependency fingerprint or release acceptance. A dirty checkout can share HEAD
with another run. Dependent source inputs and environment must also match before
reusing a result. File coverage is observed from Bun's output, not an independent
attestation against intentionally forged output from test code.
