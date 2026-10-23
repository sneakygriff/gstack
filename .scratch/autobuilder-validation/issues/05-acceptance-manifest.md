# 05: Revision-bound acceptance manifest

**What to build:** Assemble a trustworthy acceptance view from validation plans, receipts and retained evidence.

**Blocked by:** 01: Strict focused test execution

**Status:** in-progress

- [ ] Separate passed, failed, skipped, cancelled and unexecuted checks, and preserve failure evidence.
- [ ] Reject incomplete or stale evidence; bind consumed inputs and relevant environment.
- [ ] Reuse applicable results with original provenance; documentation-only changes do not automatically invalidate unrelated inputs.
- [ ] Keep the historical 422 failures and later 50-test result separate, without arithmetic relabeling.
- [ ] Test public command behavior with positive and negative evidence controls.
