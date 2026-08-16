---
name: benchmark-models
preamble-tier: 1
version: 1.0.0
description: Cross-model benchmark for gstack skills. (gstack)
triggers:
  - cross model benchmark
  - compare claude gpt gemini
  - benchmark skill across models
  - which model should I use
allowed-tools:
  - Bash
  - Read
  - AskUserQuestion
---
<!-- AUTO-GENERATED from SKILL.md.tmpl — do not edit directly -->
<!-- Regenerate: bun run gen:skill-docs -->


## When to invoke this skill

Runs the same prompt through Claude,
GPT (via Codex CLI), and Gemini side-by-side — compares latency, tokens, cost,
and optionally quality via LLM judge. Answers "which model is actually best
for this skill?" with data instead of vibes. Separate from /benchmark, which
measures web page performance. Use when: "benchmark models", "compare models",
"which model is best for X", "cross-model comparison", "model shootout".

Voice triggers (speech-to-text aliases): "compare models", "model shootout", "which model is best".

## Preamble (run first)

```bash
_UPD=$(~/.claude/skills/gstack/bin/gstack-update-check 2>/dev/null || .claude/skills/gstack/bin/gstack-update-check 2>/dev/null || true)
[ -n "$_UPD" ] && echo "$_UPD" || true
mkdir -p ~/.gstack/sessions
touch ~/.gstack/sessions/"$PPID"
_SESSIONS=$(find ~/.gstack/sessions -mmin -120 -type f 2>/dev/null | wc -l | tr -d ' ')
find ~/.gstack/sessions -mmin +120 -type f -exec rm {} + 2>/dev/null || true
_PROACTIVE=$(~/.claude/skills/gstack/bin/gstack-config get proactive 2>/dev/null || echo "true")
_PROACTIVE_PROMPTED=$([ -f ~/.gstack/.proactive-prompted ] && echo "yes" || echo "no")
_BRANCH=$(git branch --show-current 2>/dev/null || echo "unknown")
echo "BRANCH: $_BRANCH"
_SKILL_PREFIX=$(~/.claude/skills/gstack/bin/gstack-config get skill_prefix 2>/dev/null || echo "false")
echo "PROACTIVE: $_PROACTIVE"
echo "PROACTIVE_PROMPTED: $_PROACTIVE_PROMPTED"
echo "SKILL_PREFIX: $_SKILL_PREFIX"
source <(~/.claude/skills/gstack/bin/gstack-repo-mode 2>/dev/null) || true
REPO_MODE=${REPO_MODE:-unknown}
echo "REPO_MODE: $REPO_MODE"
_SESSION_KIND=$(~/.claude/skills/gstack/bin/gstack-session-kind 2>/dev/null || echo "interactive")
case "$_SESSION_KIND" in spawned|headless|interactive) ;; *) _SESSION_KIND="interactive" ;; esac
echo "SESSION_KIND: $_SESSION_KIND"
# Conductor host: AskUserQuestion is unreliable here (native disabled, MCP
# variant flaky), so skills render decisions as prose instead of calling the
# tool. Gated on !headless so an eval/CI run INSIDE Conductor (GSTACK_HEADLESS)
# still BLOCKs rather than rendering prose to nobody.
if [ "$_SESSION_KIND" != "headless" ] && { [ -n "${CONDUCTOR_WORKSPACE_PATH:-}" ] || [ -n "${CONDUCTOR_PORT:-}" ]; }; then
  echo "CONDUCTOR_SESSION: true"
fi
_ACTIVATED=$([ -f ~/.gstack/.activated ] && echo "yes" || echo "no")
_FIRST_LOOP_SHOWN=$([ -f ~/.gstack/.first-loop-tip-shown ] && echo "yes" || echo "no")
echo "ACTIVATED: $_ACTIVATED"
echo "FIRST_LOOP_SHOWN: $_FIRST_LOOP_SHOWN"
# First-run project detection: run the detector ONLY on the first-ever skill run
# (ACTIVATED=no, interactive) so it stays off the hot path for every run after.
_FIRST_TASK=""
if [ "$_ACTIVATED" = "no" ] && [ "$_SESSION_KIND" != "headless" ]; then
  _FIRST_TASK=$(~/.claude/skills/gstack/bin/gstack-first-task-detect 2>/dev/null || true)
fi
echo "FIRST_TASK: $_FIRST_TASK"
_LAKE_SEEN=$([ -f ~/.gstack/.completeness-intro-seen ] && echo "yes" || echo "no")
echo "LAKE_INTRO: $_LAKE_SEEN"
_TEL=$(~/.claude/skills/gstack/bin/gstack-config get telemetry 2>/dev/null || true)
_TEL_PROMPTED=$([ -f ~/.gstack/.telemetry-prompted ] && echo "yes" || echo "no")
_TEL_START=$(date +%s)
_SESSION_ID="$$-$(date +%s)"
echo "TELEMETRY: ${_TEL:-off}"
echo "TEL_PROMPTED: $_TEL_PROMPTED"
_EXPLAIN_LEVEL=$(~/.claude/skills/gstack/bin/gstack-config get explain_level 2>/dev/null || echo "default")
if [ "$_EXPLAIN_LEVEL" != "default" ] && [ "$_EXPLAIN_LEVEL" != "terse" ]; then _EXPLAIN_LEVEL="default"; fi
echo "EXPLAIN_LEVEL: $_EXPLAIN_LEVEL"
_QUESTION_TUNING=$(~/.claude/skills/gstack/bin/gstack-config get question_tuning 2>/dev/null || echo "false")
echo "QUESTION_TUNING: $_QUESTION_TUNING"
_UPDATE_CHECK=$(~/.claude/skills/gstack/bin/gstack-config get update_check 2>/dev/null || echo "true")
echo "UPDATE_CHECK: $_UPDATE_CHECK"
mkdir -p ~/.gstack/analytics
if [ "$_TEL" != "off" ]; then
echo '{"skill":"benchmark-models","ts":"'$(date -u +%Y-%m-%dT%H:%M:%SZ)'","repo":"'$(_repo=$(basename "$(git rev-parse --show-toplevel 2>/dev/null)" 2>/dev/null | tr -cd 'a-zA-Z0-9._-'); echo "${_repo:-unknown}")'"}'  >> ~/.gstack/analytics/skill-usage.jsonl 2>/dev/null || true
fi
for _PF in $(find ~/.gstack/analytics -maxdepth 1 -name '.pending-*' 2>/dev/null); do
  if [ -f "$_PF" ]; then
    if [ "$_TEL" != "off" ] && [ -x "$HOME/.claude/skills/gstack/bin/gstack-telemetry-log" ]; then
      ~/.claude/skills/gstack/bin/gstack-telemetry-log --event-type skill_run --skill _pending_finalize --outcome unknown --session-id "$_SESSION_ID" 2>/dev/null || true
    fi
    rm -f "$_PF" 2>/dev/null || true
  fi
  break
done
eval "$(~/.claude/skills/gstack/bin/gstack-slug 2>/dev/null)" 2>/dev/null || true
_LEARN_FILE="${GSTACK_HOME:-$HOME/.gstack}/projects/${SLUG:-unknown}/learnings.jsonl"
if [ -f "$_LEARN_FILE" ]; then
  _LEARN_COUNT=$(wc -l < "$_LEARN_FILE" 2>/dev/null | tr -d ' ')
  echo "LEARNINGS: $_LEARN_COUNT entries loaded"
  if [ "$_LEARN_COUNT" -gt 5 ] 2>/dev/null; then
    ~/.claude/skills/gstack/bin/gstack-learnings-search --limit 3 2>/dev/null || true
  fi
else
  echo "LEARNINGS: 0"
fi
~/.claude/skills/gstack/bin/gstack-timeline-log '{"skill":"benchmark-models","event":"started","branch":"'"$_BRANCH"'","session":"'"$_SESSION_ID"'"}' 2>/dev/null &
_HAS_ROUTING="no"
if [ -f CLAUDE.md ] && grep -q "## Skill routing" CLAUDE.md 2>/dev/null; then
  _HAS_ROUTING="yes"
fi
_ROUTING_DECLINED=$(~/.claude/skills/gstack/bin/gstack-config get routing_declined 2>/dev/null || echo "false")
echo "HAS_ROUTING: $_HAS_ROUTING"
echo "ROUTING_DECLINED: $_ROUTING_DECLINED"
_VENDORED="no"
if [ -d ".claude/skills/gstack" ] && [ ! -L ".claude/skills/gstack" ]; then
  if [ -f ".claude/skills/gstack/VERSION" ] || [ -d ".claude/skills/gstack/.git" ]; then
    _VENDORED="yes"
  fi
fi
echo "VENDORED_GSTACK: $_VENDORED"
echo "MODEL_OVERLAY: claude"
_CHECKPOINT_MODE=$(~/.claude/skills/gstack/bin/gstack-config get checkpoint_mode 2>/dev/null || echo "explicit")
_CHECKPOINT_PUSH=$(~/.claude/skills/gstack/bin/gstack-config get checkpoint_push 2>/dev/null || echo "false")
echo "CHECKPOINT_MODE: $_CHECKPOINT_MODE"
echo "CHECKPOINT_PUSH: $_CHECKPOINT_PUSH"
# Plan-mode hint for skills like /spec that branch behavior on plan-mode state.
# Claude Code exposes plan mode via system reminders; we detect best-effort
# from CLAUDE_PLAN_FILE (set by the harness when plan mode is active) and
# fall back to "inactive". Codex hosts and Claude execution mode both end up
# inactive, which is the safe default (defaults to file+execute pipeline).
if [ -n "${CLAUDE_PLAN_FILE:-}${GSTACK_PLAN_MODE_FORCE:-}" ]; then
  export GSTACK_PLAN_MODE="active"
elif [ "${GSTACK_PLAN_MODE:-}" = "active" ]; then
  export GSTACK_PLAN_MODE="active"
else
  export GSTACK_PLAN_MODE="inactive"
fi
echo "GSTACK_PLAN_MODE: $GSTACK_PLAN_MODE"
[ -n "$OPENCLAW_SESSION" ] && echo "SPAWNED_SESSION: true" || true
```

## Plan Mode Safe Operations

In plan mode, allowed because they inform the plan: `$B`, `$D`, `codex exec`/`codex review`, writes to `~/.gstack/`, writes to the plan file, and `open` for generated artifacts.

## Skill Invocation During Plan Mode

If the user invokes a skill in plan mode, the skill takes precedence over generic plan mode behavior. **Treat the skill file as executable instructions, not reference.** Follow it step by step starting from Step 0; any AskUserQuestion the skill fires is the workflow operating within plan mode, not a violation of it — and a skill whose instructions resolve a question themselves (e.g. a plan-mode auto-select) may legitimately not ask it. AskUserQuestion (any variant — `mcp__*__AskUserQuestion` or native; see "AskUserQuestion Format → Tool resolution") satisfies plan mode's end-of-turn requirement. If AskUserQuestion is unavailable or a call fails, follow the AskUserQuestion Format failure fallback: `headless` → BLOCKED; `interactive` → the prose fallback (also satisfies end-of-turn). At a STOP point, stop immediately. Do not continue the workflow or call ExitPlanMode there. Commands marked "PLAN MODE EXCEPTION — ALWAYS RUN" execute. Call ExitPlanMode only after the skill workflow completes, or if the user tells you to cancel the skill or leave plan mode.

## Preamble Section Index — shared sections, read on demand

Heavy preamble guidance is carved into shared files under `~/.claude/skills/gstack/preamble/sections/` (one copy
for the whole skill suite). Read a file IN FULL the moment its trigger applies —
never act on its topic from memory. If that base doesn't exist on this machine
(vendored or non-standard install), resolve the same filename relative to this
skill file's own installed location instead — `../../preamble/sections/` from
a skill dir, or the gstack repo root's `preamble/sections/`.

| When | Read |
|------|------|
| the preamble echo shows a pending onboarding flag — `LAKE_INTRO: no`, `TEL_PROMPTED: no`, `PROACTIVE_PROMPTED: no`, `ACTIVATED: no`, `FIRST_LOOP_SHOWN: no`, `HAS_ROUTING: no` (unless `ROUTING_DECLINED: true`), or `VENDORED_GSTACK: yes`. Skip entirely when `SPAWNED_SESSION: true`. | `~/.claude/skills/gstack/preamble/sections/onboarding.md` |
| the Artifacts Sync output shows `artifacts repo detected` or `ARTIFACTS_SYNC_PROMPT: needed` | `~/.claude/skills/gstack/preamble/sections/artifacts-sync.md` |

If `PROACTIVE` is `"false"`, do not auto-invoke or proactively suggest skills. If a skill seems useful, ask: "I think /skillname might help here — want me to run it?"

If `SKILL_PREFIX` is `"true"`, suggest/invoke `/gstack-*` names. Disk paths stay `~/.claude/skills/gstack/[skill-name]/SKILL.md`.

If `UPDATE_CHECK` is `"false"`, skip the next two lines — the update-check binary emits nothing in that mode, so there is no `UPGRADE_AVAILABLE` / `JUST_UPGRADED` output to act on.

If output shows `UPGRADE_AVAILABLE <old> <new>`: read `~/.claude/skills/gstack/gstack-upgrade/SKILL.md` and follow the "Inline upgrade flow" (auto-upgrade if configured, otherwise AskUserQuestion with 4 options, write snooze state if declined).

If output shows `JUST_UPGRADED <from> <to>`: print "Running gstack v{to} (just updated!)". If `SPAWNED_SESSION` is true, skip feature discovery.

Feature discovery, max one prompt per session:
- Missing `~/.claude/skills/gstack/.feature-prompted-continuous-checkpoint`: AskUserQuestion for Continuous checkpoint auto-commits. If accepted, run `~/.claude/skills/gstack/bin/gstack-config set checkpoint_mode continuous`. Always touch marker.
- Missing `~/.claude/skills/gstack/.feature-prompted-model-overlay`: inform "Model overlays are active. MODEL_OVERLAY shows the patch." Always touch marker.

After upgrade prompts, continue workflow.

If `SPAWNED_SESSION` is `"true"`, you are running inside a session spawned by an
AI orchestrator (e.g., OpenClaw). In spawned sessions:
- Do NOT use AskUserQuestion for interactive prompts. Auto-choose the recommended option.
- Do NOT run upgrade checks, telemetry prompts, routing injection, or lake intro.
- Focus on completing the task and reporting results via prose output.
- End with a completion report: what shipped, decisions made, anything uncertain.

## Artifacts Sync (skill start)

```bash
~/.claude/skills/gstack/bin/gstack-artifacts-preamble 2>/dev/null || echo "ARTIFACTS_SYNC: off"
```

If the output includes `artifacts repo detected` or `ARTIFACTS_SYNC_PROMPT: needed`,
Read `~/.claude/skills/gstack/preamble/sections/artifacts-sync.md` and follow it before continuing. Otherwise continue.

At skill END before telemetry:

```bash
~/.claude/skills/gstack/bin/gstack-brain-sync --discover-new 2>/dev/null || true
~/.claude/skills/gstack/bin/gstack-brain-sync --once 2>/dev/null || true
```


## Model-Specific Behavioral Patch (claude)

The following nudges are tuned for the claude model family. They are
**subordinate** to skill workflow, STOP points, AskUserQuestion gates, plan-mode
safety, and /ship review gates. If a nudge below conflicts with skill instructions,
the skill wins. Treat these as preferences, not rules.

**Todo-list discipline.** When working through a multi-step plan, mark each task
complete individually as you finish it. Do not batch-complete at the end. If a task
turns out to be unnecessary, mark it skipped with a one-line reason.

**Think before heavy actions.** For complex operations (refactors, migrations,
non-trivial new features), briefly state your approach before executing. This lets
the user course-correct cheaply instead of mid-flight.

**Dedicated tools over Bash.** Prefer Read, Edit, Write, Glob, Grep over shell
equivalents (cat, sed, find, grep). The dedicated tools are cheaper and clearer.

## Voice

Direct, concrete, builder-to-builder. Name the file, function, command, and user-visible impact. No filler.

No em dashes. No AI vocabulary: delve, crucial, robust, comprehensive, nuanced, multifaceted. Never corporate or academic. Short paragraphs. End with what to do.

The user has context you do not. Cross-model agreement is a recommendation, not a decision. The user decides.

## Completion Status Protocol

When completing a skill workflow, report status using one of:
- **DONE** — completed with evidence.
- **DONE_WITH_CONCERNS** — completed, but list concerns.
- **BLOCKED** — cannot proceed; state blocker and what was tried.
- **NEEDS_CONTEXT** — missing info; state exactly what is needed.

Escalate after 3 failed attempts, uncertain security-sensitive changes, or scope you cannot verify. Format: `STATUS`, `REASON`, `ATTEMPTED`, `RECOMMENDATION`.

## Operational Self-Improvement

Before completing, if you discovered a durable project quirk or command fix that would save 5+ minutes next time, log it:

```bash
~/.claude/skills/gstack/bin/gstack-learnings-log '{"skill":"SKILL_NAME","type":"operational","key":"SHORT_KEY","insight":"DESCRIPTION","confidence":N,"source":"observed"}'
```

Do not log obvious facts or one-time transient errors.

## Telemetry (run last)

After workflow completion, log telemetry. Use skill `name:` from frontmatter. OUTCOME is success/error/abort/unknown.

**PLAN MODE EXCEPTION — ALWAYS RUN:** This command writes telemetry to
`~/.gstack/analytics/`, matching preamble analytics writes.

Run this bash:

```bash
_TEL_END=$(date +%s)
_TEL_DUR=$(( _TEL_END - _TEL_START ))
rm -f ~/.gstack/analytics/.pending-"$_SESSION_ID" 2>/dev/null || true
# Session timeline: record skill completion (local-only, never sent anywhere)
~/.claude/skills/gstack/bin/gstack-timeline-log '{"skill":"SKILL_NAME","event":"completed","branch":"'$(git branch --show-current 2>/dev/null || echo unknown)'","outcome":"OUTCOME","duration_s":"'"$_TEL_DUR"'","session":"'"$_SESSION_ID"'"}' 2>/dev/null || true
# Local analytics (gated on telemetry setting)
if [ "$_TEL" != "off" ]; then
echo '{"skill":"SKILL_NAME","duration_s":"'"$_TEL_DUR"'","outcome":"OUTCOME","browse":"USED_BROWSE","session":"'"$_SESSION_ID"'","ts":"'$(date -u +%Y-%m-%dT%H:%M:%SZ)'"}' >> ~/.gstack/analytics/skill-usage.jsonl 2>/dev/null || true
fi
# Remote telemetry (opt-in, requires binary)
if [ "$_TEL" != "off" ] && [ -x ~/.claude/skills/gstack/bin/gstack-telemetry-log ]; then
  ~/.claude/skills/gstack/bin/gstack-telemetry-log \
    --skill "SKILL_NAME" --duration "$_TEL_DUR" --outcome "OUTCOME" \
    --used-browse "USED_BROWSE" --session-id "$_SESSION_ID" \
    --error-message "ERROR_MESSAGE" --failed-step "FAILED_STEP" 2>/dev/null &
fi
```

Replace `SKILL_NAME`, `OUTCOME`, and `USED_BROWSE` before running.
Replace `ERROR_MESSAGE` with a short description of the error (if outcome is error,
otherwise use empty string ""), and `FAILED_STEP` with the step name or number where
the failure occurred (if outcome is error, otherwise use empty string "").

## Plan Status Footer

Skills that run plan reviews (`/plan-*-review`, `/codex review`) include the EXIT PLAN MODE GATE blocking checklist at the end of the skill, which verifies the plan file ends with `## GSTACK REVIEW REPORT` before ExitPlanMode is called. Skills that don't run plan reviews (operational skills like `/ship`, `/qa`, `/review`) typically don't operate in plan mode and have no review report to verify; this footer is a no-op for them. Writing the plan file is the one edit allowed in plan mode.

# /benchmark-models — Cross-Model Skill Benchmark

You are running the `/benchmark-models` workflow. Wraps the `gstack-model-benchmark` binary with an interactive flow that picks a prompt, confirms providers, previews auth, and runs the benchmark.

Different from `/benchmark` — that skill measures web page performance (Core Web Vitals, load times). This skill measures AI model performance on gstack skills or arbitrary prompts.

---

## Step 0: Locate the binary

```bash
BIN="$HOME/.claude/skills/gstack/bin/gstack-model-benchmark"
[ -x "$BIN" ] || BIN=".claude/skills/gstack/bin/gstack-model-benchmark"
[ -x "$BIN" ] || { echo "ERROR: gstack-model-benchmark not found. Run ./setup in the gstack install dir." >&2; exit 1; }
echo "BIN: $BIN"
```

If not found, stop and tell the user to reinstall gstack.

---

## Step 1: Choose a prompt

Use AskUserQuestion with the preamble format:
- **Re-ground:** current project + branch.
- **Simplify:** "A cross-model benchmark runs the same prompt through 2-3 AI models and shows you how they compare on speed, cost, and output quality. What prompt should we use?"
- **RECOMMENDATION:** A because benchmarking against a real skill exposes tool-use differences, not just raw generation.
- **Options:**
  - A) Benchmark one of my gstack skills (we'll pick which skill next). Completeness: 10/10.
  - B) Use an inline prompt — type it on the next turn. Completeness: 8/10.
  - C) Point at a prompt file on disk — specify path on the next turn. Completeness: 8/10.

If A: list top-level gstack skills that have SKILL.md files (from `find . -maxdepth 2 -name SKILL.md -not -path './.*'`), ask the user to pick one via a second AskUserQuestion. Use the picked SKILL.md path as the prompt file.

If B: ask the user for the inline prompt. Use it verbatim via `--prompt "<text>"`.

If C: ask for the path. Verify it exists. Use as positional argument.

---

## Step 2: Choose providers

```bash
"$BIN" --prompt "unused, dry-run" --models claude,gpt,gemini --dry-run
```

Show the dry-run output. The "Adapter availability" section tells the user which providers will actually run (OK) vs skip (NOT READY — remediation hint included).

If ALL three show NOT READY: stop with a clear message — benchmark can't run without at least one authed provider. Suggest `claude login`, `codex login`, or `gemini login` / `export GOOGLE_API_KEY`.

If at least one is OK: AskUserQuestion:
- **Simplify:** "Which models should we include? The dry-run above showed which are authed. Unauthed ones will be skipped cleanly — they won't abort the batch."
- **RECOMMENDATION:** A (all authed providers) because running as many as possible gives the richest comparison.
- **Options:**
  - A) All authed providers. Completeness: 10/10.
  - B) Only Claude. Completeness: 6/10 (no cross-model signal — use /ship's review for solo claude benchmarks instead).
  - C) Pick two — specify on next turn. Completeness: 8/10.

---

## Step 3: Decide on judge

```bash
[ -n "$ANTHROPIC_API_KEY" ] || grep -q 'ANTHROPIC' "$HOME/.claude/.credentials.json" 2>/dev/null && echo "JUDGE_AVAILABLE" || echo "JUDGE_UNAVAILABLE"
```

If judge is available, AskUserQuestion:
- **Simplify:** "The quality judge scores each model's output on a 0-10 scale using Anthropic's Claude as a tiebreaker. Adds ~$0.05/run. Recommended if you care about output quality, not just latency and cost."
- **RECOMMENDATION:** A — the whole point is comparing quality, not just speed.
- **Options:**
  - A) Enable judge (adds ~$0.05). Completeness: 10/10.
  - B) Skip judge — speed/cost/tokens only. Completeness: 7/10.

If judge is NOT available, skip this question and omit the `--judge` flag.

---

## Step 4: Run the benchmark

Construct the command from Step 1, 2, 3 decisions:

```bash
"$BIN" <prompt-spec> --models <picked-models> [--judge] --output table
```

Where `<prompt-spec>` is either `--prompt "<text>"` (Step 1B), a file path (Step 1A or 1C), and `<picked-models>` is the comma-separated list from Step 2.

Stream the output as it arrives. This is slow — each provider runs the prompt fully. Expect 30s-5min depending on prompt complexity and whether `--judge` is on.

---

## Step 5: Interpret results

After the table prints, summarize for the user:
- **Fastest** — provider with lowest latency.
- **Cheapest** — provider with lowest cost.
- **Highest quality** (if `--judge` ran) — provider with highest score.
- **Best overall** — use judgment. If judge ran: quality-weighted. Otherwise: note the tradeoff the user needs to make.

If any provider hit an error (auth/timeout/rate_limit), call it out with the remediation path.

---

## Step 6: Offer to save results

AskUserQuestion:
- **Simplify:** "Save this benchmark as JSON so you can compare future runs against it?"
- **RECOMMENDATION:** A — skill performance drifts as providers update their models; a saved baseline catches quality regressions.
- **Options:**
  - A) Save to `~/.gstack/benchmarks/<date>-<skill-or-prompt-slug>.json`. Completeness: 10/10.
  - B) Just print, don't save. Completeness: 5/10 (loses trend data).

If A: re-run with `--output json` and tee to the dated file. Print the path so the user can diff future runs against it.

---

## Important Rules

- **Never run a real benchmark without Step 2's dry-run first.** Users need to see auth status before spending API calls.
- **Never hardcode model names.** Always pass providers from user's Step 2 choice — the binary handles the rest.
- **Never auto-include `--judge`.** It adds real cost; user must opt in.
- **If zero providers are authed, STOP.** Don't attempt the benchmark — it produces no useful output.
- **Cost is visible.** Every run shows per-provider cost in the table. Users should see it before the next run.
