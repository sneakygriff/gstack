# 04: Measure observed usage by phase and role

**What to build:** Turn retained provider events into reproducible usage reports bound to consumed inputs.

**Blocked by:** None (can start immediately)

**Status:** done

- [x] Use stable event/attempt identity to deduplicate; retain phase, role, source/instruction fingerprints and original evidence references.
- [x] Report tokens, cache, retries and duration only when available; unknown is not zero.
- [x] Distinguish helpers from model calls and observed usage from estimates or invoice charges.
- [x] Test through a public command with controlled provider records, duplicates, missing fields and invalid input.

## Completion evidence

- Implementation: `cc5305cf`; worker integration: `2df9f4d3`; merged with `--no-ff` at `5311a7d43a1f36f6ddcce1828cf3c6dada9c0558`.
- Public command and contract: `scripts/autobuilder-usage.ts` and `docs/autobuilder-usage.md`. Retained Fable normalization input and actual report are in `docs/reviews/autobuilder-validation/usage-example-{input,report}.json`.
- Focused verification on worker integration revision, reused because merged consumed inputs are unchanged: Bun 1.4.0, 12 pass / 0 fail / 128 assertions across `test/autobuilder-usage.test.ts`, `test/spawnsync-timeout-tripwire.test.ts`, and `test/autobuilder-efficiency.test.ts`. Retained log: `/Users/stefanandrei/Skill Master/research/validation-orchestration/04-tests.log`.
- Merger reviewed the scoped five-file diff and handoff, verified clean tracked integration state and current integration ancestry, merged without conflicts, and passed `git diff HEAD^1 --check`.
- Evidence references and consumed-input fingerprints are retained caller claims; the adapter computes only normalized-input SHA256. Historical observed usage is not live benchmark evidence or acceptance. No full suite or external provider was run for this merge.
