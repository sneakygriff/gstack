# 01: Strict focused test execution

**What to build:** Run an explicit selection through the existing supervised free runner and certify only the files actually executed.

**Blocked by:** None (can start immediately)

**Status:** in-progress

- [ ] Reject nonexistent or invalid selectors before any test child starts; exact paths, spaces, duplicates and empty selection have explicit behavior.
- [ ] Expose a side-effect-free plan and a structured receipt through the public command.
- [ ] Reconcile expected and observed files, terminal summary, capture integrity and real exit status; incomplete evidence cannot pass.
- [ ] Retain diagnostics for failures, module-load errors, timeouts and cancellation; use existing supervision and log ownership.
- [ ] Demonstrate red then green at the approved public command seam using isolated fixtures.
