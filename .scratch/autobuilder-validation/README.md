# Autobuilder validation task graph

Approved for implementation by the user invoking implement-spec in orchestrator mode.

Integration branch: `codex/autobuilder-validation`.
Implementation baseline: `ce0fe916` (approved specification, before ticket publication).
Tracker: one local issue file per ticket. No remote issue or PR.

Dependencies: 01 -> 02,05; 02+05 -> 07; 02+03+04+05 -> 08; 06+07+08 -> 09.
Independent initial frontier: 01,03,04,06.

Implementers use private worktrees and TDD at the confirmed public-command seam.
The registered model harness is the confirmed seam for model behavior.
Integration has one writer, with merges delegated to a merger subagent.
Grok agents must use authenticated Grok CLI, never an impersonated substitute.

Historical full-suite failures are evidence to classify, not failures to erase.
External prerequisites may leave a ticket blocked; a prepared protocol is not a completed live experiment.
Review gates, model floors, retries, credit guards and the installed skill remain unchanged.
