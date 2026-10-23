# Repaired frozen free-suite reconciliation

Source: `9a7c8a2c764f3b34034242a2dfc9862dc9cb2f6a`. Outer exit: **124**. Evidence copied to `/Users/stefanandrei/Skill Master/research/validation-orchestration/repaired-free-evidence` with matching source/copy SHA-256s.

Full-suite totals remain **unknown**. Completed-shard subtotal only: {'pass': 1, 'fail': 0, 'skip': 35, 'tests': 36, 'files': 1}.

| Shard | Runner status | Pass | Fail | Skip | Files | Named footer | Summary |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| 1 | timed-out | unknown | unknown | unknown | unknown | 0 | missing |
| 2 | timed-out | unknown | unknown | unknown | unknown | 0 | missing |
| 3 | timed-out | unknown | unknown | unknown | unknown | 0 | missing |
| 4 | timed-out | unknown | unknown | unknown | unknown | 0 | missing |
| 5 | timed-out | unknown | unknown | unknown | unknown | 0 | missing |
| 6 | timed-out | unknown | unknown | unknown | unknown | 0 | missing |
| 7 | pass | 1 | 0 | 35 | 1 | 0 | complete |

No completed outer failure footer is available from the six timed-out shards. **A completed-failure name comparison is unavailable**; this is not evidence of zero failures, zero novel failures, or resolved historical failures.

The incomplete child bodies contain **102 raw failure markers with 101 unique names**, including nested fixture output. This inventory is retained separately in JSON. Name overlap only: 47 unique names also occur in the historical outer inventory; 23 occur in the earlier f920 completed footers; 67 occur in its incomplete body output. Ten unique body names were not observed in either earlier set. These are not terminal outcomes or proven regressions. No module/unhandled candidate markers matched the retained logs.

## Cleanup observation

Group 136 absent at observation: True. Exact warnings and process identities are retained in `repaired-free-cleanup-observation.json`. Recorded daemon/child PIDs 1996, 8944, 9281 and 17337 were also absent at 06:10 UTC. Both cleanup-state log sets and token-redacted identity records are retained with hashes. The runner ownership warnings remain unresolved; process absence does not prove every unknown detached descendant settled.

## Focused-change file observations

- `test/autobuilder-acceptance.test.ts`: observed; retained separately without acceptance credit
- `test/test-focused.test.ts`: not observed
- `test/validation-select.test.ts`: not observed
- `test/design-html-section-completion.test.ts`: observed; retained separately without acceptance credit
- `test/workflow-judge-cache.test.ts`: not observed
- `test/eval-cli-family.test.ts`: observed; retained separately without acceptance credit
- `test/ci-paid-coordination.test.ts`: observed; retained separately without acceptance credit
- `test/ci-eval-cache.test.ts`: observed; retained separately without acceptance credit
- `test/helpers/eval-store.test.ts`: observed; retained separately without acceptance credit

## Demonstrated launch limitations

- The logged forbidden substring is private; the received prompt includes a legitimate /private/tmp/... absolute skill path. This directly demonstrates a path-sensitive assertion mismatch, not a product regression. Source: `test/auq-native-capture.test.ts:593`.
- The assertion expects cwd/package.json to be outside the temp directory; this run uses a /private/tmp checkout and the logged function did not throw. The changed launch location is material context, not a general explanation of all failures. Source: `browse/test/data-platform.test.ts:124`.

## Evidence limits

- No test or provider executed by this reconciliation.
- Missing terminal summaries keep full totals unknown; body markers are not terminal test counts.
- Named failure overlap does not establish equal causes or pre-existing defects; absence is not proof of a fix.
- Runtime/backend/requested model identity and empirical adoption are outside this free-suite evidence.
- Visible preceding headers are log attribution only; nested fixtures can emit repository-like headers.
- No per-shard JSON receipt is emitted by this local full-suite invocation; terminal summaries and runner diagnostics are the retained evidence.

Per-shard hashes, terminal lines, named failures, diagnostic excerpts and historical comparisons are in `repaired-free-reconciliation.json`.
