# Remaining autobuilder validation blockers

Completed 23 October 2026 (Europe/Bucharest), on the existing isolated branch
`codex/autobuilder-efficiency-round1`, starting from `a088b4f8` plus the preceding
uncommitted F1/F2/F4 fixes. Two implementation subagents owned separate files and
cross-reviewed each other's changes. Changes remain local and uncommitted; no
push, merge, deployment or active installation change was performed.

## Evaluator count and aggregate supervision

The quality suite already registered 18 workflow judges and seven ordinary judges,
including the autobuilder judge. Both the supervision formula and its count
assertion still used 17 workflow judges. This was an undersized aggregate window,
not just an obsolete expected value in a test.

`test/helpers/eval-budgets.ts` now reserves:

```text
(18 * 130,000 + 7 * 120,000) * 2 + 120,000 = 6,480,000 ms
```

The increase from 6,220,000 ms accounts for the already-registered additional
workflow case and its existing retry. The model-work limit stays 120 seconds per
case; workflow recording grace, one retry, cleanup reserve and gate criteria are
unchanged. Existing CI and detached-runner caps cover the recomputed limits, so
their configuration was not changed.

The supervision assertions and affected aggregate-floor assertions in
`test/eng-finding-retry-budget.test.ts` were updated to match the live manifest.
`docs/TESTING_INTERNALS.md` now documents 25 cases, 18 workflow judges, seven
ordinary judges and the correct 6,480-second aggregate window.

## Harness validation

The harness executed the production Workflow through a path-based adapter, but
the test-only-code detector could not recognize that production dependency.
`test/autobuilder-unit-harness.test.ts` now imports the real Workflow as text,
uses those bytes in its existing source-safety assertions, and checks exact byte
identity with the adapter's loaded source. Text loading does not execute Workflow
top-level code; execution stays inside the existing harness.

The detector, its baseline, and its classification rules are unchanged. No
exception, unused import or cosmetic path was added. Existing F4 scenarios and
all production gate code are preserved.

## Verification

Used the existing pinned Bun 1.4.0 with canonical `TMPDIR=/private/tmp`.

| Check | Result | Local evidence |
| --- | --- | --- |
| Original evaluator failure | Reproduced: 0 pass / 1 fail | `.context/blockers-judge-before.log` |
| Original harness-classification failure | Reproduced: 1 pass / 1 fail | `.context/blockers-ratchet-before.log` |
| Supervision, budget policy, detached limits, selection and dependency checks | 123 pass / 0 fail | `.context/blockers-judge-focused.log` |
| Shards, manifests, overlay scheduling and CI wiring | 73 pass / 0 fail | `.context/blockers-judge-scheduling.log` |
| Complete harness, unchanged detector and subprocess timeout tripwire | 301 pass / 0 fail | `.context/blockers-harness-ratchet.log` |
| Complete adjacent Eng budget file | 42 pass / 2 fail, versus 41 pass / 3 fail before | `.context/blockers-judge-adjacent-before.log`, `.context/blockers-judge-adjacent-after.log` |
| Credential scan and whitespace checks | Passed | `.context/blockers-credential-scan.log`, tool results |
| Independent cross-review | No actionable findings | Subagent results |
| Complete free suite | Exit 1: 22,304 pass / 410 skip / 421 fail across 936 files | `.context/blockers-full-free.log`, `.context/blockers-full-counts.json` |

Focused selections overlap and must not be summed as distinct test coverage.
The separately filtered Eng check is supplemental evidence, not complete-file
acceptance. Its two remaining failures concern the previously reproduced
outside-voices inventory: 73 versus 71 periodic files, and 107 versus 105
discovered files. Those census assertions were not changed in this scope.

The complete run confirms the repaired paths: supervision 42 pass / 0 fail;
test-only-code detector 2 pass / 0 fail; autobuilder harness 296 pass / 0 fail.
All 15 files in `.context/blockers-source-manifest.json` matched their frozen
hashes after the run. The previous F1/F2/F4 source hashes also remain identical
except for the intentional harness dependency repair. Prior build/generation
checks were reused because their consumed production inputs did not change.

## Remaining limits

The two requested blockers are resolved, but the complete free suite remains
failing. Full-run comparison, nested-output accounting and cleanup diagnostics
are recorded in `.context/blockers-triage.md`. No broad claim is made that every
remaining failure is environmental or reproduced on the base revision.

The strict runner lists 464 failure names, including 43 additional nested-child
names beyond the 421 outer failures. Compared with the preceding full run,
three repaired assertions no longer fail, two other cases changed outcome without
an established cause, and one relink test newly reached its existing 10-second
subprocess timeout. That timeout remains uninvestigated in this scope.

Before this run, retained browser state from the preceding run was inspected:
the old runner was absent and no process command referenced either retained
directory. This does not retroactively prove the preceding cleanup. The current
runner also reports unconfirmed owned-process cleanup. No uncertain-identity
process was forcibly terminated and no blind full-suite retry was performed.

No paid judge or live equivalent-unit trial ran. These changes repair test
supervision and dependency validation; they do not establish live reviewer quality
or complete rollout acceptance. Confidence is high in the two scoped repairs,
supported by their reproduced failures, focused checks and full-run results.
