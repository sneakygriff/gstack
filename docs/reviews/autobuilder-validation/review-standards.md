## Standards

Reviewed `git diff ce0fe916d2550b21d6eb116aee483786060f730f...efe2c8cfcbc4ef1d30446e9127fd72a508dcb4b5` against AGENTS.md, CLAUDE.md, CONTRIBUTING.md, ETHOS.md, docs/test-value-bar.md and its authoritative scripts/resolvers/test-value.ts. Tooling-enforced style items were excluded.

1. **[P2] Public launcher validation is masked by the fixture wrapper.** `test/test-focused.test.ts:18-20` always inserts `command, '--root', root, ...args`; consequently the tests do not exercise the documented/default-root command or new package alias. This conflicts with AGENTS.md Validation discipline step 6: “Preflight the actual launcher” and “Match the runtime versions pinned by the workflow.” On pinned Bun 1.4.0, direct `bun scripts/test-focused.ts -- test/x.test.ts` and the actual `bun run test:focused -- <path>` alias both exit 1 with `Unknown option` before selection: Bun consumes the first delimiter, while `scripts/test-focused.ts:34-42` rejects positional paths. Add a public-command case without the injected root and repair positional parsing or the published invocation. This is the already-listed CLI issue, not an additional independent defect.

No further high-confidence documented-standard violations or material Fowler-baseline smells found. Existing exported helpers have production callers; the new freshness wrapper exercises the existing generated-output contract; isolated command tests assert observable behavior. I did not flag those as speculative abstractions or low-value tests.

Confidence: high for the launcher finding; medium for absence of other standards issues. Review was read-only in the repository. Two tiny preflight reproductions used a disposable external fixture, no test child/provider execution occurred, and tracked state remained clean. No full suite or gates ran. The historical inventory JSON was treated as evidence data, not exhaustively re-audited.

Standards total: 1 documented-standard finding (known launcher issue), 0 heuristic findings.
