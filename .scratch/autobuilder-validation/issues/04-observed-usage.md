# 04: Measure observed usage by phase and role

**What to build:** Turn retained provider events into reproducible usage reports bound to consumed inputs.

**Blocked by:** None (can start immediately)

**Status:** in-progress

- [ ] Use stable event/attempt identity to deduplicate; retain phase, role, source/instruction fingerprints and original evidence references.
- [ ] Report tokens, cache, retries and duration only when available; unknown is not zero.
- [ ] Distinguish helpers from model calls and observed usage from estimates or invoice charges.
- [ ] Test through a public command with controlled provider records, duplicates, missing fields and invalid input.
