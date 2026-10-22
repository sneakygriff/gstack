# F1, F2 and F4 implementation follow-up

Subsequent work: the evaluator-count and harness-validation blockers listed below
were repaired in the [23 October follow-up](blockers-followup.md). This report
preserves the earlier verification results.

Implemented on `codex/autobuilder-efficiency-round1` in the isolated worktree,
starting at `a088b4f8`. The changes are currently uncommitted. Three implementation
subagents owned separate files, followed by independent cross-review and host
integration checks. No active installation, push, merge or deployment was performed.

## Changes

- **F1:** `bin/gstack-autobuilder-ops` is now a Bash launcher. It resolves the Bun
  executable before changing directory, creates a private neutral working
  directory, disables dotenv/config autoloading, strips inherited `BUN_*`,
  `NODE_OPTIONS` and `NODE_PATH`, then invokes `lib/autobuilder-ops-cli.ts` with
  literal arguments. Failure to establish isolation fails closed; there is no
  fallback to the caller's directory. The temporary directory is removed after
  normal completion or an operation failure. Production callers already invoke
  the executable directly; the two tests using `bun <launcher>` were corrected.
- **F2:** the operation library exposes typed, allowlisted failure reasons.
  The CLI retains existing stdout success/failure markers and exit status, with
  bounded diagnostic stderr. Held-lock guidance requires checking the active
  writer and pending checkpoint before manual cleanup. It never automatically
  deletes another writer's lock or increases the existing retry limit. Raw
  exception messages, requests, filesystem paths and Git stderr are not relayed.
  Resume guidance is updated in the template and regenerated skill.
- **F4:** the L2 brief now requires `REVIEW_INCOMPLETE` when the required rubric
  or checklist is missing or unreadable. It prohibits substituting remembered
  methodology or emitting `REVIEW_COMPLETE` in that case. Four regressions execute
  the actual emitted adjudication block and exercise the workflow's existing
  retry, block, critical-gate and restored-reference paths.

Gate algorithms, completion-marker syntax, model floors and retry caps are
unchanged. Symlink/nonregular untracked files, Git failures and held locks still
fail closed. State preservation and the historical nullable unavailable Git HEAD
behavior remain intact. F3 and the other advisory findings were not expanded into
this repair scope.

## Verification

Runtime: existing local Bun 1.4.0, matching the prior prepared verification, with
canonical `TMPDIR=/private/tmp`. No runtime or active skill installation was changed.

| Check | Result | Local evidence |
| --- | --- | --- |
| Launcher, operations and synchronous-spawn timeout tripwire | 26 pass, 0 fail | `.context/fixes-launcher-ops.log` |
| Full workflow harness and synchronous-spawn timeout tripwire | 298 pass, 0 fail | `.context/fixes-harness.log` |
| Efficiency, forum divergence, parity, context budget, generator checks, installation assets, judge inputs/cache | 143 pass, 0 fail | `.context/fixes-adjacent.log` |
| All-host generation and full build | Exit 0 | `.context/fixes-generation.log`, `.context/fixes-build.log` |
| ShellCheck, Bash syntax, whitespace checks | Passed | Tool results |
| Credential scan of changed tracked files and both new source/test files | Exit 0 | `.context/fixes-credential-scan.log` |
| Independent cross-review | No actionable findings | Subagent results |
| Complete free suite | Exit 1; 22,299 pass, 410 skip, 425 fail across 936 files | `.context/fixes-full-free.log`, `.context/fixes-full-counts.json` |

The focused selections overlap; their totals must not be added as distinct tests.
The first two logs are explicitly labeled copies of completed tool transcripts,
not extra reruns. The launcher tests include a positive control proving bare Bun
executes the same preload fixture that the hardened launcher rejects.

All five autobuilder test files passed in the full run: efficiency (3), operations
(18), forum divergence (9), workflow harness (295), and launcher (5), for 330
passing cases and no failures in those files. The nine changed code, test and
generated files matched `.context/fixes-source-manifest.json` before and after
the complete run.

## Acceptance limits

The complete free suite is **not green**. Five observed failure cases have matching
causes in the previously recorded exact-base verification: the unquoted build
path, two file-URL expectations, numeric UID observation, and a native fixture
launcher failing with ENOENT. Prior occurrence in an earlier log is not proof that
every remaining failure is present on the base revision. The full inventory and
comparison are retained in `.context/fixes-triage.md`.

The strict runner lists 468 named failures because 43 additional names come from
nested test subprocesses; the outer Bun total is 425 failed cases. No explicit
unhandled-between-tests banner was found, and the runner reported zero crashed
workers. Of the strict names, 467 also appeared in the previous run after
normalizing transient fixture paths. One newly observed CSO snapshot failure
(`ls-tree` rejected as an unsupported invocation) remains unresolved.

The failing suite is not entirely an environmental issue. Two prior-round
autobuilder acceptance blockers remain: a supervision assertion expects 17
workflow judges but observes 18, and the test-only-import ratchet flags the
existing workflow harness. They were already present before these F1/F2/F4
changes; neither has been waived or repaired in this scope.

The runner also reported unconfirmed browser cleanup in shards 2 and 4 and retained
their temporary state. No uncertain-identity process was forcibly terminated.
Skipped cases and unconfirmed cleanup do not establish coverage or release readiness.

No paid judge ran: `ANTHROPIC_API_KEY` was absent. No live equivalent-unit trial
ran. The L2 tests establish deterministic workflow/adjudication behavior with
scripted reviewer responses; they do not establish live model compliance or
unchanged reviewer quality. Bun startup isolation does not claim protection from
a malicious executable deliberately selected through PATH or unrelated shell
startup mechanisms.

Confidence is high in the scoped deterministic fixes and retained gate behavior.
Overall rollout acceptance remains incomplete because of the failing full suite,
unconfirmed browser cleanup and unrun paid/live checks. No full-suite rerun was
attempted without a concrete repair.
