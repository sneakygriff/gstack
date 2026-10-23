# Ticket 08: preregistered bounded live comparison

Status: **blocked; empirical work incomplete; zero live runs**. This protocol is a partial deliverable, not evidence of speed, token savings, accepted implementation quality or full specification completion. It supersedes the external preflight's earlier 18-run proposal: the initial pilot is capped at **six unit runs**, with no automatic expansion or authorization for eighteen runs.

## Readiness and boundaries

Source snapshot: `afda36d93c9f7876caa306184107fc9d8002471f`, after tickets 02/05 integration. Their deterministic implementation is available; required evaluations and the live comparison are still missing. [Provider lane evidence](provider-lanes.md) and its [JSON](provider-lanes.json) retain the observed authentication/transport distinctions:

- Codex desktop host tools work; CLI ChatGPT authentication was observed, but a separate model/tool transport probe was not run.
- Claude's earlier matching identities and later unauthenticated explicit default profile conflict. Overflow authentication alone does not establish two independent pools, Fable availability or remaining capacity. The earlier Haiku Read probe is narrower than implementation and gate capability.
- Grok CLI authentication succeeded, but both protected tool attempts failed at sandbox startup on the socket layout. No Grok model/tool execution is evidenced. Any eventual Grok worker must use Grok CLI; no relabelled host surrogate or unsandboxed retry is permitted.
- Registered API-judge environment is absent. Subscription work does not replace ticket07's registered evaluations. Quota and actual subscription debit remain unknown.

This chat exposes no native Workflow executor. `autobuilder-loop/autobuilder-unit.js:20-33,108-112` requires the Workflow VM and its agent/resume semantics; it is not an executable standalone Bun program. `autobuilder-loop/sections/continuous-queue.md:131-143` requires the existing unit workflow with `prebuilt`, complete owner/tier metadata and original `shipBase` after BUILT. That handoff preserves review/fix/verification gates and is not demonstrated on the currently available host.

An existing manual-gate recipe is documented in `sections/manual-gate.md` and `sections/workflow-reference.md:96-99`. Its presence does not establish equivalent live transport; any use would need the same supported execution and evidence policy across all three arms. Do not invent a Workflow API, add an adapter, lower floors or substitute scripted workers. Existing queue receipts demonstrate local scheduling/integration events, not model usage or accepted quality.

## Frozen pilot design

One small, three-task DAG; three arms; two repetitions. Six runs total. This is an exploratory within-unit comparison only. A broader efficiency/adoption claim requires a later independent unit and separate scope decision. No significance threshold or savings target is claimed.

The proposed disposable product fixture is a local TypeScript record codec with no network or external state. Before dispatch create and freeze a single starting tree, briefs, acceptance checks and baseline identity; the fixture has not been materialized by this documentation ticket. Hash every artifact and register it before the first model request. If fixture design changes after seeing outcomes, declare a new protocol version and retain all old outcomes.

| Task | Dependencies and reserved writes | Identical acceptance in every arm |
| --- | --- | --- |
| P: parse records | None; `src/parse.ts`, `test/parse.test.ts` | Parse one `key=value` record per line, splitting at the first `=`; preserve empty values and further `=` characters; reject empty keys and malformed lines with deterministic line-specific errors. Accept LF/CRLF without discarding value whitespace. |
| S: serialize records | None; `src/serialize.ts`, `test/serialize.test.ts` | Preserve input order and duplicate keys; produce LF-separated records; reject empty keys, keys containing `=` or line endings, and values containing line endings; serialize empty input as empty text. |
| R: parser JSON facade | P only; `src/index.ts`, `test/facade.test.ts` | Expose a facade converting parsed records into a JSON array while preserving order, duplicates and parser errors. It does not import or wait for S. |

Use per-task public tests plus a frozen independent acceptance corpus and typecheck, including negative cases. Task contracts must resolve remaining fixture details before dispatch, including terminal-newline behavior and exact error representation; no actor may choose incompatible semantics mid-run. Retain independent test failures as defects, not opportunities to adjust the corpus. P/S are independent; R waits only for P, so continuous admission can overlap R with unfinished S. Final unit acceptance imports P and S directly and checks round trips, including duplicate keys, empty values and embedded `=`; empty serialized input must parse as an empty record list. Maximum implementation concurrency is two in every arm, with identical private worktree/write-resource discipline and one integration writer.

| Arm | Instruction/execution treatment |
| --- | --- |
| A | Identified pre-trim baseline instruction and original static-wave implementation. The exact baseline SHA is unresolved and is a dispatch blocker; establish it from history rather than selecting an arbitrary old revision. |
| B | Updated instruction/executor with static scheduling (`mode: waves`). |
| C | Same updated instruction/executor with continuous scheduling (`mode: continuous`). |

B and C use the same frozen updated source. A uses the verified baseline instruction snapshot against the same product fixture. All arms preserve acceptance, gate policy, concurrency, task tiers/model assignments, review coverage, shipping boundaries and account capacity. Changed packaging may be part of A-to-B treatment; report it explicitly. Only B-to-C isolates scheduling within this design. Shared exploration and injected context must be declared per arm before dispatch; do not conceal a context or cache advantage as a scheduler gain.

Run order is fixed: repetition 1 **A, B, C**; repetition 2 **C, A, B**. Complete each unit run before the next. Two rotations do not fully balance order/cache effects; record this limitation. Use fresh product worktrees per run, without pretending provider caches can be reset. Record observed cache hits and any provider/runtime drift.

Use the same existing routing contract and concrete model/effort assignments across arms, frozen before dispatch. Assign tiers based on the final briefs under the current rules, not to unlock cheaper models. Preserve Fable/high and Astra/high review requirements and all allowed fallback restrictions. Any differing observed model or fallback makes the affected pair non-equivalent; retain it separately. Remaining model access/identity and gate transport must be demonstrated before allocating the six runs. There is no permission here to purchase credits, override guards or switch accounts.

## Run ledger and stopping rules

The preregistered run ledger is:

| Order | Run | Status | Coverage credit | Observed model, usage, latency, quality |
| --- | --- | --- | --- | --- |
| 1 | R1-A | not-run, blocked | false | unknown |
| 2 | R1-B | not-run, blocked | false | unknown |
| 3 | R1-C | not-run, blocked | false | unknown |
| 4 | R2-C | not-run, blocked | false | unknown |
| 5 | R2-A | not-run, blocked | false | unknown |
| 6 | R2-B | not-run, blocked | false | unknown |

Every row has blocker `equivalent transport and prerequisite evaluations unavailable`. Missing measurements are not zero. Task/attempt ledgers supplement, rather than replace, these unit rows.

Retain unit/attempt identifiers, product base and resulting SHA, instruction/prompt fingerprints, observed provider/model, non-secret account-pool alias, transport, public usage/cache fields, retries/fallbacks, queue waits, build/check/integration/review/fix time, named check results, gate state, defects and final completion status. Use ticket04's observed-usage schema/deduplication and ticket05's applicability/acceptance assembly. Record API charges separately from subscription usage and list-price estimates. Character counts and logical calls are not tokens or invoices.

Stop admission for unavailable required transport, failed sandbox, quota/credit guard, unknown worker state, invalid review evidence, changed acceptance or non-equivalent routing. Preserve blocked/failed/cancelled/unstarted outcomes and configured recovery. Do not silently replace a failed run with another sample. Existing review retries remain unchanged; extra benchmark repetitions require separate scope. BUILT is not accepted or shippable. No installation, PR, push, merge or deployment is authorized by this pilot; establish an existing supported stopping boundary without weakening any applicable gate, otherwise retain the blocker.

Report the complete six-row ledger, per-arm paired observations, failures/defects and uncertainty. Two samples of one DAG support only a limited pilot observation. Before recommending broader adoption, use an independently chosen second unit under a separately agreed protocol, plus required full validation. Scripted-worker replay can remain deterministic scheduler evidence but can never fill any of these six live rows.

## Remaining work

Freeze baseline/updated identities and concrete fixture contracts; reconcile current provider identity/transport/capacity; demonstrate existing equivalent Workflow/gate execution with credit guards intact; complete or validly reuse required registered evaluations; verify private evidence retention and the publication stopping boundary; then execute the bounded pilot only when those prerequisites hold. These dependencies remain open. Confidence is high in the documented blockers; empirical comparative confidence is unavailable because all six runs are unstarted.
