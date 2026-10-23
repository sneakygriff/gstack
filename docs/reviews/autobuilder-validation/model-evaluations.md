# Ticket 07: retained model-evaluation status

Status: **external-blocked; no model evaluation executed; zero coverage credit**. This is a partial ticket deliverable, not completion of the validation specification. Source snapshot: `afda36d93c9f7876caa306184107fc9d8002471f`, which includes tickets 02/05. Both implementation prerequisites now exist; their existence does not satisfy the missing external evaluation prerequisite.

## Selected cases and evidence

The registered autobuilder workflow judge is `autobuilder-loop/SKILL.md workflow` in `test/skill-llm-eval.test.ts:592`. The periodic section case is `autobuilder-loop: a real run Reads run-setup.md, contracts.md, continuous-queue.md`, registered by `test/carve-section-loading-autobuilder-loop.test.ts` and `test/helpers/carve-guards.ts:100`. Neither ran. There are no observed section reads, score, provider usage or model identity from this ticket. Empty observed-read arrays mean not executed, not that an actor failed to read.

A no-dispatch public preview, `bun scripts/validation-select.ts --plan -- autobuilder-loop/SKILL.md.tmpl`, returned planned. It additionally selected the generic `carve-section-loading` family and the eleven periodic `journey-*` registrations through `*/SKILL.md.tmpl`. All selected IDs/reasons are retained in [model-evaluations.json](model-evaluations.json); none is silently credited, removed or counted as executed. This deliberately bounded preview is not the final full-diff dependency plan. No separate autobuilder role-judge ID was found in the current registrations. Broader reviewer-skill evaluation selection must come from the final actual change set rather than an invented role test.

The actual pure `readWorkflowJudgeInput` and `buildWorkflowJudgePrompt` functions were called without importing a test suite or provider client. They produced a 178,187-byte UTF-8 workflow prompt with SHA-256 `b49511d9d8d2432caa1cca6c671b41e5838a715ba52966929775527426495faa`. The JSON records the exact excerpt ranges and hashes for the generated entrypoint, every generated section and `review/checklist.md`, plus enumerated harness/config/lockfile hashes. These are verified candidate inputs, **not a completed evaluation receipt or full dependency-closure cache identity**. Runtime section-probe prompt hashing remains unavailable because it includes disposable fixture paths and no fixture was launched. Reuse of historical results has not been certified.

## External prerequisites

Presence-only environment checks again found no `ANTHROPIC_API_KEY`, `GSTACK_ANTHROPIC_API_KEY`, `OPENAI_API_KEY` or `XAI_API_KEY`. No credential files or values were read. The workflow judge invokes the Anthropic API directly (`test/helpers/llm-judge.ts:125`). Default judge/capture model is `claude-fable-5-1` and default judge budget is 8,192 tokens (`lib/eval-model.ts`). Existing subscription login cannot replace the registered API harness.

The section case calls `captureSectionReads` then `runSkillTest`, which launches a streaming Claude CLI under the existing hermetic environment (`test/helpers/auq-sdk-capture.ts:307`, `test/helpers/session-runner.ts:310-365`, `test/helpers/hermetic-env.ts`). Preserve isolation, model floors, retries and credit guards. Its scenario authorizes a readiness report, not implementation or nested provider dispatch.

Pinned Bun 1.4.0 is already available at `/Users/stefanandrei/Skill Master/autobuilder-efficiency-round1/.context/runtime/bun-darwin-aarch64/bun`. The earlier preflight verified it; default PATH Bun 1.3.14 is not a missing-runtime blocker. CI Claude is pinned to 2.1.251, while default local CLI reported 2.1.308. The inspected local versions directory did not contain 2.1.251, without ruling out another cache/container. Before execution establish the effective pinned Claude PATH because this harness directly spawns `claude`, and verify required tools under the isolated launcher. No install or runtime change was attempted.

## Prepared execution commands, not executed

Run from the frozen checkout after API access, effective runtime, completed cheap prerequisites, exact selection and artifact retention are established. Set `BUN_BIN_DIR` to the verified directory above and inherit credentials through the environment only. Pre-create private external `GSTACK_EVAL_DIR` and supply a unique `EVALS_RUN_ID`. Quality must precede behavioral evaluation when it consumes changed instructions.

```sh
PATH="$BUN_BIN_DIR:$PATH" EVALS=1 EVALS_TIER=gate EVALS_ALL=1 \
  bin/gstack-detach --label autobuilder-workflow --lock gstack-evals --timeout 1800 -- \
  bun test --retry 1 ./test/skill-llm-eval.test.ts \
  --test-name-pattern 'autobuilder-loop/SKILL\.md workflow'

PATH="$BUN_BIN_DIR:$PATH" EVALS=1 EVALS_TIER=periodic EVALS_ALL=1 \
  GSTACK_CARVE_SKILL=autobuilder-loop \
  bin/gstack-detach --label autobuilder-sections --lock gstack-evals --timeout 1800 -- \
  bun test --retry 1 ./test/carve-section-loading-autobuilder-loop.test.ts
```

These selectors cover one workflow judge and one periodic section case, **not the additional journey registrations or the entire integrated change set**. Reconcile wider selection before adoption. Existing `scripts/test-paid-shards.ts --tier gate --list` and `--tier periodic --list` are planning surfaces; the sharder has no general `--file` option. Do not fabricate one. Importing evaluation suites with `EVALS=1` may trigger an actual connectivity call (`test/helpers/anthropic-preflight.ts`); it is not a free preview. No `EVALS_PREFLIGHT_OK` bypass is authorized.

Preserve every configured attempt, failures, cancellations, public Read events, retained artifacts and true launcher exit. Section capture is 480s with a 600s outer case budget; retry remains 1 and the ordinary process wall 1800s. Recheck bounds if source changes. Applicable cached passing evidence must retain original provenance and match actual consumed inputs; skipped/unstarted cases never count as pass. Acceptance assembly must retain this ticket as blocked until these executions or valid applicable evidence exist.

Confidence: high in inspected input fingerprints and missing process API environment; no behavioral conclusion or savings claim. Remaining work is external environment readiness, complete frozen selection/reuse review, registered execution and receipt reconciliation. No tests, model calls or provider calls were made for this report.

## Final code selection update

At frozen code `9a7c8a2c`, explicit committed changes since `ce0fe916` select 242 model registrations (217 E2E, 25 judge) through the existing maps, including shared harness changes. This is registry selection, not executed cases or authorization for a broad paid run. The earlier bounded autobuilder preview remains historical and is not complete final coverage. [Final selection](final-selection.json) also retains 14 unknown/prior-map uncertainties and exit 2; automatic execution remains blocked. Native binding capability now exists for registered workflow judges and generic section probes, but no actual required evaluation has run. Complete input/environment declaration, supported runtime, credentials, cheap prerequisites and existing billing guards remain required.
