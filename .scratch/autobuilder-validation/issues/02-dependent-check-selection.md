# 02: Select dependent validation checks

**What to build:** Preview and execute relevant checks for skill structure changes using existing registries and the strict focused runner.

**Blocked by:** 01: Strict focused test execution

**Status:** done

Implementation integrated; pinned Bun 1.4.0 revalidation is pending after the merger verified that retained worker runs used Bun 1.3.14. Functional acceptance evidence below remains historical and is not relabeled.

- [x] Cover template/reference freshness, always-loaded contracts, section registration, context/parity and affected supervision.
- [x] Show selection reasons; preview launches no test, monitor or model.
- [x] Separate free checks and model evaluations; unknown mapping remains explicit and never silently triggers paid work.
- [x] Use existing registries rather than a competing dependency map; test changed and unrelated inputs through the public command.

## Completion evidence

- Implementation `06071f40`, parser follow-up/final worker tip `57b05765cc65e33e98c592ebcdc07eb731e1fa8b`; merged with `--no-ff` at `943b20ccd777d1b7337bea98242c2e529710d2e0`.
- Public command `scripts/validation-select.ts` selects free checks from additive `FREE_TOUCHFILES` relationships in the existing literal registry and model work from existing paid maps/tiers plus `CARVE_GUARDS`. Existing paid selection policy, floors, retries and billing guards are unchanged. Unknown source/registry changes block execution; explicit preview launches no process, while base preview only reads Git. `--run-free` delegates to the strict runner and never dispatches model checks.
- Final public-command run at final worker tip: 12 pass / 0 fail / 0 skip, one file. Earlier adjacent checks: 122 pass / 0 fail / 0 skip across six files, before the final parser repair; unchanged registry/profile/tripwire evidence is reused. Separate actual all-host scratch freshness check: 1 pass / 0 fail / 0 skip. These overlapping runs are not added into one total.
- Runtime for all ticket 02 evidence was Bun 1.3.14 (`d1632b29`), `TMPDIR=/private/tmp`, not the Bun 1.4.0 used by some earlier tickets. This closure does not claim verification on another runtime or final release acceptance.
- Retained evidence: `/Users/stefanandrei/Skill Master/research/validation-orchestration/02-evidence/index.json` and its `final-public`, `focused`, and `freshness` receipts/logs. Merger read those receipts and matched all seven changed-file SHA-256 values against the final branch.
- Clean tracked state/current ancestry and scoped seven-file diff verified; merge was conflict-free and whitespace check passed. No tests, full suite, providers, package edits, installed-skill changes or review-gate changes were performed during integration. Parent owns the package alias.

Pinned-runtime verification: Bun 1.4.0 confirmed by executable path/version and child logs; public CLI 12 pass, adjacent six files 123 pass, freshness 1 pass, all zero failures/skips. Separate runs overlap and are not summed. Evidence: research/validation-orchestration/02-evidence/bun-1.4.0 in the surrounding workspace. Earlier Bun 1.3.14 records remain historical.
