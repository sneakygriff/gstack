# Autobuilder round 1 - external review handoff

Latest follow-up: [remaining evaluator-count and harness-validation blockers resolved](blockers-followup.md)
(23 October 2026). The complete free suite remains failing; see the report for scope and evidence.

Follow-up: [F1, F2 and F4 implementation and validation](fixes-f1-f2-f4.md).
The original review record below is preserved; the follow-up records subsequent
changes and the failing full-suite acceptance result separately.

Both requested reviews completed on 22 October 2026. This commit records reviews and host verification only. No implementation fixes, active installation changes, push, PR, merge or deployment were performed.

## Exact review target

- Branch: `codex/autobuilder-efficiency-round1`
- Worktree: `/Users/stefanandrei/Skill Master/autobuilder-efficiency-round1`
- Base: `ba1a3153b3e39701f5966a2c805e876eec3f8d45`
- Reviewed head: `d218a7a552dd2e30565e21dce405a3aac6bdbbff`
- Implementation commits: `1c926337`, `d218a7a5`
- Scope: measurement, instruction trimming and deterministic helpers, preserving current review gates.

The reviews cover the implementation head, not this subsequent documentation commit. The diff contains 26 changed files; Fable's closing count of 27 is inaccurate. Some reviewer line numbers are approximate or incorrect; the issue log below points to the inspected head locations. Original wording is preserved; Grok trailing Markdown whitespace was normalized.

## Review evidence

- [Fable original response](fable.md): interactive Claude Code on the user-designated authenticated Max account. CLI displayed Fable 5.1; assistant transport metadata consistently reported `claude-fable-5-1`, with a final `end_turn`. Only Read/Grep/Glob tools were enabled. No headless print mode, API credential or credit-billing override was used. The session was closed after completion.
- [Grok original response](grok.md): authenticated grok.com web session, selector Auto. Exact backend model and provider usage are unverified. [Conversation](https://grok.com/c/51770b91-bc95-413c-a929-aa15be3e096f), [completion screenshot](grok-complete.png).
- [Common review brief](brief.md), [provenance and packet hashes](metadata.json), [Fable transport usage](fable-usage.json).
- Both received the complete diff and source packet. Fable additionally inspected local files. Grok reports partial test inspection and key-block rather than line-by-line inspection of the long generated reference. Fable lists its own uninspected regions. Neither review ran tests or serves as full release acceptance.
- Reviews were independent: neither received the other's findings. Subscription authentication and absence of credit overrides were observed; this is not an account billing audit or proof of independent Claude quota pools.

## Findings and dispositions

Reviewer priorities below are preserved, not automatically accepted. Both reported no P1. Fable reported three P2 and four P3 findings; Grok reported one P2 and one P3. Nine reported findings are logged below, plus advisory comments. No finding is fixed in this review commit.

| ID | Reviewer priority | Finding and corrected location | Host assessment / next-session action |
| --- | --- | --- | --- |
| F1 | P2 | Bare Bun launcher can execute the caller repository's preload: `bin/gstack-autobuilder-ops:1`. Existing hardened pattern: `bin/gstack-lane:1670`. | **Confirmed, high confidence.** The actual helper executed a harmless `bunfig.toml` preload in a disposable lane on Bun 1.4.0. This happens at startup, before helper state-lock acquisition. Prioritize launcher isolation. Use neutral cwd, explicit configuration/environment handling and the existing hardened pattern; adding two flags alone is not established as sufficient. No malicious state-write demonstration was attempted. |
| F2 | P2 | Helper errors collapse to generic text: `bin/gstack-autobuilder-ops:8`; lock at `lib/autobuilder-ops.ts:27`; Git failure at `:11`. | **Confirmed diagnostics gap, high confidence.** A held lock and symlink failure return no cause on stderr. Add bounded, non-sensitive reason codes and lock-recovery guidance while retaining failure status and bounded retries. Never echo secrets, unrestricted paths or raw Git stderr. |
| F3 | P2 | Untracked symlinks/nonregular entries fail the meter; bounds and whole-file reads introduce limits: `lib/autobuilder-ops.ts:10`, `:61`, `:63`. | **Behavior confirmed; defect classification disputed.** Symlink failure is an explicit documented fail-closed choice. The old pipeline followed file symlinks; not all such inputs counted as zero, and FIFO reads could block. Do not adopt blanket zero-counting or silent ENOENT skipping: either could undercount a ship unit. Review transient-file handling and streaming separately, with explicit evidence/error semantics. Timeout/buffer/OOM cases were not reproduced. |
| F4 | P3 | Missing-reference policy conflicts with L2 fallback-to-memory wording: `autobuilder-loop/autobuilder-unit.js:755` versus `:790`. | **Textual conflict confirmed, high confidence; runtime bypass not reproduced.** Make L2 follow the same incomplete/invalid rule and add a missing-reference fallback scenario. Keep the current gate and completion-marker requirements. L2 does have Read/Grep/Glob; lack of Bash is not proof it cannot read the reference. |
| F5 | P3 | Helper rejects non-absolute paths without workflow argument diagnostics: `lib/autobuilder-ops.ts:24`, `:51`; entry at `autobuilder-loop/autobuilder-unit.js:1961`. | **Confirmed input restriction; low-risk compatibility edge.** Documented setup supplies absolute paths. Consider early validation with a clear error; do not silently expand arbitrary shell syntax. Old `~` behavior depends on the call's quoting and was not verified. |
| F6 | P3, hypothesis | Checkpoint measurement couples prompts to response lengths: `autobuilder-loop/autobuilder-unit.js:393`, `:491`. | **Unverified cache impact.** Exact cached replay should preserve responses and lengths; a changed earlier response may appropriately invalidate later prompts. Inspect actual Workflow cache semantics and add a replay experiment before changing measurement or claiming a regression. |
| F7 | P3 | Response length uses serialized raw return values, counters add prompt overhead, model keys are argument-derived: `autobuilder-loop/autobuilder-unit.js:503`, `:513`. | **Measurement caveats, no demonstrated defect.** Only character counts persist, not raw strict-schema payloads. Including measurement overhead in the after total is appropriate. Consider bounded model labels and clearer serialized-response documentation; do not relabel this as token/billing usage. |
| G1 | P2 | Old inline meter commands remain top-level permitted: `autobuilder-loop/SKILL.md.tmpl:78` (generated `SKILL.md:488`). | **Wording verified; bypass is hypothetical.** Align the allowed-command paragraph with the required helper recipe. Permission to execute a Git command alone does not prove an agent used it instead of the helper. |
| G2 | P3 | Extracted reviewer reference retains interactive planning text: `autobuilder-loop/sections/seat-c-review.md:106`, `:244`. | **Advisory, not established as a new defect.** The preface explicitly prohibits questions/writes and the original prompt also had skip rules. Improve clarity only while retaining evaluation criteria; test reviewer behavior rather than adding repeated banners by default. |

## Advisory comments to retain

1. **Review methodology coverage (Fable).** Inspect omitted Important Rules/slop-scan content and dangling references to Decision procedure / Steps 4.6 and 5.8. The parent already requires the full diff and missing-reference failure. Fable's broad statement that diagrams were dropped is not wholly accurate: generated reference lines 46-48 retain Documentation and diagrams, with further diagram criteria at 65/75. Check any narrower omitted subsection separately.
2. **Preflight coverage (host observation, not a reproduced defect).** The extractor starts the core block at `Apply both checklist passes...` (`scripts/resolvers/autobuilder.ts:12`), after `QA_REVIEW_PREFLIGHT` (`review/SKILL.md.tmpl:158`). Determine which read-only methodology obligations apply to Seat C before claiming complete semantic equivalence; do not add QA probes or change gate roles by default.
3. **Extractor boundaries (Fable).** Literal headings fail closed when missing, but can select the wrong occurrence after source restructuring. The current containment test derives expectations from the same declared ranges. Consider an independent requirement inventory and boundary-order/uniqueness assertions when repairing extraction.
4. **Savings framing (Fable/Grok).** The 67.3% result is a direct-required-file character comparison, not measured actual reading, tokens, quota, latency or review quality. The previous prompt instructed full skill reads with skipped procedures, so Fable's claim that the number necessarily overstates practical savings is also unverified. Live equivalent runs must resolve this. The mock dispatch count remains 33 to 33.
5. **Test naming (Fable).** `test/autobuilder-ops.test.ts:68` says extra arguments but exercises malformed JSON. Add a real extra-argument assertion or rename it when working on helper validation.
6. **Positive observations, not acceptance.** Both reviews found no changed gate algorithm; Fable found judge wiring/count updates consistent and operative rules retained after rationalization removal. Grok accepted the measurement disclaimers and atomic state structure. Neither establishes unchanged live defect detection or complete packaging correctness.

## Host verification

[Verification results](verification.json) record three small checks against the actual helper at the reviewed head, in an owned disposable Git repository using Bun 1.4.0. No product code was edited.

- A `bunfig.toml` with `preload = ["./preload.ts"]` and a preload containing only `console.log("REVIEW_FIXTURE_PRELOAD_EXECUTED")` emitted that marker before `SHIP_METER` when the actual bin was executed from that directory. Exit 0. Environment overrides were removed before the check, so this demonstrates cwd-config loading, not an inherited preload.
- A dangling untracked symlink returned exit 1 and generic meter-failure stdout, with empty stderr.
- An existing `.state.lock` directory returned exit 1 and generic state-failure stdout, with empty stderr.

These checks support F1, F2 and the factual portion of F3. They do not reproduce every claimed risk, model instruction conflict, Workflow replay behavior, or entire application flow. The temporary fixture was removed.

## Next session

Start with this file and the original reviews. Keep all changes on this isolated branch. Suggested order: isolate the helper launcher (F1), add safe diagnostics and lock guidance (F2), reconcile L2 missing-reference instructions (F4), then decide which advisory trims/tests merit changes. Preserve current review gates and fail-closed meter behavior. The user requested review logging now; implementation of review fixes is deferred to the next session.

Before rollout, finish the outstanding acceptance work in [the implementation report](../../designs/AUTOBUILDER_EFFICIENCY_ROUND1.md). The prior full free suite exited 1; only five representative failures were reproduced on the exact base. Focused repairs passed, but no full green rerun exists. The paid quality judge and a live equivalent-unit measurement trial remain unrun. These external subscription reviews do not replace those gates.

Confidence: high in the observed review provenance, source contradictions and three fixture results; medium in overall defect coverage; low in untested replay, latency, quota and live reviewer-quality effects.
