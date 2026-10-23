# 06: Reconcile and triage historical failures

**What to build:** Produce an evidence-backed inventory of the retained complete run and bounded repair recommendations.

**Blocked by:** None (can start immediately)

**Status:** done

- [x] Reconcile reported totals with named failures and module-load/unattributed errors.
- [x] Group demonstrated product, expectation, fixture and environment causes; retain unknown causes explicitly.
- [x] Do not label failures pre-existing without comparison evidence.
- [x] Identify minimal reproductions and scoped follow-ups without unbounded cleanup or rerunning the complete suite.
- [x] Keep original logs/results unchanged and mark limits of the historical evidence.

## Completion evidence

- Report commit `1a2a7e4141b0ab53e432f16d6823d646c27de270`; integrated with `--no-ff` at `54a0b23c137ed97dc1a2fe2186b0c240506fd8d8`. Only `docs/reviews/autobuilder-validation/failure-inventory.{md,json}` changed in the worker branch; Codex authored this report, with no Grok review claimed.
- Historical result remains 22,326 pass / 422 fail / 410 skip across 938 runner-reported file executions, exit 1, attributed to `2fdc46980f64bec62d38555c4949df11284bcf40`.
- Merger independently checked 422 unique outer failures plus 43 disjoint unique nested names equals 465 historical names; 897 raw markers equals 422 body plus 422 footer plus 53 nested occurrences. Eight classification groups partition 422; 80 owning outer test files remain separate from nested headers.
- Merger recomputed and matched SHA-256 for all seven original logs and the original verification record. The report preserves body/footer locations and nested markers; one unnamed outer failure is already included. Zero additional retained outer unhandled/module-load markers is an observed limit, not proof that omitted errors were impossible.
- Demonstrated immediate fixture/platform obstacles are separated from hypotheses and unresolved root causes. Every unresolved file has a bounded diagnostic follow-up. No before-branch comparison is claimed; ticket 01 baseline evidence and the later historical 50-test result remain separate and are not subtracted from 422.
- Clean tracked state and branch ancestry verified before merge; merge was conflict-free and whitespace check passed. No tests, full suite, provider calls, package edits, product fixes or installed-skill changes were performed for this report integration.
