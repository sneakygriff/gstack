# Offline usage evidence

Run `bun scripts/autobuilder-usage.ts <normalized-events.json>` to emit a JSON report
on stdout. Exit 0 means the input was valid and a report was produced, not that a
provider observation or acceptance gate was verified. Invalid JSON, invalid fields,
conflicting records and unsafe numeric totals exit 2, write a diagnostic to stderr,
and emit no partial report. The command reads one local file and makes no provider
calls, account changes, writes or invoice calculations.

This is a documented normalized format, not a guessed native Claude, Codex or Grok
log parser. A capture adapter or operator maps retained final usage records into
it. Preserve the original evidence and record the mapping in `provenanceNote`.
Do not normalize intermediate streaming snapshots as independent messages.

## Input contract

The root has `schemaVersion: "autobuilder-usage-events/v1"` and an `events` array.
An empty array produces an empty report, with no usage or coverage credit.
Unexpected fields are rejected rather than silently ignored.

Each event has:

| Field | Meaning |
| --- | --- |
| `runId`, `eventId` | Required stable identity from the capture. For aggregates, a digest plus locator can identify the retained record; label it as such. Never invent a provider message ID. |
| `attemptId` | Stable dispatch/attempt identity, or null when unavailable. Multiple final message records can belong to one attempt. |
| `kind` | `model` or `helper`. A helper cannot carry model identity or token metrics. |
| `phase`, `role` | Required attribution labels; explain operator-assigned labels in the provenance note. |
| `observation` | `observed` or `estimated`. These are reported in separate groups. |
| `provider` | Required nonempty provider namespace for a model event; null for a helper. |
| `model`, `transport` | Observed identity/transport strings, or null when unavailable. |
| `sourceFingerprints`, `instructionFingerprints` | Nonempty maps of input identifiers to lowercase SHA256 digests, or null when unavailable. These are capture-supplied claims, not independent proof of model consumption. |
| `evidence` | Nonempty array of `{ref, sha256}`. `ref` locates original evidence; SHA256 identifies its bytes. The command retains these references without opening or independently validating them. |
| `usage` | Optional object: `inputTokens`, `outputTokens`, `cacheCreationInputTokens`, `cacheReadInputTokens`. Missing/null values stay null. Each known value is a nonnegative safe integer. |
| `durationMs` | Entire attempt duration, repeated consistently on its message records, or null. It is counted once per attempt. |
| `isRetry` | Whether this attempt was a retry: true, false or null. Count retries from attempt metadata, never from the number of messages. |
| `recordScope` | `message`, `aggregate`, `operation` or `unknown` (default). An event count is not automatically a model-call count. |
| `provenanceNote` | Optional short explanation of normalization and evidence limitations. |

Optional nullable fields may be omitted. Without an attempt identity, attempt
metrics must also be unknown. Nonempty strings may not contain control characters
and are limited to 4096 characters. SHA256 maps cannot be empty: use null for
unknown inputs. Output token totals already include any reasoning subset; do not
add reasoning or cache detail subcategories a second time.

Deduplication uses `(runId, provider, kind, eventId)`, independent of phase/role or
capture-file location. Equal payloads count once and their evidence references
are combined. Conflicting payloads fail with `conflicting_event`. An attempt's
identity is `(runId, attemptId)`; conflicting phase, role, provider, model,
transport, observation, retry or duration metadata fails with
`conflicting_attempt`. Source/instruction fingerprints remain attached to each
event. The report does not silently pick the latest or largest snapshot.

After deduplication, a session aggregate cannot coexist with other records for
the same run, provider, kind and observation class. This includes another distinct
aggregate, because the adapter cannot prove their coverage is disjoint. Such
inputs fail with `overlapping_aggregate`; report alternative captures separately.

## Report contract

`schemaVersion` is `autobuilder-usage-report/v1`. `input` retains the resolved
input path and the SHA256 computed from the exact bytes read. `events` preserves
the normalized, deduplicated evidence. `duplicateEvents` reports the removed
repetitions. `groups` partitions by phase, role, kind and observation.

Each group gives event count, known attempt count and unknown-attempt record
count. `attempts` is null if any attempt identity is missing. Token metrics,
`attemptDurationMs` and `retryAttempts` use:

- `total`: the sum only when all included records have known values; otherwise null.
- `knownSubtotal`: sum of available values, or null when none are known.
- `known` and `unknown`: record counts establishing completeness. Attempt-level
  metrics count distinct known attempts, plus unknown-attempt records.

These are totals over the supplied records, not claims that the capture covers
the entire run. Durations sum attempt time and are not wall time when attempts
overlap. `wallTimeMs` and `invoiceCharges` are always null. No quota, independent
subscription pool, monetary saving, or acceptance verdict is inferred.

The report computes only the normalized file's digest. Applicability to current
source/environment, provenance verification and reused-evidence policy belong to
the acceptance manifest. A recorded inspected-source manifest does not prove
which bytes a model consumed.

## Retained Fable example

`docs/reviews/autobuilder-validation/usage-example-input.json` maps the retained
through-priority-4 Fable metadata into one session aggregate. The companion
`usage-example-report.json` is actual command output. Its evidence digest points
to the original metadata, and its source fingerprints copy that file's inspected
manifest. Expanded instruction fingerprints, duration, attempt identity and retry
status are unavailable and remain null. The event identity is a local digest plus
locator; no message IDs were invented.

The reproduced observed totals are 194 input, 13,090 output, 179,229 cache-creation
input and 595,132 cache-read input tokens. They are the retained session's usage,
not a new provider run, subscription invoice or measured savings comparison.
Regenerate the report with:

```sh
bun scripts/autobuilder-usage.ts docs/reviews/autobuilder-validation/usage-example-input.json
```

The raw round-1 `fable-usage.json` also illustrates final message usage fields.
Its nested iteration/cache/reasoning detail is not an additional token bucket.
This adapter deliberately does not sum both detail and top-level totals.
