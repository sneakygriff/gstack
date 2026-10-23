# 03: Verify subscription execution lanes

**What to build:** Produce a secret-free readiness report for actual Codex, Claude and Grok lanes.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] Distinguish effective account identity, auth method, observed model, working transport and known quota evidence.
- [ ] Do not count two Claude profiles as independent pools without distinct effective identities.
- [ ] Use Grok CLI for Grok agents, verify the actual supported sandbox and tool transport.
- [ ] Do not switch accounts, buy credits, override billing guards or disclose tokens; unavailable facts remain unknown.
- [ ] Record timestamped observations and a bounded harmless transport probe where supported.
