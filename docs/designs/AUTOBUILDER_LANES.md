# /autobuilder-loop — multi-vendor execution lanes (v1.7.0 design)

Status: APPROVED DESIGN (2026-10-10). Synthesized from the orchestrator's v0 draft and a
"compare notes" consult with Codex `gpt-6-astra` at `xhigh`. This doc is the contract for
the v1.7.0 change to `autobuilder-loop/SKILL.md.tmpl` and the new `bin/gstack-lane` helper.

## Why

Before v1.7.0 every implementation task ran on the orchestrator's own Claude subscription,
Codex/Grok were reviewers only, all subagents shared one worktree, and nothing load-balanced
across accounts. The scarce resource (the root session's quota — when it is exhausted the
whole loop stops) did the bulk of the work, while two paid subscriptions idled between gates.

Goal: maximize **accepted** work per hour by spreading implementation across every available
account, by difficulty, in isolated worktrees — while reserving capacity for review and repair.

## Lanes (verified on the operator's machine 2026-10-10)

| Lane | Account / transport | Models | Role |
|---|---|---|---|
| **L0** root | Claude sub #1, desktop Code session | Fable 5.1 / Opus 5.5 / Opus 4.8 (session) | Orchestration only. Never implements. |
| **L1** in-session | Claude sub #1 via Agent tool (shares L0 quota) | fable, opus, sonnet, haiku | Decomposition, synthesis, integration, launcher wrappers, Claude reviewer seat. Implementation only as last spillover. |
| **L2** Claude #2 | Separate Claude account: `CLAUDE_CONFIG_DIR=<claude_overflow_dir> claude -p` (hooks/MCP disabled, explicit `--tools`, inherited tokens unset — D8) | claude-opus-5-5, claude-sonnet-5-5, claude-haiku-5-5 (Fable only with operator credit opt-in) | Primary for T3; spillover for T0–T2; other-vendor reviewer for Codex-authored work (adds QUOTA, not vendor diversity). |
| **L3** Codex | ChatGPT subscription, hermetic `CODEX_HOME` outside the run tree (D6) | gpt-6-astra, gpt-6.1-sol, gpt-6-luna (+ older) | Primary implementation pool T0–T2; gate forum member. |
| **L4** Grok | grok.com subscription; every use (probe, review) gated by `grok_reviews=enabled` (D5); reviews run ONLY inside grok's OS sandbox — sandbox unavailable ⇒ ABSENT unless `grok_allow_unsandboxed=true` (new key, default false) | grok-4.7 (CLI default = latest, helper-pinned) | **REVIEWER-ONLY**: gate forum member at high effort + bounded-scope reviewer; never implements — grok merges repo-checked-in `.grok/config.toml` permission grants, so it cannot be isolated for implementation (the helper rejects `--lane l4 --mode impl`). |

Machine facts that shaped the design:
- `grok --sandbox read-only` REFUSES TO START on this Mac (OrbStack symlinks `/var/run/docker.sock`
  → "could not apply the 'read-only' sandbox profile… Refusing to start"). The pre-1.7 forum recipe
  would make Grok ABSENT every gate. `--permission-mode plan` works but is NOT an OS boundary, so
  Grok reviews run in a disposable detached review worktree at the frozen SHA.
- The user's `~/.codex/config.toml` has remote MCP servers (Neon, graphify, plaud) that historically
  stall `codex exec`/`codex review` to timeout. A hermetic `CODEX_HOME` (copied `auth.json` + minimal
  `config.toml`, no `mcp_servers`) runs clean (~4 s probe).
- L2 needs a one-time interactive login by the operator:
  `CLAUDE_CONFIG_DIR=~/.claude-overflow claude` → `/login` with the second account. Until then L2 is
  ABSENT (probe fails) and its rows spill to the next lane.

## Evidence that shaped routing (research 2026-10-10, vendor-reported unless noted)

- Opus 5.5 is the strongest coder in the pool (Terminal-Bench 4.0 66.4% @xhigh vs gpt-6-astra 57.9%,
  Fable 5.1 55.8%, grok-4.7 37.6%, Haiku 5.5 39.2%, gpt-6-luna 16.4%); Anthropic's guidance: start with
  Opus 5.5, escalate to Fable only when Opus at xhigh/max falls short. gpt-6.1-sol ≈ Astra on DeepSWE
  (75.2% vs 74.8%) at ~1/5 the API price. Grok 4.7: slow first token (~98 s, Artificial Analysis), weak on
  long terminal work → reviewer + bounded spillover only. Luna: T0 only.
- Quotas: ChatGPT Plus allows ~5–45 Astra vs 15–160 gpt-6.1-sol vs 350–3,000 Luna messages / 5 h
  (Pro: no 5-h limit, weekly limits apply) → Astra is reserved for T3, debugging escalation and the
  T3/final gates. Codex "fast" tier burns 2.5× → the helper pins `service_tier="default"`.
- `claude -p` bills Fable to usage credits WITHOUT a prompt (Claude Code model-config docs) → L2 never
  runs Fable unless the operator opts in (`--allow-credit-billing`). In `-p` mode `ANTHROPIC_API_KEY`
  overrides the subscription login → the helper unsets it for L2. `CLAUDE_CONFIG_DIR` multi-account is
  documented; whether pooling two subscriptions for one workload is within plan terms is NOT addressed
  officially ("limits assume ordinary, individual usage") — operator's call.
- Grok CLI: a July 2026 incident (3P report) uploaded whole repositories; don't point L4 at
  secrets-bearing repos. Installed CLI is 1.0.40; 1.0.50 is current (`grok update` may fix the
  read-only sandbox refusal). Grok efforts: low/medium/high/xhigh (default high).
- Concurrency: Anthropic recommends starting with 3–5 parallel agents; "three focused teammates often
  outperform five scattered ones" → global default 6 incl. reviewers.

## Routing table (tier → lanes, ordered; first available lane under its cap wins)

| Work type | Primary | Spillover (in order) | Effort |
|---|---|---|---|
| **R** rote / no-reasoning (deterministic, exact success check, no judgment) | L1 Haiku 5.5 (`model: haiku`, `effort: "low"`; read-only search may use `subagent_type: Explore`) | L2 `claude-haiku-5-5 --effort low` → L3 gpt-6-luna low; Sonnet-low only on a host with no Haiku; never Sonnet/Opus/Fable/Sol/Astra, never L4 | low |
| Root orchestration | L0 | — | session |
| Milestone decomposition, synthesis, forum consolidation | L1 Fable | L1 Opus 5.5 / 4.8 → L2 Fable/Opus | high/max |
| **T0** mechanical (plan already contains the answer) | L3 gpt-6-luna | L2 Haiku → L1 Haiku (low) | low |
| **T1** standard (single module, clear spec) | L3 gpt-6.1-sol | L2 Sonnet → L1 Sonnet | medium |
| **T2** complex (cross-module, concurrency, perf, refactor) | L3 gpt-6.1-sol | L2 Opus 5.5 → L1 Opus 5.5 | high |
| **T3** critical (architecture, security boundary, migration, untrusted input) | L2 Opus 5.5 | L3 gpt-6-astra → L1 Opus 5.5 → L1 Fable (escalation only) | high/xhigh (Astra xhigh) |
| Test writing | the task's implementer | that TASK's tier row (never Sonnet for T2/T3) | by tier |
| Debugging / root cause | L3 gpt-6.1-sol | L2 Opus → L3 gpt-6-astra | high (Astra xhigh) |
| Per-task review (T1+) | fresh context, other vendor than author | L2/L1 Claude ↔ L3 Sol; L4 for bounded scope | medium (T1) / high (T2) |
| Milestone gate forum | L3 gpt-6.1-sol + L4 grok + Claude eng/code review | Astra substitutes Sol; fresh Claude substitutes an absent seat | high → medium |
| Gate for milestones containing T3 + the FINAL milestone | L3 **gpt-6-astra** + L4 grok + Claude (L2 Opus or L1 Fable) | as above | high → medium |
| Fix rounds | original author lane/model | same-tier other vendor → +1 tier after diagnosis | original tier |
| Integration / merge conflicts | L1 Opus 5.5 (single integration owner) | L2 Opus → L3 Sol | high |

Rules:
0. **Fable is an escalation, not a default implementer** — in-session (L1) only, after Opus 5.5 at xhigh/max fell short, or for decomposition/synthesis.
1. **Never downgrade tier to spill.** Cross-vendor tier equivalents are legal (T2: Opus 5.5 ≡ Sol high;
   T3: Opus/Fable ≡ Astra). Sonnet/Luna/Haiku are never a T2/T3 fallback without a user waiver.
2. **L1 reserve.** The orchestrator's own subscription implements only when L2/L3 are all cooling
   or absent for that tier. Before admitting new implementation work, reserve the next gate's reviewers.
   **Exemption: R and T0 work on L1 Haiku** (see "Class R" below) — the operator wants small models used
   (≈1/40 of Opus 5.5 per token); the T0 row therefore keeps `L2 Haiku → L1 Haiku`. L4 never implements.
3. **Reviewer diversity.** Replace "author vendor ≠ reviewer vendor" with: fresh reviewer context
   + at least one OTHER-vendor assessment; T3 needs two other vendors — unless the operator waived the
   second seat at step 0 (then T3 = Codex + a fresh Claude seat, gates `DEGRADED`, verdict ≤
   `COMPLETE_UNVERIFIED`). L2 counts as Claude (same vendor as L1). Diversity no enabled/present vendor can
   supply → the task is `BLOCKED` at once (never an indefinite PENDING, and never before the step-0
   question was asked); a gate missing a forum member is `DEGRADED`, never `CLEAN`.
4. **No `ultra`, no nested delegation** (`codex … ultra`, grok subagents) unless the operator budgets it.
5. **No routine best-of-N.** For T3, two independent design analyses (different vendors) → one implementation.
6. **Escalation by diagnosis, not count.** Classify a failure (product / fixture / environment /
   permission) before re-dispatch. Switch vendor for a demonstrated reasoning failure; +1 tier only
   after diagnosis. Existing caps stay: 2 failed re-dispatches → BLOCKED; >3 gate rounds → BLOCKED.
7. **No escalation of R by retry.** A failed R task reports the failure verbatim (exit code + last
   lines) and is never retried on a bigger model; if it turns out to need judgment (ambiguous output,
   a decision) it is re-classified T0/T1 and routed by that row.

### Class R — rote / no-reasoning (added 2026-10-11, operator feedback)

Operator feedback: Haiku and smaller models went unused — in practice every dispatch landed on Sonnet+
and the orchestrator itself did rote reads and runs. Class R sits below T0 and covers work with an
exact success check and no judgment: running a known command and reporting (test suites → counts +
failing names, builds, `gen:skill-docs`, lint/format, `gstack-lane probe|summary`); reading / grepping /
extracting facts with file:line refs; mechanical bookkeeping (`gstack-lane worktree add|rm|commit`,
mark-complete, ledger updates, scribe briefs from content the orchestrator already decided, relaying
`gstack-lane adjudicate` / `summary` lines verbatim — never interpreting review text); verbatim edits whose
exact text the orchestrator dictates. **Judgment is never R:** scope/LOC estimation, milestone splitting and
marker-less next-milestone selection go to the orchestration class (Fable / Opus 5.5 / Opus 4.8-max).

- **Why Haiku, in-session.** Haiku 5.5 costs ~1/40 of Opus 5.5 per token, answers faster, and an Agent
  dispatch has no CLI/worktree overhead — so R is exempt from the L1 reserve (rule 2). It also keeps
  the root context clean: the subagent returns a ≤10-line envelope (file:line refs, counts, verbatim
  failing names) instead of logs.
- **Caps.** R workers have their own cap (default 4 concurrent) and do not consume
  `autobuilder_max_parallel` slots; the heavy-check limits (≤2 focused + 1 full-suite runner) still apply
  to R runs that execute test suites.
- **Orchestrator discipline.** The orchestrator does no R work itself beyond ONE compact command with
  output ≤ ~20 lines (e.g. a `gstack-lane summary` line); everything else is an R dispatch.
- **Effort.** The skill authorizes `effort: "low"` on R dispatches (the Agent tool otherwise only takes
  `effort` when instructions ask for it); hosts that reject the key get it as a prompt instruction.

## Parallelism

- **Ready queue, not wave barriers.** Decomposition emits tasks with `{id, tier, deps[], owns[], lane}`
  where `owns` = the write set INCLUDING shared surfaces (interfaces, lockfiles, schemas, generated
  outputs, CHANGELOG/VERSION). A task is ready when its deps are integrated and its `owns` set is
  disjoint from every in-flight task's `owns`.
- **Per-task worktrees** for every external-lane task and for every in-session task that runs
  concurrently with another (`isolation: "worktree"` on the Agent call). A lone task may run in the
  milestone worktree. Dependents start from the INTEGRATED milestone branch, never from a sibling branch.
- **Launch path (D1).** The ORCHESTRATOR launches external-lane work itself — one top-level Bash call
  with `run_in_background: true`: `gstack-lane run … >/dev/null 2>&1; gstack-lane summary --out <out>`.
  No Haiku launcher subagents (a waiting Agent burns the root subscription for the whole deadline).
  `gstack-lane` is on the skill's narrow top-level Bash list; only the one-line `summary` enters context.
- **Commit step (D2).** After a successful impl attempt and before review/integration the skill runs
  `gstack-lane commit --run-dir <d> --task <id> --base <sha> -m <msg>`, which stages the task worktree,
  REFUSES (exit 1, nothing committed) on any staged secret-pattern path, and prints `result_sha=`/`base_sha=`.
  **F3:** `--base` is REQUIRED and is the `base_sha=<sha>` that `worktree add` printed — the orchestrator
  keeps it in its task ledger (never re-read from the run tree); the helper refuses if it differs from the
  worktree metadata, if that metadata is missing, or if `--base` is not an ancestor of HEAD.
- **One integration worker** (L1 Opus 5.5) merges task branches into the milestone branch in dependency
  order, runs affected checks after each merge, resolves conflicts with semantic revalidation.
- **Caps (defaults, configurable via `autobuilder_max_parallel`):** L1 = 2, L2 = 2, L3 = 2, L4 = 1,
  global = 6 worker payloads (excludes L0). Reviewers count; background `gstack-lane run` launches count
  against their own lane. Class-R Haiku workers have their own cap (4) outside these. Heavy checks: ≤ 2
  focused runners + 1 full-suite/build runner at a time.
  **Throttle cap rule:** each `throttle` drops the lane's cap by 1 for the milestone, never below 1
  while the lane is `ok`; reductions reset at the next milestone; ≥ 3 consecutive throttles in a
  milestone (helper `throttle_count`) → the lane counts as `cooling` for spillover, so the L1-reserve
  rule can spill. Raise caps only when accepted throughput improves without throttle/quota signals.
- **Review diversity floor (D7).** Per task: required diversity that no enabled/present vendor can
  satisfy → the task is `BLOCKED` immediately with that reason (no indefinite PENDING).

## Quota & health (owned by `bin/gstack-lane`, persisted in `$RUN_DIR/lanes.json`)

| Signal (structured CLI events only — E1) | Class | Action |
|---|---|---|
| Codex `turn.failed` with 429 / rate limit / overloaded / 5xx / "Reconnecting" exhaustion; grok/claude structured error of the same shape | `throttle` | jittered short backoff within the SAME deadline; `throttle_count` recorded; skill applies the throttle cap rule |
| Codex `turn.failed` with "usage limit" / "try again at" / `limit reached\|<epoch>` wording; claude top-level `is_error`/`subtype` quota | `quota` | cool the account until the parsed reset; unknown reset → `next_probe_at` = now+15 min, doubling to 60 min |
| Codex `turn.failed` 401/403/"Unauthorized"/"not logged in"; grok/claude structured auth error | `auth` | lane ABSENT until a later probe clears it |
| exit 124 | `timeout` | REVIEWS only: one effort step-down retry (high→medium) under `--retry-timeout`, then the attempt fails; an impl timeout is `timeout` with NO effort drop (H14) |

**E1 — classify from structured events, never from stderr.** Every L3 invocation runs `codex exec --json`
with stdin from `/dev/null`; the JSONL event stream on stdout is the only source of truth: success = a
`turn.completed` event; failure = `turn.failed` → classify `error.message`; `{"type":"error"}` events are
transient-retry notices, not a final class. Free-form stderr (tracing logs) and agent text are never
classified. L2/L4: classify from the CLI's structured JSON error fields only; a non-zero exit with no
structured error is class `error`. Captured real samples live in `test/fixtures/gstack-lane/`
(`ok.stdout.jsonl`, `noauth.stdout.jsonl` + `.stderr`, `ok.rollout.jsonl`).
**E8 — kernel advisory lock.** `lanes.json` read-modify-write is serialized with a kernel `flock` held
by a perl helper (`/usr/bin/perl -MFcntl=:flock`) on `<run-dir>/lanes.lock`; the kernel releases it on
process death, so there is no stale-lock reclamation. A bounded acquire failure for a `quota`/`auth`
result still exits with the class code and writes `lane_update: "pending"`; the skill re-probes before
the next dispatch on that lane. **E9 — cooldown ordering.** `last_event_at` is recorded on every
quota/auth event even while already `cooling`; an `ok` clears cooling only if `attempt_started_at >
last_event_at`. Codex models on one account share one quota bucket — cooling L3 cools all its models.
Before requeueing a task elsewhere, stop the old process tree (group + descendant walk, TERM then KILL)
and preserve its partial diff.

## Evidence (envelope additions, D3 / E2 / E3)

Every `run` output path is attempt-scoped: `$RUN_DIR/attempts/<task-or-gate>/<attempt_id>/…`; `run`
refuses an `--out` that already exists, so a prior attempt's status can never be re-read as new
evidence. **E3:** every internal invocation (initial, timeout step-down, throttle retry, sandbox-refusal
retry) writes its own output/logs under `inv-<n>/` inside the attempt dir; only the successful
invocation's verified output is published to `--out`, and every check (incl. the empty-body check) reads
the published invocation only. The skill reads only `--out` and `<out>.status.json`.
Every implementation envelope adds `attempt_id, lane, requested_model, runtime_model, base_sha,
result_sha, checks[] (cmd + exit status), report_path`. **E2 — Codex runtime model from the rollout:**
`thread_id` from the `thread.started` event → `<CODEX_HOME>/sessions/**/rollout-*<thread_id>.jsonl` →
the `turn_context` record's `payload.model` / `payload.effort` → `runtime_model`, `runtime_effort`,
`runtime_model_source: "rollout"`; missing → `null` / `"none"` (never the requested id). grok/claude:
the JSON `modelUsage` key. Status files also carry `reviewed_sha` (= `git -C <cwd> rev-parse HEAD` for
`--mode review`), `tainted`, `model_mismatch`, `class_detail` (`rejected: …` for policy refusals),
`lane_update`, `throttle_count`.
**Adjudication order (skill, both forum members): INVALID before ABSENT.** A completed attempt with
`tainted: true`, a `rejected` class_detail, an empty body, a non-zero exit, or a `reviewed_sha` that is not
this round's is INVALID whatever its `class` — a FAIL that never maps to ABSENT. The Codex seat also
requires `runtime_model` == the requested gate model (`gpt-6-astra` may substitute `gpt-6.1-sol`;
`null` → INVALID); the `model_mismatch` coercion concession applies to L4 only. Only then do genuine
availability failures (`quota`/`auth`/`timeout`/`throttle`/CLI missing/disabled) map to ABSENT.
Schema-valid JSON and `tests_passed: true` are not verification — the orchestrator re-checks via the
integration worker's own check run.

## `bin/gstack-lane` (helper contract)

Keep routing POLICY in the skill; put MECHANICS in the helper.

- `gstack-lane probe --run-dir <dir> [--json]` — probe L2/L3/L4 cheaply (L2: haiku "reply OK";
  L3: gpt-6-luna low "reply OK" under the hermetic home; L4: grok plan-mode "reply OK" at effort `high`,
  recording the runtime model id). Writes/merges `<dir>/lanes.json` (`status: ok|cooling|absent`,
  `reason`, `next_probe_at`, `runtime_model`). Respects `next_probe_at` (does not hammer a cooling
  account). Prints ONE line per lane.
- `gstack-lane run --run-dir <dir> --lane l2|l3|l4 --mode impl|review --model <id> --effort <e>
  --cwd <worktree> --prompt-file <f> --out <f> [--schema <f>] [--timeout <s>] [--retry-timeout <s>]
  [--tier T0..T3] [--allow-cmd <prefix>]… [--allow-credit-billing]` (l4: `review` only — `l4 impl` is
  rejected) — builds the command per lane, runs
  it in its own process group under a hard deadline (on expiry kills the group AND walks the descendant
  tree, TERM then KILL after grace), classifies the outcome (`ok|throttle|quota|auth|timeout|error`),
  applies the one timeout step-down (reviews only — H14), updates `lanes.json` under an ownership-safe lock (steal only
  when the owner pid is dead, atomic reclaim, unlock only if the pid file still holds `$$`), writes
  `<out>.status.json` (attempt dirs created with umask 077). Exit 0 = ok, non-zero = class code.
  - Task ids: whole-string `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`; the resolved target must stay under `<run-dir>/wt/`.
  - L3 impl: `CODEX_HOME=<hermetic> codex exec -C <cwd> -s workspace-write -c approval_policy="never" -c service_tier="default" -c model=… -c model_reasoning_effort=… [--output-schema] -o <out> - < prompt`
  - L3 review: same with `-s read-only`.
  - **CODEX_HOME (D6/E4):** `${GSTACK_HOME:-$HOME/.gstack}/lane-codex-home/<run-id>/` (dir 700, files 600),
    OUTSIDE the run tree; `config.toml` REWRITTEN from a fixed template on every use under the lock
    (temp file in the same dir, `mv -f`, then re-read and byte-compare to the template; ANY failure —
    write, rename, compare, immutable flag — refuses to launch with class `error`, reason "hermetic codex
    config not installed", on the retry path too). Never used (nor any parent of it) as a cwd.
  - **L2 (D8):** `env -u ANTHROPIC_API_KEY -u ANTHROPIC_AUTH_TOKEN -u CLAUDE_CODE_OAUTH_TOKEN` (and any
    `CLAUDE_CODE_*TOKEN*`) `CLAUDE_CONFIG_DIR=<dir> claude -p --model … --effort … --restricted
    --strict-mcp-config --settings '{"disableAllHooks":true}' --tools <explicit list> --output-format json
    [--json-schema]`. Impl: `--permission-mode dontAsk`, tools `Read,Grep,Glob,Edit,Write,Bash` with
    `--allowedTools` limited to the vetted check commands. Review: `--permission-mode plan`, tools
    `Read,Grep,Glob` ONLY (no Bash). `--bare` is NOT usable (forces API-key auth).
  - **`--allow-cmd` vetting (D9/E10):** accept only structured runner + subcommand pairs from a fixed
    table (`bun test`, `bun run <script>`, `npm test`, `npm run <script>`, `pnpm test`, `pnpm run <script>`,
    `yarn test`, `make <target>`, `cargo test|build`, `go test`, `pytest`, `python -m pytest`, `uv run
    pytest`, `swift test`, `xcodebuild test`, `./gradlew test`, `gradle test`, `mvn test`, `dotnet test`,
    `mix test`, `bundle exec rspec`, `rspec`); normalize every token's basename and reject if ANY token is
    a shell/interpreter/downloader (sh bash zsh dash ksh fish csh tcsh env eval exec python python3 node
    deno perl ruby php lua osascript curl wget nc ssh sudo xargs) or a `/` path outside the worktree.
  - **L4 model (D4):** without `--model`, resolve the latest via the `Default model:` line of
    `grok models` and pass `-m <id>` explicitly (record `requested_model`); the CLI otherwise routes
    low effort to a build model silently. Family mismatch of `runtime_model` → `model_mismatch: true`
    (a coercion note in the gate record, not a failure).
  - **L4 review (D5):** `grok -p --prompt-file <f> -m <id> --reasoning-effort … --permission-mode plan
    --output-format json`, cwd MUST be a registered linked worktree under `$RUN_DIR/wt/` (verified via
    `git worktree list --porcelain` + path prefix), one detached worktree PER forum member. Runs with
    `--sandbox read-only` — MANDATORY by default: on the "could not apply the 'read-only' sandbox
    profile" refusal the lane is ABSENT (reason "sandbox unavailable"), NO plan-only fallback, unless the
    operator opted in with `gstack-config set grok_allow_unsandboxed true` (default false), in which case
    the fallback runs and status records `sandbox: none, unsandboxed_opt_in: true`. Before every L4
    review the helper strips repo grok/agent config (`.grok/`, `.envrc`, case-insensitive) from the
    review worktree and refuses a worktree with populated submodules. It fingerprints — before/after — the review worktree,
    the primary worktree AND the shared git control state (`git rev-parse --git-common-dir` → hooks/
    names+hashes, config, info/, packed-refs, `git for-each-ref`, the `core.hooksPath` target) (E5); any
    change → class `error`, `tainted: true`. Snapshots are bounded and inert (E6): `GIT_CONFIG_NOSYSTEM=1
    GIT_OPTIONAL_LOCKS=0`, `-c core.fsmonitor=false -c core.hooksPath=/dev/null -c diff.external= -c
    core.pager=cat`, `--no-ext-diff --no-textconv`, under the watchdog with a ~30 s deadline; a snapshot
    timeout ⇒ tainted (fail closed). The skill passes an immutable SHA as the review base.
    **F8 — documented residual (opt-in only):** with `sandbox: none` (reachable ONLY via
    `grok_allow_unsandboxed=true`) grok runs as the same user; tamper detection (incl. the lanes.json hash
    journal) is best-effort and a deliberately adversarial model can defeat it. Worst case of a forged
    lanes.json is spill/cost, never a CLEAN/VERIFIED verdict (verdicts come from the skill's adjudication
    of the member's own status + the integration worker's re-check). The default is the sandbox or ABSENT;
    the operator fix is `grok update` or a non-symlinked docker.sock.
    Never `--always-approve`. `grok_reviews=disabled` (bin default) → every L4 use (probe, review)
    refused as `absent`, reason "disabled by grok_reviews".
  - **L4 impl: REJECTED** (`--lane l4 --mode impl` → class `error`). Grok merges the repo's checked-in
    `.grok/config.toml` permission grants into its own, so an implementation run cannot be isolated from
    repo-controlled policy. L4 is reviewer-only; before each L4 review the helper strips `.grok/` from the
    disposable review worktree.
  - Model ids are arguments; the helper never hardcodes a default model except in `probe`.
- `gstack-lane summary --out <f>` — prints ONE compact line from `<f>.status.json` (attempt_id lane
  model runtime_model class exit duration result_sha), never the CLI transcript.
- `gstack-lane adjudicate --out <f> --seat codex|grok --gate-class ordinary|critical --reviewed-sha <sha>
  [--requested-model <m>]` (required for codex) — the forum-member verdict for ONE review attempt (D4):
  prints exactly one line `VERDICT=<PRESENT_CLEAN|PRESENT_P1|INVALID|ABSENT> reason=<token[,model_mismatch]>
  p1_count=<n> runtime_model=<id|null>`; exit 0 / 10 / 11 / 12 (2 = usage). INVALID-before-ABSENT exactly
  as the skill's former `_adj` rules (tainted, class error, empty body, non-zero exit, attempt/sha mismatch,
  Codex runtime_model null or off-policy ⇒ INVALID; auth/quota/timeout/throttle/skipped ⇒ ABSENT; L4 family
  mismatch = note); `p1_count` = `[P1]`/`[P0]` tags leading a line or following a list marker. The skill maps
  a missing/denied helper (exit 126/127, no VERDICT line) and config-disabled members to ABSENT itself.
- `gstack-lane commit --run-dir <d> --task <id> -m <msg>` (task worktree) or `gstack-lane commit --cwd
  <worktree> --base <sha> -m <msg>` (milestone WIP commit, step c) — stages changes, REFUSES
  (exit 1, nothing new committed) if any credential-shaped path appears in the staged delta OR anywhere in
  `git diff --name-only <recorded base>..HEAD` (all task commits — E7), reporting the offending commit(s);
  never returns a `result_sha` containing one. **Secret-guard precision (H7):** auth.json, .credentials.json,
  .claude.json, *.pem, *.key, *.ppk, *.p12, *.pfx, *.keystore, *.jks, id_rsa*, id_ed25519*, id_ecdsa*, id_dsa*,
  .env, .env.*, .netrc, _netrc, .git-credentials, .pgpass, *codex-home*; `.npmrc`/`.pypirc`/`.yarnrc.yml` only
  when their content holds an auth/token/password key; under `.claude*/` only credential-shaped basenames
  (`.credentials.json`, `auth.json`, `*.key`, `*token*`); ALLOWED: `.env.example|.env.sample|.env.template|
  .env.*.example|*.example`, `.claude/settings.json`, `.claude/commands/*`. A staged LFS/git-crypt filtered
  path is refused too, printing `filter_path=<p> filter=<driver>` (the skill surfaces it in the BLOCKED
  message). Prints `result_sha=<sha>` and `base_sha=<sha>`.
  **F2 — inert commit path:** every git call runs with `GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null
  -c core.hooksPath=/dev/null -c core.fsmonitor=false`, `commit --no-verify`, and every repo-configured
  `filter.<name>` neutralized (clean/smudge → `cat`, empty `process`, `required=false`) so no
  repo-controlled command executes; the git control-state fingerprint taken at `worktree add` (stored
  with the base) is re-verified at `commit` — a mismatch refuses with `control_changed=<what>`, exit 1.
- `gstack-lane worktree add|rm --run-dir <dir> --task <id> [--base <ref>] [--detach]` — creates/removes
  `<dir>/wt/<id>` on branch `ab/<run-id>/<id>` (or detached at a SHA for review snapshots); `add` prints
  `base_sha=<sha>` on stdout and records the control-state fingerprint alongside it.
- No-timeout-binary fallback must still enforce the deadline (bash watchdog), never run unbounded.
  Output cleanup checks every delete target against the resolved input paths (prompt, schema) first.

## Gate forum changes (template Quick reference)

- **Gate start (one top-level Bash call per gate round):** re-probe lanes that were absent/cooling in the
  last roster (`gstack-lane probe --lanes …`; only `*_reviews=disabled` persists across gates — also done at
  each milestone start before dispatch); set `GATE_CLASS`; resolve BOTH diff endpoints ONCE as immutable
  SHAs — `BASE_SHA` from `origin/<base>` (else `<base>`) and `REVIEWED_SHA` from `HEAD^{commit}` — record
  them in `$RUN_DIR/gates/<m>/env`, give both members the same `BASE_SHA...REVIEWED_SHA` range (T2: a
  moving `origin/<base>` can advance between the two launches), and create one detached worktree PER member
  at `REVIEWED_SHA` (never a moving ref, never shared).
- **Self-contained recipes:** every recipe is an independent Bash call — each re-declares the helper path,
  sources the gate env (GATE_CLASS, BASE_SHA, REVIEWED_SHA) and calls `gstack-lane adjudicate` for its
  verdict (no prose adjudication function remains — D4/T1); `$RUN_DIR`/`<m>`/`<base>` are substituted with
  literals before running.
- Codex member: `gpt-6.1-sol` ordinary milestones; `gpt-6-astra` for milestones containing a T3 task
  and for the final milestone (`GATE_CLASS=critical`). Ladders: Sol high 600 s → medium 300 s; Astra
  high 900 s → medium 420 s (`--timeout`/`--retry-timeout`). Hermetic `CODEX_HOME`. Never `ultra`.
  The Codex seat is PRESENT only with a verified, policy-compatible `runtime_model` (rollout-sourced).
- Grok member: latest model (helper-resolved, D4), `--reasoning-effort high` 600 s → medium 300 s,
  `--permission-mode plan` + `--sandbox read-only` (mandatory; sandbox unavailable ⇒ ABSENT unless
  `grok_allow_unsandboxed=true`), in its OWN detached review worktree. L4 is the ONLY seat with the
  `model_mismatch` concession.
- Both members launched by the orchestrator (D1), each into a fresh attempt dir (D3); `gstack-lane
  adjudicate` runs INVALID-before-ABSENT (see Evidence): `tainted`, any helper-written `class: error`
  (rejected / crash / non-zero exit even with `[P1]`s in the body), empty body, stale `reviewed_sha`, Codex
  runtime_model null/off-policy → INVALID; ABSENT is reserved for disabled / auth / quota / timeout /
  throttle and a launch that never ran (no VERDICT line). INVALID never maps to ABSENT: on a critical gate →
  `BLOCKED` (AskUserQuestion retry / waive / stop); on an ordinary gate the gate cannot pass until the member
  is re-run clean at the same `reviewed_sha` (counts as a gate round).
- **Gate verdicts are mechanical (T6):** an R/Haiku worker may only run `gstack-lane adjudicate` and relay
  its line verbatim; reading or interpreting finding text beyond the helper's `p1_count` (e.g. briefing the
  fix round) is synthesis-tier work (orchestrator / Opus 5.5 / Fable), never Haiku's.
- **Step-0 vendor-diversity question (T5):** if the plan contains T3 work and L4 is disabled/absent, the
  skill warns and asks ONCE — enable grok / waive the second other-vendor seat for T3 this run (Codex + a
  fresh Claude seat, gates `DEGRADED`, verdict `COMPLETE_UNVERIFIED`) / stop — never an indefinite `BLOCKED`
  without that question.
- **Milestone WIP commit** goes through the helper's secret guard: `gstack-lane commit --cwd <milestone
  worktree> --base <milestone base sha> -m <msg>`; a refusal ⇒ the milestone is `BLOCKED` with the offending
  paths (never a bare `git add -A && git commit`).
- **Deferral valve:** if either milestone in the covered union contains a T3 task, the covering gate's
  `GATE_CLASS` is `critical`.
- **Verdict vs diversity (D7):** ordinary milestone with ≥ 1 ABSENT member may pass but is `DEGRADED`
  (never `CLEAN`); any `DEGRADED` gate or waived other-vendor seat makes `COMPLETE_VERIFIED` illegal — the
  run ends `COMPLETE_UNVERIFIED` with the reason (Completion Status `DONE_WITH_CONCERNS`). A milestone
  containing a T3 task and the FINAL milestone require ≥ 1 other-vendor (non-Claude) member PRESENT and
  valid, else the gate is `BLOCKED` with an AskUserQuestion (retry later / waive / stop).
- Remove the unbounded `{ shift; "$@"; }` fallback when the timeout wrapper is missing.
- Fix stale prose: `grok_reviews` defaults to `disabled` in `bin/gstack-config`; only an explicit
  `enabled` turns the Grok member on — and that switch gates EVERY L4 use.
- Union-FAIL semantics, per-gate ABSENT, fail-closed, and the pinned recipe-invariant strings are unchanged.

## Out of scope (follow-ups)

- `bin/gstack-panel` / outside-voices registry still use `grok --sandbox read-only`, which refuses to
  start on OrbStack Macs — same breakage, separate fix.
- Adaptive cap ramp-up from measured accepted-throughput (v1.8).
- Automatic L2 login — the operator must log in interactively once.

### Documented residuals (post-merge security review)

- **`--allow-cmd` vets the prefix only.** Claude's `Bash(prefix:*)` permission permits arbitrary trailing
  arguments, so granting L2 impl a check command (`bun test`, `npm test`, …) means repo code runs as the
  operator — inherent to "run the tests" with no OS boundary (the same exposure every L1 Agent-tool
  implementer has). Only L3 (codex `workspace-write`) runs its checks inside an OS sandbox.
- **Grok is reviewer-only, sandboxed by default.** grok merges repo-checked-in `.grok/config.toml`
  permission grants, so it cannot be isolated for implementation; the helper rejects `--lane l4 --mode
  impl`. Reviews run only inside grok's OS sandbox; when it cannot apply L4 is ABSENT — the unsandboxed
  (plan-only) fallback is OPT-IN only (`grok_allow_unsandboxed=true`, status `sandbox: none,
  unsandboxed_opt_in: true`) and remains not OS-contained (F8). Before each L4 review the helper strips
  repo grok/agent config (`.grok/`, `.envrc`, matched case-insensitively) from the disposable review
  worktree and refuses populated submodules.

### v1.7.1 follow-ups (from the pre-merge eng review)

- **Helper-enforced caps (D6):** `gstack-lane run` counts in-flight attempts per lane and refuses with a new
  class `busy` (exit 6) at the per-lane cap; the skill treats `busy` as "wait, do not spill". Caps are
  prose-only in 1.7.0.
- **Carve the gate recipes (D8):** move the forum recipes + routing tables into `autobuilder-loop/sections/`
  loaded at gate time (the repo's carve pattern); `test/autobuilder-forum-divergence.test.ts` pins the
  directory contents and must be updated in the same change.
- **Skill-e2e eval for INVALID-before-ABSENT (D11):** one case feeding the orchestrator a synthetic
  `lanes.json` + two status files (one `tainted: true` with `[P1]`s in the body) and asserting the gate is
  reported INVALID/BLOCKED, never ABSENT/DEGRADED.
- **Embedded JS → `lib/gstack-lane/*.ts` (D1):** move the ~400-line classifier/state-machine heredoc out of
  `bin/gstack-lane` into type-checked, unit-testable modules run via `bun`; bash keeps process control.
