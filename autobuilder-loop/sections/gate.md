<!-- AUTO-GENERATED from gate.md.tmpl — do not edit directly -->
<!-- Regenerate: bun run gen:skill-docs -->
<!-- PRESERVED:round1-6:BEGIN -->
**c. MILESTONE GATE (MANDATORY — run on EVERY milestone before it can be marked complete).**
No major/minor distinction, no "it's trivial" skip; the ONLY carve-out is a milestone the plan
labels docs-only. **First, commit the milestone's work** through the helper's secret guard —
`gstack-lane commit --cwd "<milestone worktree>" --base <milestone base sha> -m "wip(<m>): <summary>"`;
a refusal (`secret_path=` / `filter_path=`) makes the milestone `BLOCKED` with those paths (never
`git add -A && git commit` around it). Every commit the script or a lane
makes goes through `gstack-lane commit`, or the head gets this same guard scan before any push — no
raw `git commit` path reaches a push. Members diff the frozen `BASE_SHA...REVIEWED_SHA` range, which
sees ONLY committed state; the Worktree preflight is what makes stage-everything safe here.

<!-- v1.8 decision D-B --> **The forum is two model seats per round, run in parallel** (Quick reference):
- **Seat C (Claude)** — ONE Fable `effort: high` subagent runs BOTH the /plan-eng-review methodology
  and the /review checklist in a single pass, reading `sections/seat-c-review.md` from this installed
  skill and its canonical checklist in full, findings-only. Missing or unreadable required references
  mean REVIEW_INCOMPLETE, never clean.
- **Seat X (other vendor)** — Codex `gpt-6-astra` high through `gstack-lane run --mode review`.
Codex-authored work gets its other-vendor check from Seat C, Claude-authored work from Seat X; both
seats always run. A seat's raw `[P1]` is a seat FAIL that goes to consolidation; the gate verdict is
computed after it — a kept `[P1]` from EITHER model FAILs the gate. INVALID evidence is a FAIL, never
ABSENT. A seat ABSENT makes the gate `DEGRADED`, never `CLEAN`.

**Non-model members, path-scoped.** <!-- retro-2026-10-19 item 3 --> **Docker** (step d): FULL runs it
once in round 1; LITE only when the unit touches a trigger glob; both re-run it only when a fix delta
touches a **Docker trigger glob**:
`**/docker-compose*.y*ml`, `**/compose*.y*ml`, `**/Dockerfile*`, `**/.env*`, `**/env.{ts,mjs,js}`,
`**/env/**`, `**/migrations/**`, `**/*.sql`, `**/prisma/schema.prisma`, `**/app/**/route.*`,
`**/app/**/page.*`, `**/app/**/layout.*`, `**/pages/**`, `**/api/**`, `**/middleware.*`. The
**mutation probe** runs AFTER the seats, off their critical path. Round 1 runs EVERY brief-named
mutation target plus (FULL only; LITE runs brief-named only) AT MOST 10 mutants of its own choosing
(the riskiest invariants), listing which it chose. Severity (the mutation rule): P1 (blocks the gate): a surviving BRIEF-NAMED mutant, a survivor
from an earlier round that a fix claimed to kill, or any survivor whose survival reveals a
production-reachable defect (wrong behaviour, not just a weaker test). Other surviving own mutants
that expose a real test-strength gap on CORRECT code are P2 fix-now, each re-verified by re-running
exactly that mutant; equivalent / redundant mutants are not a finding. In round N>1 the probe runs only
the mutants the round's fixes name plus any brief-named mutant whose target file changed; repeated
concurrency suites (e.g. a 5x multi-connection run) re-run only when a touched file has one.

**Consolidate, with the rulings register.** <!-- retro-2026-10-19 item 2 --> Consolidation is
synthesis-tier work (the script's consolidator, Fable → Opus 5.5 → Opus 4.8; never a forum member,
never an earlier Opus 5). `$RUN_DIR/gates/<m>/rulings.json` holds one entry per adjudicated claim:
`claim_id` (short hash of file + one-line gist), `disposition` (kept-P1 / downgraded-P2 / refuted /
deferred-to <id> / out-of-scope), `reason` (one sentence, code-cited), `round`, `member`. The
consolidator reads it BEFORE verifying — a claim already in it is not re-verified; a member re-raising
it without a new fact is recorded as **"re-raise"** and counts as PASS for that claim — and rewrites it
after every round. Both seat prompts get it prepended as "Already adjudicated in this unit (do not
re-file without new facts)". It survives resume and goes into the audit-trail hand-off. CHANGELOG and
docs prose is never `[P1]`. <!-- retro-2026-10-19 item 9 --> The consolidator returns
`{verdict: CLEAN|DEGRADED|FAIL|BLOCKED, members_present: {seat_c, seat_x, docker, mutation}, p1[] (kept),
fixes[], deferred_p2[]}`; a seat missing from `members_present` forces `DEGRADED` or worse.

**Gate termination — `CLEAN` means zero kept `[P1]`.** <!-- retro-2026-10-19 item 1 -->
- The verdict is `CLEAN` when every PRESENT member returned a completed review with zero kept `[P1]`
  and both seats are PRESENT. P2 fix-now items never block `CLEAN` and never trigger a full round.
- P2 fix-now items get ONE owner-routed fix pass (Haiku max unless a T2/T3 task owns the file),
  verified by a **scoped delta review**: ONE Claude seat (Fable or Opus 5.5) over the fix delta plus a
  re-run of the mutants the fixes name. Its verdict closes the gate.
- An INVALID seat is re-run at the same `REVIEWED_SHA` BEFORE any fix pass, even when kept `[P1]`s exist.
- A full re-round happens only after a kept `[P1]` fix, and re-runs only the members that FAILed plus any
  member whose evidence the fix invalidates (Docker and mutation per the path rules above). A member
  that PASSed and whose range is unaffected keeps its verdict with a note.
- Rounds count full rounds only (delta reviews never count); the cap comes from the policy packet.
Fix commits land through `gstack-lane commit` before any re-review. Deferred P2s and other gate-born
follow-ups go to the hardening batch (step 2). Log one review-log entry PER seat (Quick reference).

**Bounded deferral valve (not a free skip).** A genuinely small milestone's gate may be batched
into the NEXT milestone's gate under strict bounds, all four of which hold:
1. At most ONE milestone of deferral (never batch two milestones forward).
2. NEVER batch a milestone that touches security, auth, migrations, or public interfaces.
3. The FINAL milestone's gate is never deferrable.
4. A batched milestone is marked **"built — gate pending"** (`<!-- status: built-gate-pending -->`
   when the plan carries markers), NOT complete, until its covering gate runs clean. The covering gate
   reviews the UNION: both milestones' full diff range AND both sets of acceptance criteria. If EITHER
   milestone contains a T3 task, the covering gate's `GATE_CLASS` is `critical`.
Say so explicitly when you batch. If you cannot satisfy all four, gate the milestone now.

**d. LOCAL DOCKER VERIFICATION (MANDATORY — before a milestone counts as done; path-scoped per step c).**
A LITE unit touching no trigger glob skips it: targeted tests stand in and the next Docker run at a
later head covers it. A critical gate (`gateClass: critical` — T3 or FINAL) is never LITE and runs
Docker in round 1.

- **Detect** the setup: a subagent globs compose files / `Dockerfile*` / a `Makefile` with an
  `up`/`dev`/`run` target (`find . -maxdepth 4`) and derives the host port from the compose `ports:`
  HOST:CONTAINER mapping — do NOT assume 3000.
- **No runnable setup found?** This is NOT a silent skip. AskUserQuestion ONCE:
  - **A) Point me at the runnable setup** — the user names the compose file / command / port,
    and verification proceeds.
  - **B) Waive Docker verification** — the final verdict becomes `COMPLETE_UNVERIFIED`. Record
    the waiver in the Build Audit Trail (`waived_by_user: true`, timestamp, reason, residual
    risk). This is the ONLY Docker path to `COMPLETE_UNVERIFIED` (the other is a degraded forum).
  - **C) Stop** — surface `BLOCKED`.
  Absent a recorded user waiver, "no Docker setup found" is `BLOCKED`, never an implicit waiver.
- **Bring it up:** a subagent runs the project's own wrapper first (`make up`), else
  `docker compose up -d --wait`. Reachability gate: `curl -s -o /dev/null -w '%{http_code}'
  http://localhost:PORT` against the app root or a declared health endpoint, polled with a hard
  deadline (default 120s overall, `--connect-timeout 5 --max-time 10` per probe; deadline
  expiry = FAIL, never an indefinite wait). **A 2xx/3xx is up; a 4xx/5xx is a FAIL** — unless the
  plan explicitly declares that status expected for the probed path. Also confirm `docker compose
  ps` shows services healthy with no restart loop. `NO_SERVER` is a FAIL of "functional", never a
  pass or skip.
- **Exercise end-to-end:** for a web app, a subagent reads
  `~/.claude/skills/gstack/browse/SKILL.md` from disk (which bootstraps the `$B` browse alias)
  and drives the running URL (`$B goto → text → console --errors → network → snapshot -i/-D`)
  across the milestone's critical paths — following qa/SKILL.md's testing methodology for coverage,
  reporting issues in the envelope and never fixing or committing. For non-web, run the smoke/test
  suite. Confirm zero console/network errors and every acceptance-criterion path PASS.
- Fix via routed subagents until green; never mark done on a red or untested build. You get the
  compact verdict + evidence lines, never raw logs.
- **Docker-fix changes re-enter the gate.** Config-only fixes (env, compose, ports) → note them
  in the audit trail. CODE fixes made during this step happened AFTER the gate reviewed the
  diff — run the scoped delta review on the fix delta before step e. Post-gate code is ungated code.

**e. Mark complete.** An **R-class Haiku** subagent marks the milestone complete (or **"built — gate
pending"** if batched), updating a `/plan-deliverables` status marker in place, and appends the Build
Audit Trail row — not in your context.
<!-- PRESERVED:round1-6:END -->
