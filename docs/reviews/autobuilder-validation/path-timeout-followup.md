# Path repairs and timeout diagnosis - 23 October 2026

Status: path repairs verified locally; historical timeouts unresolved. Adoption remains blocked. This follow-up does not replace the retained incomplete full-suite outcomes or supply model-evaluation credit.

## Confirmed path defects

- `ee337305`: the remote-path negative fixture now lives in an owned directory outside TEMP_DIR, independent of checkout location. The native privacy check separately verifies the permitted absolute skill path, removes only that exact path, then checks forbidden prose. Its fixture path includes both `private` and `reasoning` to exercise the collision.
- `c3e1def3`: traversal fixtures target the forbidden `/etc/passwd` independently of cwd depth. Remote-serving asymmetry is tested through the actual local and remote validators in an owned project outside TEMP_DIR. Temporary roots are compared by their resolved directories where aliases are equivalent; the raw allowlist-source checks remain.
- `90e6add2` relink follow-up: a retained failing case reproduced `/bin/sh: /Users/stefanandrei/Skill: No such file or directory`. The real repository executable and migration path now use argument-vector execution, preserving spaces. The helper retains cwd, environment isolation, failure handling and the existing 10-second child timeout. This is a launcher repair, not evidence that historical relink timeouts are fixed.

Only test files changed. Production validators, review instructions, gates, budgets and thresholds are unchanged. A read-only independent review found no actionable defects in the final deltas.

## Focused evidence

Evidence directory: `/Users/stefanandrei/Skill Master/research/validation-path-fixes/`. Original failures are retained. File names containing `green` or `red` describe intended probes; their exit and terminal summary determine the actual verdict.

| Run | Actual result | Scope |
| --- | --- | --- |
| `paths-adjacent` | 107 pass, 0 fail, 993 assertions | First path batch, four files |
| `paths-final-adjacent` | 113 pass, 1 fail | Exposed raw alias equality defect; retained |
| `paths-temp-checkout-green` | 113 pass, 1 fail | Exposed filtered alias spelling; retained despite filename |
| `paths-final-normal` | 114 pass, 0 fail, 1,010 assertions, 4.75s | Five adjacent files in normal checkout |
| `relink-adjacent-green` | 63 pass, 1 fail, 241 assertions | All 61 relink cases passed; static timeout detector rejected common-options syntax |
| `relink-final` | 64 pass, 0 fail, 241 assertions, 81.78s | Relink and spawn-timeout tripwire after making the same limits explicit at each call |
| `paths-final-temporary` | 114 pass, 0 fail, 1,009 assertions, 4.27s | Same five files from a deep owned temporary cwd |

The one-assertion difference comes from checking each raw allowlist entry: the ancestor filter removes one alias spelling in the temporary-cwd topology. Both runs retain the fixed canonical TEMP_DIR. Sources remained unchanged during each final matrix run. Runs overlap and must not be summed. Pinned Bun 1.4.0 is byte-identical to the historical runtime, SHA-256 `539598c775882420b9d8deb7dc14d845f20f7d26f5600c50ab067dde6ac3f3bf`. No providers were invoked.

## Timeout diagnosis

The exact shared-libs valid lifecycle case previously timed out at 30 seconds. Its consumed source is unchanged between the historical failing revision and these probes. It now passes alone (94 assertions, 14.59s), in three concurrent instances and in six concurrent instances (approximately 14.6-15.3s each), all at the existing limits. Six processes alone therefore do not reproduce the failure in the present environment.

An actual `runFreeShard` invocation preserved default environment isolation, process-group supervision, cleanup, the 30-second test limit and outer wall. Only the exact case selector was appended. It passed with 94 assertions in 12.80s; terminal capture was complete and cleanupError was null. The three formerly failing Codex lifecycle cases also passed with 14 assertions in 7.10s under their original deadlines.

External timing probes located repeated observer and review-log startup costs. A single interpreter-only prototype improved one sample, but neither demonstrates a timeout cause nor justifies a production repair. No such speculative change was applied.

Historical evidence lacks underlying fixture-command diagnostics, Node/Git executable identity and host-load measurements. Bun identity and directly consumed source are matched; complete environment equivalence cannot be established. The original isolated failure already occurred without a preceding test file, so preceding-file contamination is not a sufficient explanation.

The 30-second lifecycle timeout and the six-shard 1,041-second timeout remain **unreproduced and unresolved**, not repaired or dismissed as pre-existing. No full-suite rerun, deadline increase, retry increase or skipped gate was used. Next useful evidence is a bounded reproduction retaining the failing inner command and runtime identities before fixture cleanup. Repeating green samples or another unchanged complete suite would not establish a cause.

Detailed diagnostic record: `lifecycle-diagnosis.md`, `lifecycle-diagnosis.json`, `lifecycle-actual-shard.json`, associated raw logs, and `codex-lifecycle-baseline.log` in the evidence directory.

Final test-code revision: `90e6add2128280b29bbb372ce9b1bfc5138ab28e`. The changed test diffs passed whitespace checks and credential scans with zero HIGH, MEDIUM or LOW findings. The installed skill checkout remains clean at `ba1a3153b3e39701f5966a2c805e876eec3f8d45`. Branch changes are local and committed; no install, push or release action was taken.
