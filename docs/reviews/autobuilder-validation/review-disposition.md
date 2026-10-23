# Native binding verification

Reviewed `git diff f9208680` through native commit `c4f8d531`, plus cost fixes `c512bca9`/`19b65871` and selector fix `51ad7698`, Static only; no tests/providers or repository edits. Reported test results were supplied by the parent, not independently rerun.

## Original dispositions

**Standards:** the original single public-launcher finding remains addressed by the earlier parsing/default-root regression fix. It duplicates the Spec CLI defect; this native patch adds no separate Standards finding.

**Spec:** CLI and paid-exemption/free-dependency findings remain addressed. The previously partial ticket-05 native binding capability is now implemented for registered workflow judges and generic section-read targets, including autobuilder-loop, within the documented operator-declared scope. `EvalCollector` begins binding at construction before model work, captures declared inputs/runtime/environment, finalizes a digest-bound native result, and retains original run identity. Workflow callbacks now retain actual constructed prompts/resolved request models. Generic section collectors register before fixture/capture execution and record success only after the unchanged Read/completion assertions pass.

A new successful run can therefore earn scoped acceptance; the earlier “no eligible native path” limitation no longer applies. API prerequisites still do not establish adoption: complete input/environment declarations, actual required passing evaluations and live comparisons remain necessary. Provider-observed identity remains explicitly unknown.

Binding validation (`scripts/native-eval-binding.ts:74-91`) rejects corrupt results, changed start/end inputs, stale runtime/environment/declarations and absent legacy binding. Acceptance (`scripts/autobuilder-acceptance.ts:223-251`) rejects missing/extra cases, partial records, missing prompt/model, inconsistent attempt ledgers, unknown scope and all unsupported entry-level reuse. Final failed/manual cases receive no credit. Prior failed retries stay visible while final-attempt policy matches the existing harness. Whole-artifact reuse preserves its original identity.

## Follow-up dispositions and findings

**Original P3 closed:** `c512bca9` tracks cost observations independently of turns, covering both missing-cost and missing-turn cases.

**Selector follow-up addressed:** `51ad7698` adds an exact changed-test reason when the test was already selected through another dependency. Selection remains deduplicated; unknown-file and prior-registry blockers are unchanged. Four CLI-reader dependency edges select demonstrated consumers without widening paid execution.

**Paid-report P3 closed:** `19b65871` preserves nullable `files[].cost` in `collector-outcomes.json` (the actual filename, correcting the earlier report label). The direct workflow consumer now emits explicit unknown TSV values, preserves known zero, makes aggregate unknown sticky across later known rows, and renders unknown without a dollar sign. Its raw-artifact fallback also preserves unknown cost. Regression coverage exercises schemas 1/2/3 and the actual workflow shell. Verdict, execution, billing, retry, budget and approval conditions are unchanged. Retained final log confirms 46 passed/0 failed across four files; no rerun performed here.

**New actionable findings:** none remaining in the requested fixes.

Selective schema/cost-consumer review found no reader rejecting schema 3. `eval-compare` only warns on mixed versions; default unbound numeric-cost records still use schema 2. Remaining inspected store/history/watch/summary/cache paths showed no further concrete compatibility defect.

## Verification limits

Fixture reuse remains valid: each invalid response gets fresh callback state and asserts an empty cache. No timeout was raised.

Confidence: high for the binding capability and reviewed corrections; medium for absence of additional defects. Tracked checkout remained clean; pre-existing untracked `node_modules` remained.
