# Scoped acceptance records

`bun scripts/autobuilder-acceptance.ts` assembles acceptance for an explicitly
listed set of checks. It preserves original executions and independently checks
retained receipt/log consistency. It does not discover dependencies, authenticate
local evidence against forgery, certify an entire release, or run paid providers.

## Declare the consumed scope

Create a plan using `autobuilder-acceptance-plan/v1`:

```json
{
  "schemaVersion": "autobuilder-acceptance-plan/v1",
  "root": "/absolute/checkout",
  "checks": [{
    "id": "focused-contract",
    "files": ["test/example.test.ts"],
    "inputs": ["test/example.test.ts", "src/example.ts", "bunfig.toml", "test-setup.ts"],
    "environment": ["EXAMPLE_MODE"],
    "scope": {
      "status": "declared-complete",
      "note": "Reviewed complete source, config and fixture inputs; no external state.",
      "unresolved": []
    },
    "record": "/absolute/evidence/example-run-1.json"
  }],
  "historical": []
}
```

Paths in `inputs` resolve against `root`; absolute paths can bind external
regular files. Root and record paths resolve against the plan's directory.
Every selected test must appear in `inputs`. Include all consumed source,
references, expanded prompt/rubric bytes, fixtures, package dependencies and
configuration, including any preload. A lockfile alone does not prove installed
package bytes. Declare relevant environment variable names. The command retains
hashes, not environment values; absence remains distinct from an empty value.
PATH, TMPDIR, NODE_OPTIONS and BUN_OPTIONS are included automatically, together
with the current Bun executable, version/platform/architecture and the adapter's
known runner/parser/selection implementation files.

This completeness declaration is an operator judgment. Its note must explain
the boundary. Use `status: "unknown"` and list `unresolved` dependencies when
external services, packages, binaries, file trees or other consumed state cannot
be bound. These checks cannot earn acceptance. The command does not infer
completeness from Git HEAD or selected test hashes. Inputs must remain fixed
through execution; before/after hashing cannot detect a file changed and restored
mid-run. A relevant dependency omitted by the declaration is outside this
contract, even if the command reports `applicable`.

## Capture and assemble

```bash
bun scripts/autobuilder-acceptance.ts capture /absolute/plan.json focused-contract
bun scripts/autobuilder-acceptance.ts assemble /absolute/plan.json > /absolute/manifest.json
```

Capture delegates execution to `test-focused.ts`, which enforces exact free-only
selectors and retains its own receipt and full log. The adapter records declared
bytes and relevant environment before and after that execution, the subprocess
exit, and hashes of the original receipt/log. It never overwrites an existing
record: change the record path for a later attempt. Preserve that record **and**
the referenced receipt and log; all three are needed to assemble later. An optional positive `wallTimeoutSeconds` on a check forwards the existing
runner deadline. Capture
exits 0 for a zero child exit, 1 for other child outcomes, and 2 for command errors.
A successful capture alone does not mean acceptance: skips or unknown scope may
still block it. Cancellation forwards to the existing runner and preserves its
partial evidence when the child can finish capture.

Assembly is read-only and launches no tests or providers. Each check retains:

- `status`: passed, failed, skipped, cancelled, timed-out, incomplete, or unexecuted. Mixed
  pass/skip runs are `skipped`, with both counts retained. Timeouts remain distinct
  from explicit cancellation; neither earns coverage.
- `applicability`: applicable, stale, incomplete, or missing, evaluated separately
  from the historical outcome. A stale pass remains visible but earns no credit.
- Original run ID, timestamps, revision, artifact paths/hashes and reuse flag.
  A different HEAD alone does not invalidate declared unchanged inputs. Changes
  to unrelated documentation can therefore retain credit.
- Observed pass/fail/skip/unhandled counts from the retained log, plus terminal
  test/file totals. Unknown counts stay null. Named failures, unattributed failures, module-load markers and crashes remain
  separately visible. Failed outcomes and logs remain
  visible; the command does not assign causes or infer that failures predate work.

Acceptance requires every listed check to have applicable, complete, consistent
passing evidence, nonzero passed cases, and no skips. Missing artifacts, changed
bytes/environment, missing capture metadata, inconsistent counters, selected
files or terminal summaries cannot certify acceptance. A raw focused receipt or
an arbitrary `passed` JSON object lacks the complete input binding and is
incomplete. Existing results without contemporaneous complete inputs cannot be
retroactively certified by hashing today's checkout.

Assembly exits 0 only when all checks receive scoped coverage credit, 1 for
failed/incomplete acceptance, and 2 for invalid command/plan input. The manifest's
current revision is context, while each check preserves its original revision.
`reused` means retained evidence was applicable; no fresh execution is implied.

## Historical evidence and unavailable checks

`historical` holds original attributed records verbatim, separately from current
checks. Every historical row is labeled `historical-unknown-inputs` and receives
zero credit. These records are not validated or summed into current outcomes.
The retained example in `docs/reviews/autobuilder-validation/acceptance-history.json`
preserves the earlier complete run's 422 failures and the later 50-test pass as
two distinct observations. It neither subtracts failures nor certifies old input
scope. The linked report is the source attribution, not an authenticated witness.

Keep required but unavailable model evaluations in `checks`, with no record and
an unknown scope explaining the missing prerequisites. They appear unexecuted
and missing, with their scope and unresolved prerequisites visible.

## Native model outcomes

For an existing `EvalCollector` result, set a check's `kind` to `native-eval`,
`record` to its native JSON path, and `cases` to the exact selected case names.
Keep `files`, `inputs`, `environment` and `scope` as above. Omitted `kind` retains
the focused-run behavior. The free `capture` command rejects native checks;
run model evaluations only through their existing harness and billing guards.

Assembly reads `EvalResult` schemas 1 and 2 from `test/helpers/eval-store.ts`,
reconciles selected case names and outcome, execution/reuse, cost and duration
counters against the entries, and preserves revision, timestamp, CLI version,
attempt and original reuse provenance. Partial records and absent model or reuse
metadata are reported explicitly. Manual-review entries do not become scored
passes; failed attempts remain visible even when a later attempt passes.

These native records **cannot currently earn applicability credit**: they lack
complete consumed source/instruction fingerprints and runtime/environment
binding. Today's declared input hashes are displayed as current context only.
An original cache `input_key` is preserved but does not stand in for its complete
consumed-input identity and passing proof. The workflow cache's own eligibility
and reuse policy remain unchanged. Native results therefore retain their
historical outcome while applicability is incomplete. Arbitrary passed JSON or
contradictory counters are reported as incomplete evidence.

## Usage measurements

Add a separate `measurements` array to the same plan:

```json
{
  "measurements": [{
    "id": "review-usage",
    "report": "/absolute/evidence/usage-report.json",
    "inputs": ["src/example.ts"],
    "instructions": ["evidence/expanded-prompt.txt", "evidence/rubric.txt"],
    "environment": ["MODEL_ENDPOINT"],
    "scope": {
      "status": "declared-complete",
      "note": "Declared source and instruction identifiers match this capture.",
      "unresolved": []
    }
  }]
}
```

This is an additional plan field, not a standalone plan. `report` resolves against
the plan directory; input and instruction identifiers resolve against `root`.
Each event must describe this same declared scope. Split measurements for
events with different consumed scopes. Generate the report with the existing
`autobuilder-usage.ts` command and retain its normalized input and original
evidence files.

Assembly verifies the report's normalized-input digest and recomputes the entire
report through the existing validator and deduplicator. It checks every original
evidence digest, then reconciles declared source/instruction identifiers and
hashes against the retained events and current files. Local evidence references
resolve against the normalized input directory; remote or opaque locators remain
unverifiable offline. The manifest retains report/input/evidence fingerprints,
deduplicated events, unknown usage fields and groups. Changed consumed bytes are
`stale`; missing or contradictory artifacts have `consistency: incomplete`.

Even consistent measurements remain `applicability: incomplete` because usage
v1 has no execution-environment snapshot and its consumed fingerprints are
caller-attributed. Declared environment names are reported as missing capture
evidence, never filled from today's environment. Measurements always receive
zero coverage credit and do not affect the quality-check aggregate: only the
listed `checks` determine its scoped status. A usage report cannot replace a
missing API evaluation, prove quality, establish savings or certify adoption.
