<!-- AUTO-GENERATED from continuous-queue.md.tmpl — do not edit directly -->
<!-- Regenerate: bun run gen:skill-docs -->
# Host executor, shared exploration and continuous admission

Experimental, opt-in execution for one approved ship-unit. The existing static-wave
Workflow remains the fallback. This queue builds and integrates; it does not review,
publish, merge the release branch or deploy. All routing/model floors and release gates
in `contracts`, `gate` and `release` still apply.

## Host boundary

Use the host's existing command and background-agent tools. Invoke the installed
`bin/gstack-autobuilder-ops` executable with an operation and one literal JSON argument.
On Claude this is Bash plus Agent; on Codex it is the host command tool plus a background
worker. This is not a new Workflow API. Do not inject an imaginary `exec()` into Workflow.
Keep JSON in an owned request file and pass its contents as one quoted argument; never
interpolate task text into executable shell source. Inspect exit status and structured
result together. A missing helper, malformed response or nonzero exit blocks that action.

The helper provides queue admission, private worktree creation, state writes, guarded
commits, clean integration, named checks and size measurement without model calls.
The host launches judgment work and handles conflicts, failed checks, limits and ambiguous
recovery. It does not delegate these mechanical helper calls to a bookkeeping model.
Known checks execute explicit argv arrays, with deadlines, bounded output and owned
process-group cleanup. One completion holds the integration lock through checks and commit;
heavy host checks are consequently serialized. Worker-side heavy resources must also be
reserved explicitly, including databases, ports, generated outputs and lockfiles.

## Prepare the task contract

Have the existing planning/refresh agent produce narrow end-to-end task briefs. Include
acceptance criteria, approved public test seams, exact named checks, dependencies, write
prefixes and resource keys. Scope approval propagates to those exact contracts; a new
interface or material scope change goes back to the decision owner. A dependency unlocks
only after successful integration and affected checks, not after a worker says DONE.

Create a JSON contract for `queue` action `init`:

```json
{
  "action": "init",
  "contract": {
    "version": 1, "unit": "U1", "repo": "/absolute/repository",
    "lane": "/absolute/private-integration-worktree",
    "runDir": "/absolute/run-state-outside-both-worktrees",
    "base": "FULL_IMMUTABLE_UNIT_SHA", "shipBase": "FULL_IMMUTABLE_SHIP_SHA",
    "branch": "unit-branch",
    "mode": "continuous", "maxWorkers": 2,
    "exploration": "/absolute/run-state/exploration.json",
    "integrationChecks": [{"name":"unit", "argv":["bun","test"], "timeoutMs":600000}],
    "tasks": [{
      "id":"T1", "dependencies":[], "writes":["src/feature","test/feature.test.ts"],
      "resources":["test-database"], "brief":"/absolute/briefs/T1.md",
      "checks":[{"name":"unit", "argv":["bun","test","test/feature.test.ts"], "timeoutMs":600000}],
      "tier":"T2", "impl":"codex", "estimate":1, "noteSections":["feature-api"]
    }]
  }
}
```

Paths and revisions above are placeholders, not defaults. The integration lane must
already exist on that branch at the exact unit base and be clean. `shipBase` is the
current `SHIP_BASE_FILE` value, which may precede the unit base; never substitute the
unit base for it. Initialization refuses a new unit at 2,000 unshipped production LOC;
admission stops at 2,500 measured from this original ship base. Run state must be outside
both worktrees. Tasks have unique identifiers and an acyclic dependency graph. `writes`
are repository-relative exact files or directory prefixes, not globs. Declare semantic
resources even when files do not overlap. `estimate` is a scheduling weight, not a measured
duration; the longest remaining dependency path wins admission ties. Maximum concurrency
is three, default to two in the pilot. `mode: waves` uses the same isolation but waits for
all active tasks before admission. The original Workflow wave path is also retained.

Host capacity comes from verified account identity and availability. Reserve review
capacity, retain credit guards, and do not count two aliases for one account as two pools.
Task metadata names the requested family/tier; the host applies the full routing chain,
records observed model identity and preserves any unavailability decision. No provider
credential or credit override belongs in the contract.

## Shared exploration

Explore the feature once at the immutable base. Produce short sections containing
interfaces, constraints, approved testing seams, commands and unresolved questions. For
an external API/version claim, record its source/version and uncertainty in the text and
include the local lockfile/config that determines that version among the inputs. Do not
pretend file hashes verify changing remote state; revalidate such claims when needed.

`exploration` action `capture` takes `repo`, `base` and `sections`, each with `id`, `text`
and `inputs` (tracked relative file paths). Save its returned versioned snapshot outside
the product checkout. Each task selects only its relevant `noteSections`. Dispatch the
brief and those sections by path, not the full parent conversation or every project note.

Admission compares each selected input hash to current integration source. Completion
also checks the pinned note bytes and current inputs, so another task cannot silently
invalidate a worker's assumptions. Missing/stale inputs block the task. Re-explore only
affected sections, then create a new approved unit/contract for any task requiring a
changed brief or snapshot; do not mutate an active task's contract to manufacture validity.
Current source and acceptance criteria outrank the note. No uncertainty is converted to
an asserted fact by hashing it.

## Continuous host loop

Serialize helper commands. Launch and bind the entire admitted batch before waiting for
completion; do not overlap `complete` with `next`, `bind`, another completion or `cancel`.
Only model workers run concurrently. A busy/orphan lock is not permission to retry blindly.
Run `complete` in the host's owned background-process facility (or `gstack-detach`) with
a deadline of at least the admitted job's `completionTimeoutMs`, which includes all named
check deadlines and command/cleanup allowance. Keep the process/session handle and private
output log, wait for terminal exit, then parse its structured result. Do not run a long
completion in a short foreground Bash timeout. Timeout, signal or lost result requires
reconciling status/receipts before further commands; never infer success or rerun a merge.

1. Call `queue` with `{"action":"next","runDir":"..."}`. It persists reservations
   before returning newly admitted jobs, including attempt ID, private cwd/branch and
   immutable base. Every implementer, including the first Claude worker, uses that cwd.
2. Launch each returned job once through the existing model/lane routing. The worker
   reads its brief and selected note sections, edits only the declared write set, runs
   its named checks and commits through `gstack-lane commit --cwd <job.cwd> --base
   <job.base>`. It returns an immutable commit plus evidence. A check not run is missing.
   Immediately bind the actual host task handle with action `bind`, `task`, `attempt`,
   `handle`, and `runDir`. Persist the handle outside the worker's checkout.
3. Wait for the first completion, not every active task. Confirm the job's actual terminal
   status and model/routing evidence. Call action `complete` with `task`, `attempt`, `head`
   and `runDir`. The helper checks identity, clean state, declared writes and note validity,
   reruns named checks, applies the existing commit guard, merges serially and runs
   integration checks. Only a successful receipt unlocks dependents. A duplicate identical
   completion returns the existing result without another merge; a changed attempt/head fails.
4. Call `next` immediately after successful integration and fill available slots while
   unrelated workers continue. File-prefix and semantic-resource reservations last until
   integration. A textual conflict or red check blocks integration; model diagnosis is
   required. Never use a blind reset, discard work or reduce a check to continue.
5. On BUILT, stop admission and load `workflow-reference`. Launch the existing unit script
   with `prebuilt` pointing to the queue result/receipts. Pass `base: shipBase` to the existing Workflow so its meter and review cover the
   complete unshipped checkpoint; preserve the same `SHIP_BASE_FILE` value. Pass `waves` metadata
   for every integrated task (id, tier, impl and existing routing overrides), even though
   prebuilt skips execution: the workflow derives task IDs, owners and tiers from waves.
   Include the approved briefs/owners of any earlier unshipped work in that range;
   missing scope evidence is BLOCKED. Briefs must resolve as `<briefsDir>/<id>.md`;
   reconcile or BLOCK if they do not. Set
   `gateClass: critical` for a T3-containing or FINAL milestone and preserve all existing
   policy arguments. Existing Workflow argument/path validation still applies. Its Integrate, meter, review, fixes and Ship phases
   still run. BUILT is not a review verdict or permission to publish. Keep the reviewed SHA
   frozen. Follow-up units start only at the authorized checkpoint boundary.

## Recovery, cancellation and evidence

`status` reads current jobs, attempts and terminal state. An unbound reservation after a
crash is uncertain: inspect the host's actual task list before deciding whether dispatch
occurred. Never automatically redispatch it. A bound running task is reattached through
its recorded host handle. A missing handle or unknown terminal state remains BLOCKED.
The helper deliberately does not infer that a worker died from elapsed time.

A leftover `.queue.lock`, `integrating` state or failed merge/check requires inspecting the
owned process, integration index, worktrees and receipts. No automatic stale-lock deletion,
merge retry, reset or completion fabrication. Preserve all artifacts. After diagnosis,
resume the original static-wave Workflow on the preserved unit only with reconciled task
bases/evidence, or start a new approved unit; do not start overlapping owners.

`cancel` stops admission and records cancellation requests. The host must stop/join each
recorded worker through its actual handle and verify terminal status before cleanup.
A failed `integrating` marker and its integration base are retained when cancelling.
The queue remains CANCELLING while any worker needs reconciliation; this version has no
automatic terminal acknowledgement. The request alone is not proof a worker stopped. Retain worktrees for recovery; remove
only owned, terminal, safely integrated/discard-approved worktrees. Review and publication
remain untouched by cancellation.

At the 2,500 production-LOC admission stop, preserve active task worktrees, stop/join workers
and record unintegrated tasks as deferred. Checkpoint only the actually integrated subset
through the unchanged Workflow gate and its existing size rules. Do not mark the original
milestone complete or silently drop deferred work. A larger unit needs the existing explicit
size/scope decision, not a higher scheduler threshold.

Receipts bind task, attempt, base, source commit, integration parent/result, executed argv,
exit status, log paths and meter output. Journals record reservation/binding/integration
order. These establish local execution evidence, not provider tokens or subscription cost.
Keep logs private and return compact summaries. Compare static versus continuous execution
on equivalent graphs with the same checks; report waiting/merge/check costs and failures,
not just optimistic task durations. Scripted workers are deterministic tests, not live
model-quality evidence.
