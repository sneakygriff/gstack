export const meta = {
  name: 'autobuilder-unit',
  description: 'gstack /autobuilder-loop v1.8 reference ship-unit pipeline: refresh briefs, build waves, integrate + SHIP_METER (prod/test), two-seat gate (Seat C Fable high || Seat X Codex Astra high) with path-scoped Docker and mutation, owner-routed fixes, /ship with skip list, CHANGELOG fact-check before CI, CI wait, READY. Never merges.',
  whenToUse: 'Once per ship-unit of an /autobuilder-loop run (flow FULL or LITE), or once per fix to an open, unmerged PR of the run (flow PATCH).',
  phases: [
    { title: 'Refresh', detail: 'brief refresh vs base; named checks + mutation targets per task' },
    { title: 'Build', detail: 'waves: Claude in the lane (Haiku max for T0/T1, checks[] enforced), Codex via gstack-lane in per-task worktrees' },
    { title: 'Integrate', detail: 'unit verification, SHIP_METER prod/test split, LITE size check' },
    { title: 'Gate', detail: 'Seat C (Fable high) || Seat X (Codex Astra high) || Docker-if-triggered; mutation after; consolidate with the rulings register' },
    { title: 'Fix', detail: 'owner-routed; P2 fix-now -> scoped delta review; P1 -> re-run only failed/invalidated members' },
    { title: 'Ship', detail: 'ledger + hardening rows, /ship with skip list, CHANGELOG fact-check before CI, CI wait, READY (never merges)' },
  ],
}

// =====================================================================================================
// autobuilder-unit.js -- reference unit workflow for gstack /autobuilder-loop v1.8.0
// retro-2026-10-19 item 7
//
// PURPOSE
//   Runs ONE ship-unit of an /autobuilder-loop run end to end as a Workflow-tool script:
//   Refresh -> Build (waves) -> Integrate + SHIP_METER -> Gate -> Fix -> Ship -> READY (flows FULL/LITE),
//   or, for a fix to an OPEN PR of the run, PATCH: Fix -> targeted tests -> delta review -> push to the
//   same PR branch -> CI wait -> READY. It NEVER merges a PR: merges, decisions, the audit trail, flow
//   sizing and the hardening batch stay with the orchestrator (see the skill's "## The loop").
//   Generalized from a production run's unit pipeline; every project-specific value comes from args.
//
// HOW TO LAUNCH
//   1. Copy this file into the orchestrator session's scratchpad (the Workflow tool refuses a
//      scriptPath outside the session):  cp ~/.claude/skills/gstack/autobuilder-loop/autobuilder-unit.js <scratchpad>/
//   2. Workflow({ scriptPath: '<scratchpad>/autobuilder-unit.js', args: { ...see below } })
//      Pass args as a JSON object (not a JSON-encoded string).
//   3. Record the returned runId as workflow_run_id in $RUN_DIR/state.json (the script keeps that key
//      but cannot know its own run id). To resume after a limit stop or a script edit:
//      Workflow({ scriptPath, args: <same args>, resumeFromRunId: <runId> }) -- prompts are byte-stable
//      when an optional arg is absent, so the unchanged prefix replays from cache.
//   4. Read the returned object: status READY | STOPPED | BLOCKED, `stopped` (the reason), `decision`
//      (what the operator must decide), failure_class / wait_until for limit stops, rounds, incidents.
//
// ARGS (* = required)
//   runDir*            $RUN_DIR (state.json, gates/<unit>/rulings.json, attempts/, wt/, ledger, hardening.json)
//   lane*              the lane worktree the unit is built in (Claude edits go through Bash there)
//   repo*              the primary repository checkout (gstack-lane worktree add --repo)
//   briefsDir*         directory holding <taskId>.md briefs
//   reportsDir*        directory for every report this script asks agents to write
//   unit*              unit id (e.g. "U7"); used in labels, report names, ledger ids, gates/<unit>/
//   base*              full SHA of the base the unit branches from (and is metered/gated against)
//   branch*            the unit branch (created in the lane from base when missing)
//   flow               'FULL' | 'LITE' | 'PATCH'                                   default 'FULL'
//   gateClass          'ordinary' | 'critical' (T3-containing or FINAL milestone)   default 'ordinary'
//   prNumber           PATCH only: the open PR whose branch receives the fix
//   waves              [[{id, impl:'claude'|'codex', model, effort, tier:'T0'..'T3', note}]]
//                      routing follows the skill's table (T0/T1 Haiku max; T2 L3 Sol -> L2 Opus 5.5 -> L1 Opus 5.5;
//                      T3 L2 Opus 5.5 -> L3 Astra -> L1 Opus 5.5). The tier guard runs BEFORE a `model` override:
//                      a Sonnet / Haiku / Luna override on a T2/T3 task, Sol on a T3 Codex task, or Luna on any Codex
//                      task is refused (recorded) and the tier default runs.
//   context            unit context for the brief refresh (and the PATCH request)
//   gateFocus          extra focus text for both gate seats
//   dockerFocus        replaces the default Docker smoke instructions
//   dockerGlobs        Docker trigger globs (default: the v1.8 list below)
//   shipNotes          extra PR-body text
//   prebuilt           text: the lane branch is already built; skip Refresh + Build
//   maxRounds          full gate rounds before asking                              default 3
//   autoFourth         one automatic extra round when the last round found a NEW P1 with an in-scope fix  default true
//   synModel           synthesis model override (refresh, consolidation, delta review from the rounds below)
//   synGateFrom        round from which synModel also replaces Seat C's first model
//   synConsFrom        round from which synModel replaces the consolidator's first model
//   seatCModel         Seat C first model (L1)                                     default 'fable'
//   seatXModel         Seat X Codex model (L3): accepted ONLY as 'gpt-6-astra' (any other value stops the unit);
//                      Sol is reachable only through the R1 substitution                default 'gpt-6-astra'
//   shipModel          model for the /ship dispatches (default: haiku max with the skip list, else claude-opus-5-5)
//   deltaModel         first model of the one-Claude-seat scoped delta review (default: synthesis chain)
//   extraFixes         [{owner, item, severity?, checks?:[{name, command}]}] operator-ordered fixes (PATCH: the fixes
//                      to apply); `checks` = the targeted tests / typecheck the fix must pass (enforced via checks[]);
//                      an owner that is not a task of `waves` must carry `tier` (T0-T3; optional impl/model) or PATCH stops
//   extraFixRound      the gate round whose fix list extraFixes join
//   mergeNotes         extra text for the wave-merge agent
//   shipOpenP1         operator decision text: ship although the final gate kept P1s
//   shipOpenP1Markers  [string] shortcut comments to add (comment-only commit) when shipOpenP1
//   shipExtra          extra text for the /ship dispatch
//   shipAttempt        ship attempt counter (busts the PR-lookup cache on a re-ship)
//   gateAttempt        gate attempt counter, folded ONLY into the Seat X dispatch when set (absent = byte-stable prompts).
//                      The orchestrator passes gateAttempt: <n> (incremented) when it resumes with resumeFromRunId after
//                      a Seat X quota wait: otherwise the resume replays the cached ABSENT and Astra is never re-attempted.
//                      Seat C / Docker / mutation results at the same SHA replay from cache (still valid).
//   deltaKnown         known context for delta reviews
//   privtest           private test-DB helper command: "<privtest> <db> <worktree> reset|run <files>"
//   liteLocCap         LITE production-LOC cap                                     default 400
//   acceptDegraded     operator record accepting a DEGRADED gate (needed before /ship on DEGRADED). It is also the
//                      step-0 policy answer "ordinary gates may close DEGRADED on a cooling Codex lane": without it an
//                      Astra quota/cooling on an ordinary gate WAITS for the reset like a critical gate (ruling R1)
//   sensitiveGlobs     sensitive-path globs (LITE -> FULL, PATCH -> full re-round); replaces BOTH defaults (the
//                      camelCase-aware token classifier of ruling S1 and the structural globs below)
//
// SEAT X RULE (ruling R1): Sol `gpt-6.1-sol` high gets ONE substitute attempt only on an ORDINARY gate whose Astra
//   attempt ended `timeout` (after the helper's medium retry) or `error`. Never on `auth`, never when codex_reviews is
//   disabled/off (Seat X is then ABSENT by config), never on `quota`/cooling: gstack-lane refuses a cooling lane and L3
//   cools lane-wide, so Sol cannot run after an Astra quota. Astra quota/cooling => Seat X ABSENT and the gate waits
//   (wait_until = the l3 reset; resume at reset + 2 min) unless acceptDegraded is set on an ordinary gate. A critical
//   gate always waits. A per-model L3 cooldown (which would allow Sol on Astra quota) is a gstack-lane follow-up.
// SAFETY: no per-task review pass (ruling R2: the two gate seats review the whole unit diff, so the opposite-vendor
//   seat IS each T1+ task's other-vendor assessment). Every commit goes through `gstack-lane commit` or is covered,
//   before any push, by the same guard scan (ruling R9). INVALID is sticky within a gate: only a PRESENT result for that
//   seat clears it, and it is re-run at the same SHA before any fix, cap or DEGRADED path (R3). Ship and PATCH fail closed: a missing/incomplete review,
//   delta review, fact-check, inventory, state write or push blocks publication (ruling R4).
// REPO PATHS: every path an agent reports is validated (PATH_OK; [ ] ( ) and spaces allowed). LIMIT: a NON-ASCII file
//   name BLOCKs the unit (invalid_path:<field> (...; <path:ID>: non_ascii; ...)); rename the file
//   to ASCII. Credential-shaped names are sensitive and are shown only as <path:ID>.
//
// Markers: "retro-2026-10-19 item N" = brief item N; "v1.8 decision D-X" = spec decision D-X.
// This script runs inside the Workflow VM: no filesystem access, no wall-clock or random calls; every
// file read/write (state.json, rulings.json, ledgers) is done by a cheap rote agent.
// =====================================================================================================

const A = args || {}

// ---------- helpers -----------------------------------------------------------------------------------
const J = x => JSON.stringify(x)
const has = v => !(v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0))
// optional prompt segment: '' when the arg is absent, so prompts stay byte-stable for resume
const opt = (v, f) => (has(v) ? f(v) : '')
const arr = v => (Array.isArray(v) ? v : [])
const slug = x => String(x).toLowerCase().replace(/[^a-z0-9]/g, '')
const safe = x => (String(x).replace(/[^A-Za-z0-9._-]/g, '-').replace(/^[^A-Za-z0-9]+/, '').slice(0, 60) || 'x')
const uniq = xs => xs.filter((x, i) => xs.indexOf(x) === i)
const SHA_RE = /^[0-9a-f]{40}$/
const lastSha = s => { const m = String(s || '').match(/[0-9a-f]{40}/g); return m ? m[m.length - 1] : '' }

function globToRe(glob) {
  let re = ''
  let brace = false
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]
    if (c === '*') {
      if (glob[i + 1] === '*') {
        if (glob[i + 2] === '/') { re += '(?:.*/)?'; i += 2 } else { re += '.*'; i += 1 }
      } else re += '[^/]*'
    } else if (c === '?') re += '[^/]'
    else if (c === '{') { brace = true; re += '(?:' }
    else if (c === '}' && brace) { brace = false; re += ')' }
    else if (c === ',' && brace) re += '|'
    else re += /[.+^$()|[\]\\]/.test(c) ? '\\' + c : c
  }
  return new RegExp('^' + re + '$')
}
const touches = (files, res) => arr(files).filter(f => res.some(r => r.test(String(f).replace(/^\.\//, ''))))

// ---------- args, constants ---------------------------------------------------------------------------
const REQUIRED = ['runDir', 'lane', 'repo', 'briefsDir', 'reportsDir', 'unit', 'base', 'branch']
const FLOW_REQ = String(A.flow || 'FULL').toUpperCase()
const GATE_CLASS = String(A.gateClass || 'ordinary').toLowerCase()
const RUN = A.runDir, LANE = A.lane, REPO = A.repo, B = A.briefsDir, R = A.reportsDir
const UNIT = String(A.unit), BASE = A.base, BR = A.branch
const U = slug(UNIT), UNIT_DIR = safe(UNIT), LID = UNIT.replace(/[^A-Za-z0-9]/g, '').toUpperCase()
const GATES = `${RUN}/gates/${UNIT_DIR}`
const RULINGS = `${GATES}/rulings.json` // retro-2026-10-19 item 2
const MAXR = Number(A.maxRounds) > 0 ? Number(A.maxRounds) : 3
const AUTO4 = A.autoFourth !== false // retro-2026-10-19 item 4
const SEATC = A.seatCModel || 'fable' // v1.8 decision D-B
const SEATX = 'gpt-6-astra' // v1.8 decision D-B + R1: Seat X's first attempt is always Astra (seatXModel is validated in main)
const LITE_CAP = Number(A.liteLocCap) > 0 ? Number(A.liteLocCap) : 400 // v1.8 decision D-E
// retro-2026-10-19 item 6: production-LOC meter thresholds (operator to confirm)
const PROD_WARN = 2000, PROD_CAP = 2500, PROD_LINEAR_CAP = 3000, TEST_WARN = 5000
const GL = '~/.claude/skills/gstack/bin/gstack-lane'
const SK = '~/.claude/skills/gstack'
const TRAILER = 'Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>'
const PR_FOOTER = '🤖 Generated with [Claude Code](https://claude.com/claude-code)'
const DB = `ab_${U}`

// retro-2026-10-19 item 3: Docker trigger globs (operator to confirm)
const DEFAULT_DOCKER_GLOBS = ['**/docker-compose*.y*ml', '**/compose*.y*ml', '**/Dockerfile*', '**/.env*', '**/env.{ts,mjs,js}', '**/env/**', '**/migrations/**', '**/*.sql', '**/prisma/schema.prisma', '**/app/**/route.*', '**/app/**/page.*', '**/app/**/layout.*', '**/pages/**', '**/api/**', '**/middleware.*']
const DOCKER_GLOBS = arr(A.dockerGlobs).length ? arr(A.dockerGlobs) : DEFAULT_DOCKER_GLOBS
const DOCKER_RES = DOCKER_GLOBS.map(globToRe)
// v1.8 decision D-E + rulings R6 / S1: the sensitive-path classifier OVER-matches (a false positive only upgrades LITE to
// FULL; a false negative skips review depth). Case-insensitive sensitive tokens at a path-segment start (/ _ - . or a
// camelCase boundary); only author* is excluded. Plus structural globs (public APIs, routes, middleware, SQL, schema).
// The sensitiveGlobs arg replaces BOTH defaults.
// (security review r8: identity / credential / access-control tokens added; prefix matching at a segment start, so
// keyboard.ts and tokenizer.ts over-match as sensitive (acceptable), console.ts does not). sign+in|up and log+in match
// across a separator, so the camel split of userSignIn / userSignUp / userLogIn (sign/in, log/in) still matches.
const SENSITIVE_TOKEN_RE = /(^|[\/_.\-])(o?auth(?!or)[a-z]*|authn|authz|authori[sz]|authenticat|session|permissions?|rbac|acl|payments?|billing|checkout|stripe|secrets?|crypto|migrations?|pii|gdpr|erasure|security|log[\/_.\-]?in|sign[\/_.\-]?(?:in|up)|passwords?|passwd|credentials?|tokens?|jwt|oidc|saml|sso|cookies?|csrf|xsrf|cors|admin|roles?|privileg|keys?|certs?|tls|ssl)/
const DEFAULT_SENSITIVE_GLOBS = ['**/*.sql', '**/prisma/schema.prisma', '**/api/**', '**/app/**/route.*', '**/middleware.*']
const SENSITIVE_GLOBS = arr(A.sensitiveGlobs).length ? arr(A.sensitiveGlobs) : DEFAULT_SENSITIVE_GLOBS
const SENSITIVE_RES = SENSITIVE_GLOBS.map(globToRe)
// splits acronym boundaries too. Samples (pinned in the mock harness): sensitive = HTTPAuthHandler, APIPermissions,
// OAuth2Client, XMLPaymentParser, OAuthButton, userSession, stripeClient, ACLs, RBACs, userACLs; not sensitive =
// author.md, author.ts, authors/, coauthor, AuthorCard, HTMLParser, oracle
const camelSplit = f => String(f).replace(/^\.\//, '').replace(/([A-Z]+)([A-Z][a-z])/g, '$1/$2').replace(/([a-z0-9])([A-Z])/g, '$1/$2').toLowerCase()
// ruling S5: a match in ANY normalized form is sensitive: the raw lowercased path, the lower->upper split only, and the full
// acronym split (ACLs, RBACs, userACLs only match in the first two)
const lowerSplit = f => String(f).replace(/^\.\//, '').replace(/([a-z0-9])([A-Z])/g, '$1/$2').toLowerCase()
const tokenForms = f => [String(f).replace(/^\.\//, '').toLowerCase(), lowerSplit(f), camelSplit(f)]
// a token- / userinfo-shaped path (pathSecret) is ALWAYS sensitive, whatever sensitiveGlobs says
const sensitiveFiles = files => arr(files).filter(f => pathSecret(f) || touches([f], SENSITIVE_RES).length > 0 || (!arr(A.sensitiveGlobs).length && tokenForms(f).some(x => SENSITIVE_TOKEN_RE.test(x))))
// prose = by EXTENSION only (ruling S2: .mdx is code; a docs/example.js is code and gets a code review)
const PROSE_RE = /\.(md|txt|rst)$/i
// release bookkeeping /ship may add after the gated head: VERSION and .md/.txt/.rst prose ONLY. Any package.json change,
// a version bump included, is code (orchestrator ruling: no parser-based version-only exemption; every such check opened a
// new differential). A /ship version bump in package.json therefore gets the cheap one-seat scoped ship-delta review.
const BOOKKEEP_RE = /(^|\/)VERSION$|\.(md|txt|rst)$/i

// waves / tasks
const WAVES = arr(A.waves).map(w => arr(w))
// TASKS / IDS / OWNERS are mutated IN PLACE (never reassigned) when a mid-milestone meter stop defers unbuilt waves,
// so every later prompt and the FIX_ITEM owner enum see only the built scope.
const TASKS = WAVES.flat()
const IDS = TASKS.map(t => t.id)
const byId = Object.fromEntries(TASKS.map(t => [t.id, t]))
const OWNERS = IDS.concat(['integration'])
let BRIEFS = IDS.map(id => `${B}/${id}.md`).join(', ')
const tierOf = t => { const x = String((t && t.tier) || '').toUpperCase(); if (/^T[0-3]$/.test(x)) return x; return /haiku/.test(String((t && t.model) || '')) ? 'T1' : 'T2' }
const isLow = t => ['T0', 'T1'].includes(tierOf(t))
const HAIKU = { model: 'haiku', effort: 'max' } // v1.8 decision D-C: Haiku 5.5 at MAX effort for dev work
const OPUS = { model: 'claude-opus-5-5', effort: 'high' }
const L2_MODEL = { haiku: 'claude-haiku-5-5', sonnet: 'claude-sonnet-5-5', 'claude-opus-5-5': 'claude-opus-5-5', 'claude-opus-4-8': 'claude-opus-5-5', fable: 'claude-opus-5-5' }
const l3Effort = e => (['none', 'minimal', 'low', 'medium', 'high', 'xhigh'].includes(e) ? e : (e === 'max' ? 'xhigh' : 'high'))
// Rule 1 tier guard, applied BEFORE any `model` override: T2/T3 never run on Sonnet, Haiku or Luna; T3 Codex is Astra
// only (Sol is legal up to T2); Luna is never a dev model (D-C: R-lane spillover only), on any tier.
const CLAUDE_HI = ['claude-opus-5-5', 'claude-opus-4-8', 'fable']
const CODEX_BY_TIER = { T0: ['gpt-6.1-sol', 'gpt-6-astra'], T1: ['gpt-6.1-sol', 'gpt-6-astra'], T2: ['gpt-6.1-sol', 'gpt-6-astra'], T3: ['gpt-6-astra'] }
function tierGuard(t) {
  const m = String((t && t.model) || '').toLowerCase()
  if (!m) return { model: '', refused: '' }
  if (t.impl === 'codex') return CODEX_BY_TIER[tierOf(t)].includes(m) ? { model: m, refused: '' } : { model: '', refused: m }
  if (isLow(t)) return { model: m, refused: '' }
  return CLAUDE_HI.includes(m) ? { model: m, refused: '' } : { model: '', refused: m }
}
// T0/T1 Claude model (Haiku max by default; an explicit low-tier override is honoured)
function lowModel(t) {
  const m = String(t.model || '').toLowerCase()
  const eff = t.effort || 'high'
  if (!m || m === 'haiku' || m === 'claude-haiku-5-5') return HAIKU
  if (m === 'sonnet' || m === 'claude-sonnet-5-5') return { model: 'sonnet', effort: eff }
  if (m === 'claude-opus-4-8') return { model: 'claude-opus-4-8', effort: eff }
  return { model: 'claude-opus-5-5', effort: eff }
}
// The skill's routing table as an ordered lane chain (first available lane wins; LANE_UNAVAILABLE -> next).
//   T0/T1 claude: L1 Haiku max (-> L2 Haiku spill; check gap -> escalation)   T0/T1 codex: L3 <model> -> L1 Haiku max
//   T2 codex: L3 Sol -> L2 Opus 5.5 -> L1 Opus 5.5                             T2 claude: L2 Opus 5.5 -> L1 Opus 5.5
//   T3 claude: L2 Opus 5.5 -> L3 Astra xhigh -> L1 Opus 5.5                    T3 codex: L3 Astra xhigh -> L2 Opus 5.5 -> L1 Opus 5.5
function implChain(t) {
  if (isLow(t)) {
    const l1 = { lane: 'l1', low: true, m: lowModel(t) }
    return t.impl === 'codex' ? [{ lane: 'l3', model: tierGuard(t).model || 'gpt-6.1-sol', effort: t.effort || 'high' }, { lane: 'l1', low: true, m: HAIKU }] : [l1]
  }
  const g = tierGuard(t)
  const eff = t.effort || 'high'
  const T3 = tierOf(t) === 'T3'
  if (t.impl === 'codex') {
    const cm = g.model || (T3 ? 'gpt-6-astra' : 'gpt-6.1-sol')
    return [{ lane: 'l3', model: cm, effort: t.effort || (cm === 'gpt-6-astra' ? 'xhigh' : 'high') }, { lane: 'l2', model: 'claude-opus-5-5', effort: 'high' }, { lane: 'l1', model: 'claude-opus-5-5', effort: 'high' }]
  }
  const l1m = g.model || 'claude-opus-5-5'
  const l2 = { lane: 'l2', model: L2_MODEL[l1m] || 'claude-opus-5-5', effort: eff }
  const l1 = { lane: 'l1', model: l1m, effort: eff }
  return T3 ? [l2, { lane: 'l3', model: 'gpt-6-astra', effort: 'xhigh' }, l1] : [l2, l1]
}
const routeDesc = t => implChain(t).map(s => (s.low ? `L1 ${s.m.model} ${s.m.effort}` : `${s.lane.toUpperCase()} ${s.model}`)).join(' -> ')

// synthesis tier: fable -> claude-opus-5-5 -> claude-opus-4-8 (retro-2026-10-19 item 5)
const SYN_CHAIN = ['fable', 'claude-opus-5-5', 'claude-opus-4-8']
const synFirst = (from, round) => ((A.synModel && round >= from) ? A.synModel : 'fable')
const synChain = first => uniq([first].concat(SYN_CHAIN))

// ---------- shared prompt fragments -------------------------------------------------------------------
const PRIV = (db, wt) => opt(A.privtest, p => ` DB-backed tests run on a private database via ${p} ${db} ${wt} reset|run <files> (each file single-quoted; your own database; never another agent's).`)
const CONC = 'Multi-connection / concurrency suites the briefs name run 5x; one flake is a failure.'
const EDIT_NOTE = 'File edits: make every edit through Bash (python3 or a heredoc) inside your worktree; a session hook may block the Write/Edit tools for sibling worktrees.' // retro-2026-10-19 item 10(a)
const SEV = 'Severities: [P1] = ship-blocker (wrong behaviour, data loss, security, a spec violation, a test that cannot fail for the thing it claims to guard); [P2] = lower. Each finding: severity, file:line, one-sentence defect, concrete failure scenario, suggested fix. CHANGELOG and docs prose is never [P1].'
// retro-2026-10-19 item 3: section F carried verbatim into the skill's mutation rule
const SECF = 'SECTION F (mutation probe bound + survivor severity): the round-1 probe runs EVERY brief-named mutation target plus AT MOST 10 mutants of its own choosing (the riskiest invariants; it lists which own mutants it chose). P1 (blocks the gate): a surviving BRIEF-NAMED mutant, a survivor from an earlier round that a fix claimed to kill, or any survivor whose survival reveals a production-reachable defect (wrong behaviour, not just a weaker test). P2 fix-now: other surviving own mutants that expose a real test-strength gap on CORRECT production code (cheap test-only fixes, each re-verified by re-running exactly that mutant). Not a finding: equivalent / redundant mutants (record them in the report, no fix). The mutation member PASSes when no P1 per this table survives.'
// v1.8 decision D-B: ONE Seat C pass = plan-eng-review methodology + /review checklist, union of both skip lists
const SEATC_SKIP = 'SKIP in both skills: Preamble, AskUserQuestion format, telemetry, Step 0 / base-branch detect, the Scope gate, Design Doc Check, office-hours / Prerequisite Skill Offer, Review Readiness Dashboard, Plan File Review Report, Outside Voice, Completeness / Boil-the-Ocean, Search Before Building, Completion Status Protocol, the Review Army dispatch, the Adversarial / Codex step, the entire Fix-First / Step 5 flow and any commit, Greptile resolution, review-log persist.'
// retro-2026-10-19 item 8 + ruling R8: /ship skip list (passed only when the gate is CLEAN or an accepted DEGRADED).
// Sections are named by their HEADING TEXT in ship/SKILL.md and ship/sections/*.md, never by step number.
// The set matches the skill's step-f skip list: Pre-Landing Review through Fix-First and persistence, Greptile, the
// adversarial step and any outside voice are skipped, and "Bind the reviews" is REPLACED by saving the reviewed-tree
// snapshot (gstack-wtree) that "Verification Gate" stage 2 compares against. Full heading text, verbatim from the
// generated ship/SKILL.md (resolver headings included).
const SHIP_SKIP = 'SKIP LIST (this unit\'s gate already reviewed this head; valid inside autobuilder runs only), sections of ship/SKILL.md and its sections/*.md named by heading text: skip "Pre-Landing Review" and everything through "Fix-First and persistence" ("Review Army — Specialist Dispatch", "Collect and merge findings", "Red Team dispatch (conditional)", "Exploratory QA (before Fix-First)", "Cross-review finding dedup"), "Address Greptile review comments (if PR exists)", "Adversarial review (always-on)", "Outside Voices — Advisory Panel (recommendation only; the user decides)" and any other outside-voice or Codex step. REPLACE "Bind the reviews" with saving the reviewed-tree snapshot: right after "Merge the base branch (BEFORE tests)" and before "Version bump (auto-decide)", run ~/.claude/skills/gstack/bin/gstack-wtree, keep its output as the reviewed tree and report it as reviewed_tree (the unit script binds it to the merged gated tree and compares it with the tree it pushes, standing in for "Verification Gate" stage 2, so do not run that section here).'
// Bounded background polling for a gstack-lane helper launch (ruling R4: a hard deadline even when no status file appears)
const POLL = (cmd, out, budget) => `Launch it in the background and record its PID: ( nohup ${cmd} >/dev/null 2>&1 & echo $! > "$ADIR/pid" ); then echo $(( $(date +%s) + ${budget} )) > "$ADIR/deadline". Poll in separate Bash calls, each under 10 minutes: for i in $(seq 1 18); do kill -0 "$(cat "$ADIR/pid")" 2>/dev/null || break; [ "$(date +%s)" -ge "$(cat "$ADIR/deadline")" ] && break; sleep 30; done — repeat until the helper process is gone or the deadline has passed; never end your turn while it runs and never start a second run. Deadline passed with the helper still running: kill "$(cat "$ADIR/pid")" and treat it as class timeout. Helper gone (or killed) and "${out}.status.json" missing: the helper never ran or died early (denied, missing, bad arguments) — class error, no evidence; stop waiting at once.`
// Seat C on L2: mechanical decode + adjudication of the helper's JSON transport (the review TEXT, never the JSON wrapper).
// INVALID before ABSENT, like gstack-lane adjudicate: tainted (checked FIRST, whatever the class) / class error / non-zero exit / wrong runtime model / empty
// text / no completion marker => INVALID; auth|quota|timeout|throttle => ABSENT; no status file => ABSENT (never ran).
const SEATC_L2_ADJ = String.raw`S="$OUT.status.json"; TXT="$ADIR/review.txt"
if [ ! -s "$S" ]; then echo "SEATC status=ABSENT class=error reason=no_status p1=0 runtime_model=null"; exit 0; fi
CLASS=$(jq -r '.class // "unreadable"' "$S" 2>/dev/null); [ -n "$CLASS" ] || CLASS=unreadable
RM=$(jq -r '.runtime_model // "null"' "$S" 2>/dev/null); [ -n "$RM" ] || RM=null
EX=$(jq -r '((.exit // "null")|tostring) + "/" + ((.exit_code // "null")|tostring)' "$S" 2>/dev/null)
TA=$(jq -r '.tainted // false' "$S" 2>/dev/null)
RMN=$(printf '%s' "$RM" | tr 'A-Z' 'a-z')
if [ "$TA" != false ]; then echo "SEATC status=INVALID class=$CLASS reason=tainted p1=0 runtime_model=$RM"; exit 0; fi
case "$CLASS" in
  auth|quota|timeout|throttle) echo "SEATC status=ABSENT class=$CLASS reason=$CLASS p1=0 runtime_model=$RM"; exit 0 ;;
  ok) : ;;
  *) echo "SEATC status=INVALID class=$CLASS reason=class_$CLASS p1=0 runtime_model=$RM"; exit 0 ;;
esac
jq -er 'if type=="object" then (if (.result|type)=="string" then .result elif (.text|type)=="string" then .text elif (.response|type)=="string" then .response elif .structured_output then (.structured_output|tostring) else empty end) else empty end' "$OUT" > "$TXT" 2>/dev/null || cp "$OUT" "$TXT" 2>/dev/null || : > "$TXT"
LAST=$(grep -v '^[[:space:]]*$' "$TXT" 2>/dev/null | tail -n 1)
P1N=$(grep -c -E '^[[:space:]>|*_-]*([0-9]+[.)][[:space:]]*)?\[P[01]\]' "$TXT" 2>/dev/null); [ -n "$P1N" ] || P1N=0
if [ "$EX" != "0/0" ]; then R=nonzero_exit
else case "$RMN" in claude-fable-5-1|fable|claude-opus-5-5|claude-opus-4-8) R="" ;; *) R=runtime_model_not_allowed ;; esac; fi
if [ -z "$R" ] && ! printf '%s\n' "$LAST" | grep -q -E '^[[:space:]]*(\*\*|__)?REVIEW_COMPLETE: findings=[0-9]+(\*\*|__)?[[:space:]]*$'; then R=no-completion-marker; fi
if [ -n "$R" ]; then echo "SEATC status=INVALID class=ok reason=$R p1=$P1N runtime_model=$RM"; else echo "SEATC status=PRESENT class=ok reason=complete p1=$P1N runtime_model=$RM"; fi`
// retro-2026-10-19 item 6: SHIP_METER — the skill's step-f meter (tracked diff + untracked files, the same exclusions,
// prod/test split). Base = this unit's ship base.
// Script owns Git calls, exclusions and prod/test arithmetic; the VM only relays its result.
const shellArg = x => "'" + String(x).replace(/'/g, "'\\''") + "'"
const METER = `${SK}/bin/gstack-autobuilder-ops meter ${shellArg(LANE)} ${shellArg(BASE)}`
// ruling R7: "linear" = no merge commit FROM THE BASE BRANCH after the ship base; the unit's own wave merges keep it linear
// (fail closed: when the default branch cannot be resolved the branch is not linear; the +20% band is an exception)
const LINEAR = `_DB=$(git -C ${LANE} symbolic-ref -q --short refs/remotes/origin/HEAD 2>/dev/null); for _c in origin/main origin/master; do [ -n "$_DB" ] || { git -C ${LANE} rev-parse -q --verify "$_c" >/dev/null 2>&1 && _DB=$_c; }; done; _LIN=true; [ -n "$_DB" ] || _LIN=false; _MS=$(git -C ${LANE} rev-list --merges ${BASE}..HEAD) || _LIN=false; for _m in $(printf '%s\n' "$_MS"); do for _p in $(git -C ${LANE} rev-list --parents -n 1 "$_m" | cut -d' ' -f3-); do [ -n "$_DB" ] && git -C ${LANE} merge-base --is-ancestor "$_p" "$_DB" 2>/dev/null && _LIN=false; done; done; echo "LINEAR=$_LIN"`
// /ship's OWN change inventory after the gated head G in lane L. Paths that differ from the gated tree and are either
// (a) different from the upstream side of /ship's base merge, (b) changed on BOTH sides since the merge base (a conflict,
// even when resolved by taking upstream's whole file), or (c) edited after the merge commit. Upstream-only paths merged
// cleanly are excluded. SNAP = the tree the reviewed-tree snapshot must equal. Every git error -> ERROR (fail closed).
const INV_SH = String.raw`set -o pipefail
cd "$L" || { echo "ERROR lane"; exit 1; }
T=$(mktemp -d) || { echo "ERROR mktemp"; exit 1; }
H=$(git rev-parse HEAD) || { echo "ERROR head"; exit 1; }
git diff --name-only "$G" HEAD | sort -u > "$T/g" || { echo "ERROR diff"; exit 1; }
M=$(git rev-list --merges --ancestry-path "$G..HEAD" | tail -n 1) || { echo "ERROR rev-list"; exit 1; }
if [ -z "$M" ]; then
  cp "$T/g" "$T/f"; SNAP=$(git rev-parse "$G^{tree}") || { echo "ERROR tree"; exit 1; }
else
  # S4: the merge must sit on the gated line (M^1 descends from G) and its second parent must be on the base branch;
  # a second parent NOT on the base branch is /ship's own change: every diff(MB, UP) path joins the review set
  DB=$(git symbolic-ref -q --short refs/remotes/origin/HEAD 2>/dev/null)
  for c in origin/main origin/master; do [ -n "$DB" ] || { git rev-parse -q --verify "$c" >/dev/null 2>&1 && DB=$c; }; done
  [ -n "$DB" ] || { echo "ERROR base branch unresolved"; exit 1; }
  UP=$(git rev-parse "$M^2") && MB=$(git merge-base "$G" "$UP") || { echo "ERROR merge parents"; exit 1; }
  git merge-base --is-ancestor "$G" "$M^1"; rc=$?
  [ "$rc" -eq 0 ] || { echo "ERROR merge first parent does not descend from the gated head (rc $rc)"; exit 1; }
  git merge-base --is-ancestor "$UP" "$DB"; rc=$?
  case "$rc" in 0) ONBASE=1 ;; 1) ONBASE=0 ;; *) echo "ERROR is-ancestor (rc $rc)"; exit 1 ;; esac
  { git diff --name-only "$UP" HEAD | sort -u > "$T/u"; } && { git diff --name-only "$MB" "$G" | sort -u > "$T/a"; } && { git diff --name-only "$MB" "$UP" | sort -u > "$T/b"; } && { git diff --name-only "$M" HEAD | sort -u > "$T/p"; } || { echo "ERROR diff"; exit 1; }
  comm -12 "$T/a" "$T/b" > "$T/both"; sort -u "$T/u" "$T/both" > "$T/c"; comm -12 "$T/g" "$T/c" > "$T/x"
  if [ "$ONBASE" = 1 ]; then sort -u "$T/x" "$T/p" > "$T/f"; else sort -u "$T/x" "$T/p" "$T/b" > "$T/f"; echo "NOTE second parent $UP is not on $DB: all of its changes are reviewed"; fi
  SNAP=$(git rev-parse "$M^{tree}") || { echo "ERROR tree"; exit 1; }
fi
echo "HEAD $H"; echo "SNAP $SNAP"; sed 's/^/FILE /' "$T/f"; rm -rf "$T"`
const DOCKER_DEFAULT = 'Build and start the project\'s compose stack from the lane (docker compose up -d --build --wait); apply migrations on a FRESH database and confirm a re-run reports 0 pending; seed if the project has a seed; confirm the app answers 2xx/3xx within 120 s; smoke every route, page and endpoint the briefs touch (pages through the gstack browse skill, ' + SK + '/browse/SKILL.md); 0 console errors, no 5xx in the logs.'

// ---------- envelope schemas (the run's ENV, INT, GATE, CONS, PR, RD, DC; extended) -------------------
const STR = { type: 'string' }
const STRS = { type: 'array', items: STR }
const CHECKS = { type: 'array', items: { type: 'object', properties: { name: STR, command: STR, exit_code: { type: 'number' } }, required: ['name', 'command', 'exit_code'] } } // retro-2026-10-19 item 12
const ENV = { type: 'object', properties: { status: STR, head: STR, files_touched: STRS, change_summary: STR, test_result: STR, checks: CHECKS, requested_model: STR, actual_model: STR, failure_class: STR, reset_at: STR, follow_ups: STRS }, required: ['status', 'head', 'test_result'] }
const INT = { type: 'object', properties: { status: { type: 'string', enum: ['GREEN', 'RED'] }, head: STR, tests: STR, loc: { type: 'number' }, prod_loc: { type: 'number' }, test_loc: { type: 'number' }, linear: { type: 'boolean' }, files: STRS, checks: CHECKS, notes: STR }, required: ['status', 'prod_loc', 'test_loc', 'linear', 'files'] }
const GATE = { type: 'object', properties: { member: STR, status: STR, verdict: STR, class: STR, p1: STRS, p1_count: { type: 'number' }, p2_count: { type: 'number' }, report: STR, requested_model: STR, runtime_model: STR, verdict_line: STR, summary_line: STR, reset_at: STR, substituted: STR, actual_model: STR, final_line: STR, mutants: { type: 'array', items: { type: 'object', properties: { name: STR, killed: { type: 'boolean' }, brief_named: { type: 'boolean' } }, required: ['name', 'killed'] } }, final_clean: STR, notes: STR }, required: ['member', 'status', 'verdict'] }
const NAMED = { type: 'array', items: { type: 'object', properties: { name: STR, command: STR }, required: ['name', 'command'] } }
const FIX_ITEM = { type: 'object', properties: { owner: { type: 'string', enum: OWNERS }, item: STR, severity: { type: 'string', enum: ['P1', 'P2'] }, mutants: STRS, files: STRS, checks: NAMED }, required: ['owner', 'item', 'severity', 'checks'] }
const DEFER_ITEM = { type: 'object', properties: { finding: STR, files: STRS, owner: STR, target: STR, cost_if_wrong: STR }, required: ['finding'] }
// retro-2026-10-19 item 9: CONS carries members_present and the CLEAN|DEGRADED|FAIL|BLOCKED verdict enum
const CONS = { type: 'object', properties: { verdict: { type: 'string', enum: ['CLEAN', 'DEGRADED', 'FAIL', 'BLOCKED'] }, members_present: { type: 'object', properties: { seat_c: STR, seat_x: STR, docker: STR, mutation: STR }, required: ['seat_c', 'seat_x'] }, p1: STRS, fixes: { type: 'array', items: FIX_ITEM }, deferred_p2: { type: 'array', items: DEFER_ITEM }, invalidates: { type: 'array', items: { type: 'string', enum: ['seat_c', 'seat_x', 'docker', 'mutation'] } }, member_downgrades: { type: 'array', items: { type: 'object', properties: { member: { type: 'string', enum: ['docker', 'mutation'] }, reason: STR }, required: ['member', 'reason'] } }, new_p1: { type: 'boolean' }, re_raises: { type: 'number' }, rulings_written: { type: 'number' }, members: STR }, required: ['verdict', 'members_present', 'p1', 'fixes', 'deferred_p2', 'members'] }
const PR = { type: 'object', properties: { pr: { type: 'number' }, head: STR, title: STR }, required: ['pr', 'head', 'title'] }
const DC = { type: 'object', properties: { verdict: { type: 'string', enum: ['CLEAN', 'FAIL'] }, p1: STRS, doc_fixes: STRS, members: STR, checks: CHECKS }, required: ['verdict', 'p1', 'doc_fixes', 'members'] }
const DR = { type: 'object', properties: { verdict: { type: 'string', enum: ['PASS', 'FAIL'] }, reviewed_sha: STR, p1: STRS, p2: STRS, fixes: { type: 'array', items: FIX_ITEM }, mutants: { type: 'array', items: { type: 'object', properties: { name: STR, killed: { type: 'boolean' } }, required: ['name', 'killed'] } }, notes: STR }, required: ['verdict', 'p1'] }
const REFRESH = { type: 'object', properties: { status: { type: 'string', enum: ['READY', 'BLOCKED'] }, disjoint: { type: 'boolean' }, baseline: { type: 'string', enum: ['GREEN', 'RED', 'UNKNOWN'] }, edits: STRS, open_issues: STRS, tasks: { type: 'array', items: { type: 'object', properties: { id: STR, named_checks: NAMED, mutation_targets: STRS }, required: ['id', 'named_checks'] } } }, required: ['status', 'tasks'] }
const WB = { type: 'object', properties: { head: STR, worktrees: { type: 'array', items: { type: 'object', properties: { task: STR, path: STR, branch: STR, base_sha: STR }, required: ['task', 'path', 'branch', 'base_sha'] } } }, required: ['head', 'worktrees'] }
const MERGE = { type: 'object', properties: { status: { type: 'string', enum: ['GREEN', 'RED'] }, head: STR, notes: STR }, required: ['status'] }
const GS = { type: 'object', properties: { guard_exit: { type: 'number' }, guard_lines: STRS, reviewed_sha: STR, files_since_base: STRS, files_since_prev: STRS, rulings: { type: 'number' } }, required: ['guard_exit', 'guard_lines', 'reviewed_sha', 'files_since_base', 'files_since_prev'] }
const FILES = { type: 'object', properties: { head: STR, files: STRS, snap_tree: STR }, required: ['head', 'files'] }
const METERS = { type: 'object', properties: { prod_loc: { type: 'number' }, test_loc: { type: 'number' }, line: STR }, required: ['prod_loc', 'test_loc'] }
const GUARD = { type: 'object', properties: { exit_code: { type: 'number' }, lines: STRS, head: STR, files_since: STRS, tree_delta: STRS }, required: ['exit_code', 'lines', 'head', 'files_since'] }
const PUB = { type: 'object', properties: { status: { type: 'string', enum: ['PUBLISHED', 'BLOCKED'] }, pr_number: { type: 'number' }, head: STR, notes: STR }, required: ['status', 'head'] }
const SHIPPREP = { type: 'object', properties: { status: { type: 'string', enum: ['COMMITTED', 'BLOCKED'] }, head: STR, version: STR, reviewed_tree: STR, code_changed: { type: 'boolean' }, merge_conflict: { type: 'boolean' }, changed_files: STRS, decisions_auto_taken: STRS, failure_class: STR, notes: STR }, required: ['status'] }

// ---------- run state ---------------------------------------------------------------------------------
let flow = FLOW_REQ
let round = 0
let curPhase = 'Refresh'
const rounds = []
const incidents = []
const flowUpgrades = []
const downModels = new Set()
const refreshTasks = {}

function enter(title) { curPhase = title; phase(title) }
function upgrade(why, r) { // v1.8 decision D-E: LITE -> FULL is recorded, never silent
  if (flow !== 'LITE') return
  flow = 'FULL'
  flowUpgrades.push({ from: 'LITE', to: 'FULL', why, round: r })
  say(`${UNIT}: flow LITE -> FULL (${why})`)
}

// retro-2026-10-19 item 11: $RUN_DIR/state.json at every phase boundary. Returns true only when the write was confirmed;
// one retry. A failed write before publication stops the unit (ruling R4); elsewhere it is recorded and the next
// boundary rewrites the whole file.
let stateWriteFailures = 0
async function writeState(ph0, decisions0, extra0) {
  const ph = scrubText(ph0), decisions = scrubOut(arr(decisions0)), extra = scrubOut(extra0 || {})
  const request = { runDir: RUN, lane: LANE, unit: UNIT, flow, phase: ph, round, base: BASE, decisions, extra: { ...extra, measurement: checkpointMeasurement() } }
  const p = `Run exactly: ${SK}/bin/gstack-autobuilder-ops state ${shellArg(J(request))}. Relay stdout verbatim; do not edit state yourself. A nonzero exit or missing helper is FAILED, never ok.`
  for (const lbl of [`state: ${ph}`, `state: ${ph} (retry)`]) {
    const r = await ask(p, { label: lbl, phase: curPhase, model: 'haiku', effort: 'low' })
    if (r && /^\s*ok\b/i.test(String(r))) return true
  }
  stateWriteFailures++
  incidents.push({ step: `state: ${ph}`, class: 'error', note: 'state.json write not confirmed after one retry' })
  say(`state.json not updated at "${ph}"`)
  return false
}

// retro-2026-10-19 item 5: classify a failed in-session call before reacting.
// agent() returns null with no error text, so the class is inferred with a one-line probe on the same model:
// no answer -> 'quota' (model unavailable: switch model); answer -> 'error' (transient: retry once).
// CLI-lane calls (Seat X, Codex/L2 work) report the gstack-lane helper's own class (quota|throttle|auth|timeout|error).
async function classify(model, step, ph) {
  const ok = await ask('Reply with exactly: OK', { label: `probe ${model} (after ${step})`, phase: ph || curPhase, model, effort: 'low' })
  const cls = ok ? 'error' : 'quota'
  if (!ok) downModels.add(model)
  // the in-session failure itself carries no metadata: record the class as inferred, with the classes it may really be
  incidents.push({ step, model, class: cls, inferred: true, possible: ok ? 'error|timeout|throttle' : 'quota|auth', basis: ok ? 'model answered a probe: transient failure (retry once)' : 'model did not answer a probe: unavailable now (switch model; quota or auth)' })
  say(`${step}: ${model} failed, classified ${cls}`)
  return cls
}

// Run a prompt down a model chain: quota -> next model; error -> one retry, then next model.
async function callChain(step, chain, prompt, opts) {
  let lastClass = 'error'
  const live = chain.filter(m => !downModels.has(m))
  for (let i = 0; i < live.length; i++) {
    const m = live[i]
    const o = Object.assign({}, opts, { model: m, label: m === chain[0] ? opts.label : `${opts.label} [${m}]` })
    let r = await ask(prompt, o)
    if (r) return { r, model: m, class: i ? lastClass : '' }
    let cls = await classify(m, o.label, opts.phase)
    if (cls === 'error') {
      r = await ask(prompt, Object.assign({}, o, { label: `${o.label} (retry)` }))
      if (r) return { r, model: m, class: 'error' }
      cls = await classify(m, `${o.label} (retry)`, opts.phase)
    }
    lastClass = cls
  }
  if (!live.length) lastClass = 'quota'
  return { r: null, model: null, class: lastClass }
}

// URL-blind results (Astra p2): agent-relayed text (notes, CI log excerpts, gh error lines) can carry URLs, possibly
// with credentials; every string of the unit's result and of the decisions written to state.json is scrubbed of
// scheme://... and user@host:path forms before it leaves the script.
const SECRET_RES = [
  [/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, '<url>'], // scheme://... to the next whitespace (a password may hold ) ] ' " >)
  [/[^\s:/@]+:\S*@(?:[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*|\[[0-9A-Fa-f:.]+\])\S*/g, '<url>'], // user:pass@host without a scheme (pass may hold @; any host form)
  [/\b[A-Za-z0-9_.-]+@(?:[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*|\[[0-9A-Fa-f:.]+\]):\S+/g, '<url>'], // scp form user@host:path (single-label hosts and IP literals too)
  [/\bgh[pousr]_[A-Za-z0-9]{30,}/g, '<token>'], [/\bgithub_pat_[A-Za-z0-9_]{30,}/g, '<token>'], [/\bsk-[A-Za-z0-9_-]{20,}/g, '<token>'],
  [/\bAuthorization\s*:\s*(?:Bearer|token|Basic)\s+\S+/gi, 'Authorization: <redacted>'], [/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, 'Bearer <redacted>'],
]
const scrubText = x => SECRET_RES.reduce((t, [re, to]) => t.replace(re, to), String(x))
// strings at ANY depth are scrubbed; cycles are detected (never a depth cut-off).
// OUTPUT points (finish / writeState / main; ids=true) exempt the VALIDATED identity fields BY FIELD, never by string:
// a value is kept verbatim only when its key is an identity key AND it fits the identity charset (no whitespace, no ':',
// no '@', so no URL / credential form can pass); the same text under any other key (notes, stopped, decision) is still
// scrubbed. A real branch like fix/sk-... must reach state.json prs[<unit>] and the result exactly (PATCH ownership).
// Intake (ask) never exempts anything.
const ID_KEYS = new Set(['unit', 'repo', 'arg', 'slug', 'host', 'owner', 'head_repo', 'branch', 'head_ref', 'recorded_branch', 'head', 'pushed_head', 'gated_head', 'local_head', 'remote_head', 'verified_sha', 'sha', 'pr', 'recorded_pr'])
const ID_VAL_RE = /^[A-Za-z0-9._\/-]{1,255}$/
const ID_MAP_KEYS = new Set(['prs']) // objects keyed by a unit directory (safe(UNIT): [A-Za-z0-9._-]{1,60})
const ID_MAPKEY_RE = /^[A-Za-z0-9._-]{1,60}$/
// OUTPUT (ids=true): a repo-path list under a path key shows a credential-shaped path as <path:ID> (round 23: never the
// scrubbed config/<token>.ts form, which still names its structure)
const OUT_PATH_KEYS = new Set(['files', 'files_since_base', 'files_since_prev', 'files_since', 'tree_delta'])
function scrubDeep(x, seen = new WeakSet(), ids = false, key = '') {
  if (ids && OUT_PATH_KEYS.has(key) && Array.isArray(x)) x = x.map(v => typeof v === 'string' && pathSecret(v) ? `<path:${pathId(v)}>` : v)
  if (typeof x === 'string') return ids && ID_KEYS.has(key) && ID_VAL_RE.test(x) ? x : scrubText(x)
  if (x === null || typeof x !== 'object') return x
  if (seen.has(x)) return '[cycle]'
  seen.add(x)
  const map = ids && ID_MAP_KEYS.has(key)
  const out = Array.isArray(x) ? x.map(v => scrubDeep(v, seen, ids)) : Object.fromEntries(Object.entries(x).map(([k, v]) => [map && ID_MAPKEY_RE.test(k) ? k : scrubText(k), scrubDeep(v, seen, ids, map ? '' : k)]))
  seen.delete(x)
  return out
}
const scrubOut = x => scrubDeep(x, new WeakSet(), true)
// every agent result is scrubbed on intake, so no relayed tool text (stderr, CI logs, notes) can flow into a later
// prompt, a state.json write, a log line or the result; and every log line is scrubbed too. EXCEPTION: the strict-line
// steps (identity, push, API, PR, PATCH setup, CI) are NOT transformed on intake: their lines are parsed against exact
// allowlists, only the validated fields are kept (never the raw line), and identity values must reach the comparisons
// unchanged (a scrubber must never turn a real branch like fix/sk-... into something else).
const strictSchema = s => s === IDL || s === LINE || s === PUSHR
// Repo-path lists (security review r20): the fields below carry repository paths that drive decisions (the sensitive-
// path classifier, the delta-review scope, the tree-delta / late-change checks). They are NEVER scrubbed on intake (a
// scrubber would rewrite config/sk-<...>.ts or a user:pass@host-shaped path before the classifier sees it); like strict-
// schema data they are kept verbatim and validated against PATH_OK by the consumer, which BLOCKs on a failure
// (invalid_path:<field>, the value never echoed). Every other field of these envelopes is scrubbed as usual.
const PATH_FIELDS = new Map([[FILES, ['files']], [GS, ['files_since_base', 'files_since_prev']], [GUARD, ['files_since', 'tree_delta']], [INT, ['files']]])
// Logical requests include Workflow replay: these are NOT billable-call or token counters.
// Only string lengths/counts persist. No prompts, reports, paths or provider credentials.
const measurement = { version: 1, logical_dispatches: 0, prompt_chars: 0, response_chars: 0, null_results: 0, thrown_calls: 0, by_model: {}, by_phase: {} }
function checkpointMeasurement() {
  const { by_model, by_phase, ...counts } = measurement
  return { ...counts, actual_tokens: null, duration_ms: null }
}
function measurementSnapshot() {
  return JSON.parse(J({ ...measurement, actual_tokens: null, duration_ms: null, cache_status: 'unknown',
    measurement_scope: 'workflow logical requests; UTF-16 chars; excludes loaded files, schemas, tools and nested CLI calls',
    snapshot: 'before this checkpoint relay; final result includes it' }))
}
const ask = async (prompt, opts) => {
  measurement.logical_dispatches++
  measurement.prompt_chars += String(prompt).length
  const key = String((opts && opts.model) || 'unspecified')
  const bucket = measurement.by_model[key] || (measurement.by_model[key] = { logical_dispatches: 0, prompt_chars: 0 })
  bucket.logical_dispatches++; bucket.prompt_chars += String(prompt).length
  // Fixed vocabulary prevents phase descriptions or unit names entering telemetry.
  const phaseKey = ((String((opts && opts.phase) || '').match(/^(Refresh|Build|Integrate|Gate|Fix|Ship|PATCH)\b/) || [])[1] || 'other').toLowerCase()
  const phaseBucket = measurement.by_phase[phaseKey] || (measurement.by_phase[phaseKey] = { logical_dispatches: 0, prompt_chars: 0 })
  phaseBucket.logical_dispatches++; phaseBucket.prompt_chars += String(prompt).length
  let r
  try { r = await agent(prompt, opts) } catch (e) { measurement.thrown_calls++; throw e }
  if (r == null) measurement.null_results++
  else { try { measurement.response_chars += (typeof r === 'string' ? r : J(r)).length } catch {} }
  if (opts && strictSchema(opts.schema)) return r
  const out = scrubDeep(r), pf = opts && PATH_FIELDS.get(opts.schema)
  if (pf && r && out && typeof r === 'object' && typeof out === 'object') for (const k of pf) if (Array.isArray(r[k])) out[k] = r[k].slice()
  return out
}
// The repo-path allowlist: a relative path of 1..1024 chars, '/'-separated segments of 1..255 chars from
// [A-Za-z0-9 . _ @ + = , : ~ % # - [ ] ( ) and space], no '.' or '..' segment (so no traversal, no ./ prefix), no empty
// segment (no leading '/', no '//', no trailing '/'), not starting with '-' (an option) or ':' (git pathspec magic).
// Next.js App Router names ([locale], (marketing), [...slug], [[...catchall]]) and spaces are allowed. Rejected: NUL,
// control characters (newline, tab), quotes (' " `), backslash, $ ; | & < > * ? ! { } ^ and every other character;
// non-ASCII names arrive C-quoted by git and are rejected too (documented limit). ':' and '@' are allowed so a
// user:pass@host-shaped NAME is representable (it is then sensitive); a scheme URL fails ('//' is an empty segment).
// Because ' is rejected, a valid path is always safe inside single quotes (shq), and every git command that takes one
// as a pathspec is told to use --literal-pathspecs: in git, [locale] is a glob matching ONE character (src/app/l/...).
const PATH_SEG_RE = /^[A-Za-z0-9._@+=,:~%#[\]() -]{1,255}$/
const PATH_OK = f => typeof f === 'string' && f.length >= 1 && f.length <= 1024 && !/^[-:]/.test(f) && f.split('/').every(x => PATH_SEG_RE.test(x) && x !== '.' && x !== '..')
// why a path failed PATH_OK, as a cause class (the value itself is never echoed; the offender is named by <path:ID>)
function pathWhy(f) {
  if (typeof f !== 'string') return 'type'
  if (!f.length || f.length > 1024) return 'length'
  if (/[\x00-\x1f\x7f]/.test(f)) return 'control'
  if (/[^\x00-\x7e]/.test(f) || /^".*\\[0-7]{3}/.test(f)) return 'non_ascii' // raw UTF-8, or git's C-quoted form
  if (/['"`\\]/.test(f)) return 'quote'
  if (/[$;|&<>*?!{}^]/.test(f)) return 'shell'
  if (/:\/\//.test(f)) return 'url'
  if (f.startsWith('/')) return 'absolute'
  if (/^[-:]/.test(f)) return 'option'
  if (f.split('/').some(x => x === '.' || x === '..')) return 'traversal'
  if (f.split('/').some(x => !x.length)) return 'empty_segment'
  if (f.split('/').some(x => x.length > 255)) return 'length'
  return 'charset'
}
// -> '' when every listed field is an array of valid paths, else the BLOCK text
// "invalid_path:<field> (<where>; <path:ID>: <cause>; a path outside the allowlist)" (the value is never echoed)
function badPaths(r, fields, where) {
  for (const k of fields) {
    if (r[k] === undefined) continue
    const f = Array.isArray(r[k]) ? r[k].find(x => !PATH_OK(x)) : r[k]
    if (f !== undefined) return `invalid_path:${k} (${where}; ${Array.isArray(r[k]) ? `<path:${pathId(String(f))}>: ${pathWhy(f)}` : 'not a list'}; a path outside the allowlist)`
  }
  return ''
}
// A path scrubText WOULD rewrite (token- or userinfo-shaped) is kept verbatim for every decision, classified SENSITIVE,
// and never written raw into free text, a prompt or the result: it is shown as <path:ID>, ID = the first 12 hex of its
// git blob id (git hash-object of the path text), so an agent can resolve it locally without the name being relayed.
const pathSecret = f => scrubText(f) !== String(f)
// UTF-8 bytes of a string (an invalid, non-ASCII path still gets the id git hash-object would give it)
function utf8(str) {
  const b = []
  for (const ch of String(str)) {
    const c = ch.codePointAt(0)
    if (c < 0x80) b.push(c)
    else if (c < 0x800) b.push(0xc0 | (c >> 6), 0x80 | (c & 63))
    else if (c < 0x10000) b.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63))
    else b.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63))
  }
  return b
}
const pathHash = f => { const body = utf8(f); return sha1Hex([...utf8(`blob ${body.length}`), 0, ...body]) } // git blob id
const pathId = f => pathHash(f).slice(0, 12)
// ids for the credential-shaped paths of ONE rendered list (round 23): 12 hex, lengthened (up to all 40) until distinct
// paths get distinct ids; `hash` is injectable so a forced duplicate prefix can be tested
function assignIds(paths, hash = pathHash) {
  const u = [...new Set(arr(paths).map(String))], full = new Map(u.map(f => [f, hash(f)]))
  let n = 12
  while (n < 40 && new Set(u.map(f => full.get(f).slice(0, n))).size < u.length) n++
  return { n, id: f => full.get(String(f)).slice(0, n) }
}
const showPath = f => pathSecret(f) ? `<path:${pathId(f)}>` : String(f)
// THE renderer for repo paths in ANY prompt, message, log line or result text (rounds 22-23): every interpolation of a
// PATH_FIELDS value or a list derived from one goes through renderPaths / showPaths / pathIdList / shellPaths / scopeText
// (a static bun test enforces it). Credential-shaped paths appear only as <path:ID>; when an agent must act on the
// files, `range` adds the resolve-by-id command, pinned to the lane (git -C '<lane>' for both git calls, so the ids
// never depend on the agent's cwd or on another repository's object format; the lane is SHA-1: SHA_RE is 40-hex). It
// prints nothing but "AMBIGUOUS <id>" when two changed paths share an id prefix (never two mappings for one id).
const pathResolver = (range, n = 12) => String.raw`git -C ${shq(LANE)} diff --name-only ${range} | while IFS= read -r p; do printf '%s %s\n' "$(printf '%s' "$p" | git -C ${shq(LANE)} hash-object --stdin | cut -c1-${n})" "$p"; done | awk '{ c[$1]++; l[NR] = $0 } END { for (k in c) if (c[k] > 1) { print "AMBIGUOUS " k; exit 1 } for (i = 1; i <= NR; i++) print l[i] }'`
function renderPaths(list, { range = '', json = true } = {}) {
  const ids = assignIds(arr(list).filter(pathSecret))
  const shown = arr(list).map(f => pathSecret(f) ? `<path:${ids.id(f)}>` : String(f)), held = arr(list).filter(pathSecret).length
  const body = json ? J(shown) : shown.join(', ')
  return held && range ? `${body} (a <path:ID> is a credential-shaped path withheld from this text: resolve ids locally with ${pathResolver(range, ids.n)}; refer to such a path only by its id in everything you write)` : body
}
const showPaths = fs => renderPaths(fs, { json: false })
// the ids alone (JSON), and the plain (non-credential-shaped) paths as single-quoted shell words
const pathIdList = list => { const ids = assignIds(list); return { n: ids.n, text: J(arr(list).map(ids.id)) } }
const shellPaths = list => arr(list).filter(f => !pathSecret(f)).map(shq).join(' ')
function sha1Hex(bytes) { // SHA-1 over a byte array (the Workflow VM has no crypto module)
  const b = bytes.slice()
  const bits = b.length * 8; b.push(0x80); while (b.length % 64 !== 56) b.push(0)
  for (let i = 7; i >= 0; i--) b.push(i >= 4 ? 0 : (bits >>> (i * 8)) & 255)
  let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476, h4 = 0xc3d2e1f0
  const w = new Array(80), rol = (x, n) => (x << n) | (x >>> (32 - n))
  for (let o = 0; o < b.length; o += 64) {
    for (let i = 0; i < 16; i++) w[i] = (b[o + 4 * i] << 24) | (b[o + 4 * i + 1] << 16) | (b[o + 4 * i + 2] << 8) | b[o + 4 * i + 3]
    for (let i = 16; i < 80; i++) w[i] = rol(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1)
    let a = h0, bb = h1, c = h2, d = h3, e = h4
    for (let i = 0; i < 80; i++) {
      const f = i < 20 ? (bb & c) | (~bb & d) : i < 40 ? bb ^ c ^ d : i < 60 ? (bb & c) | (bb & d) | (c & d) : bb ^ c ^ d
      const k = i < 20 ? 0x5a827999 : i < 40 ? 0x6ed9eba1 : i < 60 ? 0x8f1bbcdc : 0xca62c1d6
      const t = (rol(a, 5) + f + e + k + w[i]) | 0; e = d; d = c; c = rol(bb, 30); bb = a; a = t
    }
    h0 = (h0 + a) | 0; h1 = (h1 + bb) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0; h4 = (h4 + e) | 0
  }
  return [h0, h1, h2, h3, h4].map(x => (x >>> 0).toString(16).padStart(8, '0')).join('')
}
const say = m => log(scrubText(m))
async function finish(res0) {
  // the COMPLETE assembled result (incidents, rounds, flow_upgrades, stopped, decision, notes, envelopes) is scrubbed;
  // only the validated identity fields are exempt (by field: scrubOut)
  const out = scrubOut(Object.assign({ unit: UNIT, flow_requested: FLOW_REQ, flow, gate_class: GATE_CLASS, round, rounds, flow_upgrades: flowUpgrades, incidents }, res0))
  if (!out.status) out.status = out.stopped ? (/^BLOCKED/.test(out.stopped) ? 'BLOCKED' : 'STOPPED') : 'DONE'
  const ph = out.status === 'READY' ? 'READY' : (out.stopped ? `${out.status}: ${out.stopped}` : out.status)
  if (!(await writeState(ph, out.decision ? [out.decision] : []))) out.state_write_failed = true
  if (stateWriteFailures) out.state_write_failures = stateWriteFailures
  out.measurement = measurementSnapshot()
  out.measurement.snapshot = 'final result includes the final checkpoint relay'
  return out
}

// ---------- build helpers -----------------------------------------------------------------------------
const namedChecks = id => arr(refreshTasks[id] && refreshTasks[id].named_checks)

// v1.8 decision D-C + retro-2026-10-19 item 12: a failed check, or a named check missing from checks[], escalates once
function checkGap(job, env) {
  if (!env) return 'no envelope'
  const cs = arr(env.checks)
  if (!cs.length) return 'checks[] missing'
  const failed = cs.filter(c => Number(c.exit_code) !== 0).map(c => c.name)
  if (failed.length) return `failed check(s): ${failed.join(', ')}`
  const missing = arr(job.named).filter(n => !cs.some(c => c.name === n.name || (n.command && c.command && String(c.command).trim() === String(n.command).trim())))
  if (missing.length) return `missing named check(s): ${missing.map(n => n.name).join(', ')}`
  if (!/^DONE/.test(String(env.status || ''))) return `status ${env.status}`
  return ''
}

function claudePrompt(job, where, from, m, why) {
  const loc = where.kind === 'lane' ? `the lane ${LANE} on branch ${BR}` : `task worktree ${where.cwd} (gstack-lane task ${where.task}, base_sha ${where.base})`
  // ruling R9: every commit goes through gstack-lane's secret/filter guard (never a raw git commit)
  const commit = where.kind === 'lane' ? `${GL} commit --cwd ${LANE} --base ${BASE} -m "<summary>"` : `${GL} commit --run-dir ${RUN} --task ${where.task} --base ${where.base} -m "<summary>"`
  return `${job.text} Work in ${loc}${from ? ` (HEAD ${from})` : ''} at ${m.effort} effort.${why ? ` ${why}.` : ''} Other tasks of this wave run in separate worktrees; do not touch their files.${PRIV(`${DB}_${slug(job.id)}`, where.cwd)} ${CONC} Run every named check and record each as {name, command, exit_code} in checks[]; a named check you did not run counts as missing and escalates the task. Commit via ${commit} (it stages everything; the message ends with the trailer line "${TRAILER}"; a secret_path= / filter_path= refusal is reported verbatim as status BLOCKED, never worked around). ${EDIT_NOTE} Write ${job.report}. Return the envelope.`
}

// CLI-lane implementation (L3 Codex or L2 second Claude account) through gstack-lane, inside a Sonnet wrapper.
async function laneImpl(o) {
  const { lane, model, job, where, why, tag, ph } = o
  const effort = lane === 'l3' ? l3Effort(o.effort) : (o.effort || 'high')
  const atask = safe(`${U}-${job.id}-${tag}`)
  const laneName = lane === 'l3' ? 'Codex (L3)' : 'second-account Claude (L2)'
  const ws = where.kind === 'lane'
    ? `cwd=${LANE}. Record START=$(git -C ${LANE} rev-parse HEAD); git -C ${LANE} status --porcelain must be empty (else return BLOCKED).`
    : `cwd=${where.cwd}, the gstack-lane task worktree ${where.task} (base_sha ${where.base}); reuse it as is.`
  const commit = where.kind === 'lane' ? `${GL} commit --cwd ${LANE} --base $START` : `${GL} commit --run-dir ${RUN} --task ${where.task} --base ${where.base}`
  const allow = lane === 'l2' ? ' --allow-cmd "<each vetted check prefix the job needs, e.g. bun test>"' : ''
  const prompt = `You are the Sonnet wrapper for ONE ${laneName} development run launched through gstack-lane (${GL}). You launch it, verify it, commit it and report. You never edit repository files yourself and never dispatch subagents.${why ? ` Context: ${why}.` : ''}
JOB (${job.id}, tier ${job.tier}): ${job.text}
1. Workspace: ${ws} Install dependencies there if the project needs them and they are missing.
2. Attempt dir (fresh, never reused): AID=$(date -u +%Y%m%dT%H%M%SZ)-$$; ADIR=${RUN}/attempts/${atask}/$AID; mkdir -p "$ADIR". Write "$ADIR/prompt.txt" = the JOB text above, then: "Docker and private test databases may be unreachable from your sandbox: write DB-backed tests, run only DB-free tests, typecheck and lint yourself. Do NOT run git commit or any git write (the wrapper commits). End with a short summary: files changed, tests you ran with results, tests you could not run, the commit message to use, concerns."
3. Run (Bash timeout 600000 per call) the helper command ${GL} run --run-dir ${RUN} --lane ${lane} --mode impl --tier ${job.tier} --model ${model} --effort ${effort} --cwd <cwd> --prompt-file "$ADIR/prompt.txt" --out "$ADIR/impl.json" --timeout 3600${allow}. ${POLL('<that command>', '$ADIR/impl.json', 3900)} Then ${GL} summary --out "$ADIR/impl.json"; a missing status file is BLOCKED with failure_class error. Read class, exit and runtime_model from "$ADIR/impl.json.status.json". Accept only class ok, exit 0 and a non-null runtime_model. class quota or auth (including skipped cooling/absent): stop and return status LANE_UNAVAILABLE with failure_class = that class and reset_at = next_probe_at of ${lane} in ${RUN}/lanes.json. class timeout, throttle or error: ONE more run in a fresh attempt dir, then BLOCKED with failure_class.
4. Verify what the sandbox could not: the changes in cwd, typecheck, lint, every named check of the JOB${PRIV(`${DB}_${slug(job.id)}`, '<cwd>')} ${CONC}
5. At most 2 fix passes: a new run (fresh attempt dir) whose prompt is the JOB plus the failure summary (failing names + key lines, under 60 lines).
6. Commit: ${commit} -m "<the proposed message, ending with the line ${TRAILER}>". The helper refuses credential-shaped paths: report a refusal verbatim, never work around it.
7. Write ${job.report}. Return the envelope: checks[] = {name, command, exit_code} for every check you ran in step 4; requested_model=${model}; actual_model = the runtime_model; failure_class when not DONE.`
  const label = `${tag} ${job.id} (${lane} ${model})`
  let env = await ask(prompt, { label, phase: ph, model: 'sonnet', effort: 'high', schema: ENV })
  if (!env) {
    const cls = await classify('sonnet', label, ph)
    env = await ask(prompt, { label: `${label} (retry)`, phase: ph, model: 'sonnet', effort: 'high', schema: ENV })
    if (!env) return { status: 'BLOCKED', head: '', test_result: 'wrapper died', failure_class: cls }
  }
  if (env.status === 'LANE_UNAVAILABLE') incidents.push({ step: label, model, class: env.failure_class || 'quota', lane, reset_at: env.reset_at || '' })
  return env
}

// v1.8 decision D-C escalation column: L3 gpt-6.1-sol medium -> L2 Sonnet -> L1 Sonnet (once)
async function escalate(job, where, prior, gap, ph) {
  const why = `escalated ONCE (v1.8 D-C) after a Haiku attempt (head ${(prior && prior.head) || 'unknown'}): ${gap}. Finish the job so every named check passes`
  incidents.push({ step: `${ph} ${job.id}`, class: 'check', note: why })
  say(`${job.id}: Haiku ${gap} -> escalating once`)
  let env = await laneImpl({ lane: 'l3', model: 'gpt-6.1-sol', effort: 'medium', job, where, why, tag: `esc-${ph}`, ph })
  if (env && env.status !== 'LANE_UNAVAILABLE') return env
  env = await laneImpl({ lane: 'l2', model: 'claude-sonnet-5-5', effort: 'high', job, where, why, tag: `esc-${ph}`, ph })
  if (env && env.status !== 'LANE_UNAVAILABLE') return env
  return ask(claudePrompt(job, where, '', { model: 'sonnet', effort: 'high' }, why), { label: `esc-${ph} ${job.id} (L1 sonnet)`, phase: ph, model: 'sonnet', effort: 'high', schema: ENV })
}

// In-session (L1) implementation; L1 quota spills to L2 with the same model family (never Fable via claude -p).
async function claudeImpl(job, where, from, m, why, ph) {
  const label = `${ph === 'Build' ? 'build' : `fix-${job.tag || ph}`} ${job.id} (${m.model}${why ? ', ' + why : ''})`
  const prompt = claudePrompt(job, where, from, m, why)
  let env = await ask(prompt, { label, phase: ph, model: m.model, effort: m.effort, schema: ENV })
  let ran = m.model
  if (!env) {
    const cls = await classify(m.model, label, ph)
    if (cls === 'quota') {
      ran = L2_MODEL[m.model] || 'claude-opus-5-5'
      env = await laneImpl({ lane: 'l2', model: ran, effort: m.effort, job, where, why: `L1 ${m.model} unavailable (${cls})`, tag: `spill-${ph}`, ph })
    } else env = await ask(prompt, { label: `${label} (retry)`, phase: ph, model: m.model, effort: m.effort, schema: ENV })
  }
  if (/haiku/.test(ran)) { // v1.8 decision D-C: Haiku dev dispatches must prove their checks
    const gap = checkGap(job, env)
    if (gap) env = await escalate(job, where, env, gap, ph)
  }
  return env
}

// One in-session (L1) attempt for a T2/T3 chain step (L1 Opus is the LAST spillover, rule 2). A limit -> LANE_UNAVAILABLE
// so the chain moves on; a transient failure gets one retry.
async function claudeL1(job, where, from, s, why, ph) {
  const label = `${ph === 'Build' ? 'build' : `fix-${job.tag || ph}`} ${job.id} (L1 ${s.model}${why ? ', ' + why : ''})`
  const m = { model: s.model, effort: s.effort }
  const prompt = claudePrompt(job, where, from, m, why)
  let env = await ask(prompt, { label, phase: ph, model: m.model, effort: m.effort, schema: ENV })
  if (env) return env
  const cls = await classify(m.model, label, ph)
  if (cls === 'quota') return { status: 'LANE_UNAVAILABLE', head: '', test_result: 'L1 unavailable', failure_class: cls }
  env = await ask(prompt, { label: `${label} (retry)`, phase: ph, model: m.model, effort: m.effort, schema: ENV })
  return env || { status: 'BLOCKED', head: '', test_result: 'L1 attempt died twice', failure_class: 'error' }
}

// Walk a routing-table chain (implChain): the first lane that is not LANE_UNAVAILABLE owns the job.
async function runChain(job, where, from, steps, ph) {
  const tag = ph === 'Build' ? 'build' : `fix-${job.tag || ph}`
  let why = ''
  let last = null
  for (const s of steps) {
    let env
    if (s.lane === 'l1' && s.low) return claudeImpl(job, where, from, s.m, why, ph) // Haiku chain: L2 spill + D-C escalation inside
    if (s.lane === 'l1') env = await claudeL1(job, where, from, s, why, ph)
    else env = await laneImpl({ lane: s.lane, model: s.model, effort: s.effort, job, where, why, tag, ph })
    if (env && env.status !== 'LANE_UNAVAILABLE') return env
    last = env
    why = `${s.lane.toUpperCase()} ${s.model} unavailable (${(env && env.failure_class) || 'quota'})`
  }
  return last || { status: 'BLOCKED', head: '', test_result: 'no lane available', failure_class: 'quota' }
}

// ---------- gate members ------------------------------------------------------------------------------
function seatCCore(round, seatScope, gs, prev) {
  const range = seatScope === 'delta' ? `${prev}..${gs.reviewed_sha}` : `${BASE}...${gs.reviewed_sha}`
  return `Seat C (Claude) of the ${UNIT} gate, round ${round}${seatScope === 'delta' ? ' (scoped to the fix delta; the earlier range was already reviewed and its rulings are in the register)' : ''}. Ship-unit ${UNIT} = ${IDS.join(', ') || 'see the briefs'}.${opt(A.gateFocus, f => ' ' + f)} Briefs (the acceptance criteria): ${BRIEFS || B}. Code: ${LANE} (branch ${BR}); RANGE=${range} — diff exactly this range, never a moving ref. Read-only: never edit, commit, stash or check out anything.
Already adjudicated in this unit (do not re-file without new facts): read ${RULINGS} first; a claim in it is closed unless you state a NEW fact.
ONE pass, two methodologies, findings only: read ${SK}/autobuilder-loop/sections/seat-c-review.md and the checklist it requires; apply all engineering dimensions and both checklist passes; both against the RANGE diff and the briefs. If the rubric or checklist is missing or unreadable, return REVIEW_INCOMPLETE, never clean. ${SEATC_SKIP} Anything either skill would ask the user: take the recommended option and list genuine taste calls in notes. Verify every acceptance clause of the briefs against the code (file:line, or MISSING). ${SEV}
Write the full report to ${R}/gate-${U}-r${round}-seat-c.md.`
}

// Seat C fail-closed checks (ruling R4): PRESENT only with the completion marker as the report's last non-empty line,
// from an orchestration-class model the RUNTIME reports (a coerced or unknown model is INVALID; never the requested name).
const MARKER_RULE = 'End the report with exactly this final line and nothing after it: REVIEW_COMPLETE: findings=<n> (n = the number of [P1]/[P2] findings; 0 if none) — but ONLY if you actually read and reviewed the whole RANGE diff; if you could not, end instead with REVIEW_INCOMPLETE: <reason>.'
const MARKER_RE = /^\s*(?:\*\*|__|`)?REVIEW_COMPLETE: findings=\d{1,4}(?:\*\*|__|`)?\s*$/
// ruling S3: an EXACT, anchored allowlist of normalized full ids, the same set on L1 and L2 (SEATC_L2_ADJ)
const SEATC_MODELS = ['claude-fable-5-1', 'fable', 'claude-opus-5-5', 'claude-opus-4-8']
const seatCModelOk = m => SEATC_MODELS.includes(String(m || '').trim().toLowerCase())
function seatCL1Check(env, chainModel, first) {
  const e = Object.assign({}, env, { member: 'seat_c', requested_model: chainModel, runtime_model: env.actual_model || null })
  if (chainModel !== first) e.substituted = `${first}->${chainModel}`
  const p1 = arr(e.p1).length || Number(e.p1_count) > 0
  let why = ''
  if (!MARKER_RE.test(String(e.final_line || ''))) why = `no completion marker (final_line ${J(String(e.final_line || '').slice(0, 80))})`
  else if (!seatCModelOk(e.actual_model)) why = `runtime model ${J(e.actual_model || null)} is not an orchestration-class model (coerced or unreported)`
  else if (String(e.status || '').toUpperCase() !== 'PRESENT') why = `status ${e.status}`
  if (why) return Object.assign(e, { status: 'INVALID', verdict: 'INVALID', class: 'ok', notes: `Seat C INVALID: ${why}` })
  return Object.assign(e, { status: 'PRESENT', verdict: p1 ? 'FAIL' : 'PASS' })
}

// v1.8 decision D-B: Seat C = Fable high (L1) -> claude-opus-5-5 high (L1) -> claude-opus-5-5 high (L2)
async function seatC(round, seatScope, gs, prev) {
  const core = seatCCore(round, seatScope, gs, prev)
  const first = (A.synModel && round >= (A.synGateFrom || 99)) ? A.synModel : SEATC
  const c = await callChain(`r${round} seat C`, uniq([first, 'claude-opus-5-5']), `${core}\n${MARKER_RULE}\nReturn the envelope (member=seat_c; status PRESENT only when you completed the review and the report ends with the REVIEW_COMPLETE line, else INVALID; final_line = the report's last non-empty line, verbatim; actual_model = the literal model id you are running as, from your own system context (never the name you were asked for); verdict PASS or FAIL, FAIL iff any [P1]; p1 = one line per [P1]; p2_count; report).`, { label: `r${round} seat C`, phase: 'Gate', effort: 'high', schema: GATE })
  if (c.r) return seatCL1Check(c.r, c.model, first)
  const T = safe(`gate-${U}-r${round}-c-l2`)
  const label = `r${round} seat C (L2 claude-opus-5-5)`
  const rng = seatScope === 'delta' ? `${prev}..${gs.reviewed_sha}` : `${BASE}...${gs.reviewed_sha}`
  const p = `Rote relay for Seat C on lane L2 (second Claude account, claude-opus-5-5 at high effort; never Fable here, never --allow-credit-billing). Use Bash, every call with timeout 600000; run commands and copy their outputs; never read, judge or summarize review text yourself. Use the literal ADIR / OUT paths in every later call.
1. ${GL} worktree add --run-dir ${RUN} --task ${T} --base ${gs.reviewed_sha} --detach --repo ${REPO} (reuse ${RUN}/wt/${T} if it exists). On failure return status ABSENT, verdict ABSENT, class error.
2. AID=$(date -u +%Y%m%dT%H%M%SZ)-$$; ADIR=${RUN}/attempts/${T}/$AID; mkdir -p "$ADIR"; OUT="$ADIR/review.json".
3. Write "$ADIR/prompt.txt" = the review brief between the markers, then a line "THE DIFF (you cannot run git; it is ${rng}):" and the output of git -C ${LANE} diff ${rng}, then "Already adjudicated in this unit (do not re-file without new facts):" and the content of ${RULINGS}. Append to the brief: "You cannot write files: reply with the full review text instead of writing the report. If you cannot read a skill file, apply the methodology named here from your own knowledge. Tag every finding [P1] or [P2] at the start of its line. ${MARKER_RULE}"
<<<BRIEF
${core}
BRIEF>>>
4. The helper command is: ${GL} run --run-dir ${RUN} --lane l2 --mode review --model claude-opus-5-5 --effort high --timeout 1200 --retry-timeout 600 --cwd ${RUN}/wt/${T} --prompt-file "$ADIR/prompt.txt" --out "$OUT". ${POLL('<that command>', '$OUT', 2100)} Then SUMMARY=$(${GL} summary --out "$OUT" 2>&1).
5. Decode and adjudicate mechanically: write this block verbatim to "$ADIR/adj.sh" with a quoted heredoc (cat > "$ADIR/adj.sh" <<'ABU_ADJ_EOF' ... ABU_ADJ_EOF), then run OUT="$OUT" ADIR="$ADIR" bash "$ADIR/adj.sh" and copy its one SEATC line:
${SEATC_L2_ADJ}
6. cp "$ADIR/review.txt" ${R}/gate-${U}-r${round}-seat-c.md 2>/dev/null; ${GL} worktree rm --run-dir ${RUN} --task ${T} --force.
Envelope: member=seat_c; requested_model=claude-opus-5-5; runtime_model = the runtime_model= token of the SEATC line; summary_line=$SUMMARY verbatim; verdict_line = the SEATC line verbatim; class = its class= token; report=${R}/gate-${U}-r${round}-seat-c.md; status = its status= token (PRESENT, INVALID or ABSENT, copied, never upgraded); p1_count = its p1= token; verdict FAIL if status PRESENT and p1_count > 0, PASS if status PRESENT and p1_count = 0, INVALID if status INVALID, else ABSENT; p1=[].`
  let e = await ask(p, { label, phase: 'Gate', model: 'haiku', effort: 'low', schema: GATE })
  if (!e) e = { status: 'ABSENT', verdict: 'ABSENT', class: await classify('haiku', label, 'Gate'), notes: 'the L2 relay died; Seat C never ran (not a reviewer verdict)' }
  e = Object.assign({}, e, { member: 'seat_c', requested_model: 'claude-opus-5-5', substituted: `${first}->L2 claude-opus-5-5` })
  // re-check the relay's copy against its own SEATC line (fail closed: a status the line does not show is INVALID)
  const vl = String(e.verdict_line || '')
  const st = String(e.status || '').toUpperCase()
  // the status comes from the SEATC line's own status= token; without a SEATC line only a non-run ABSENT is accepted
  const tok = (vl.match(/^SEATC status=(PRESENT|INVALID|ABSENT)\b/) || [])[1]
  const p1n = Number((vl.match(/\bp1=(\d+)/) || [])[1] || 0)
  if (tok) Object.assign(e, { status: tok, verdict: tok === 'PRESENT' ? (p1n > 0 ? 'FAIL' : 'PASS') : tok, p1_count: p1n, runtime_model: (vl.match(/\bruntime_model=(\S+)/) || [])[1] || null })
  else if (st !== 'ABSENT') Object.assign(e, { status: 'INVALID', verdict: 'INVALID', notes: `relay reported ${st || 'no status'} without a SEATC line (${vl.slice(0, 120)})` })
  if (String(e.status).toUpperCase() === 'PRESENT' && !seatCModelOk(e.runtime_model)) Object.assign(e, { status: 'INVALID', verdict: 'INVALID', notes: `runtime model ${e.runtime_model || 'null'} is not on the Seat C allowlist` })
  if (String(e.status).toUpperCase() !== 'PRESENT') incidents.push({ step: `r${round} seat C`, model: 'claude-opus-5-5 (L2)', status: e.status, class: e.class || 'error' })
  return e
}

// v1.8 decision D-B: Seat X = Codex via gstack-lane l3 review, mechanical adjudication, Haiku relay
function seatXPrompt(round, gs, model) {
  const T = safe(`gate-${U}-r${round}-x-${slug(model)}`)
  const to = /astra/.test(model) ? '900 --retry-timeout 420' : '600 --retry-timeout 300'
  const sha = gs.reviewed_sha
  const review = `IMPORTANT: Do NOT read or execute any SKILL.md files or files in skill definition directories (paths containing skills/gstack). Do NOT modify any files. Stay focused on the repository code only.

You are the adversarial other-vendor reviewer (Seat X) of the ${UNIT} gate, round ${round}. Review ONLY the commits ${BASE}...${sha} (this checkout is at ${sha}): run git diff ${BASE}...${sha}. Acceptance criteria: the briefs at ${BRIEFS || B}.${opt(A.gateFocus, f => ' ' + f)} Think like an attacker and a chaos engineer: wrong behaviour vs the briefs, edge cases, races, lock order, transaction boundaries, silent data corruption, tests that cannot fail for the thing they claim to guard. Tag every finding [P1] (ship-blocker) or [P2] (lower severity), one finding per line with the tag first: file:line, the defect, a concrete failure scenario, a suggested fix. CHANGELOG and docs prose is never [P1]. If there are no [P1] issues, say so explicitly. No compliments. End your review with exactly this final line and nothing after it: REVIEW_COMPLETE: findings=<n> (n = the number of [P1]/[P2] findings you listed; 0 if none) — but ONLY if you actually read and reviewed the diff; if you could not, end instead with REVIEW_INCOMPLETE: <reason>.`
  return `Rote relay for Seat X of the ${UNIT} gate, round ${round}${opt(A.gateAttempt, a => ` (gate attempt ${a})`)} (class R: run commands and copy the helper's one-line outputs verbatim; never read, judge or summarize review text). Use Bash, every call with timeout 600000; use the literal ADIR / OUT paths in every later call.
0. CODEX_REVIEWS=$(${SK}/bin/gstack-config get codex_reviews 2>/dev/null || echo enabled). If it is exactly "disabled" or "off": run nothing else and return status ABSENT, verdict ABSENT, class disabled, notes "codex_reviews=<value>: Seat X ABSENT by user config". Any other value (including empty or unknown) continues.
1. ${GL} worktree add --run-dir ${RUN} --task ${T} --base ${sha} --detach --repo ${REPO} (reuse ${RUN}/wt/${T} if it exists). On failure return status ABSENT, verdict ABSENT, class error.
2. AID=$(date -u +%Y%m%dT%H%M%SZ)-$$; ADIR=${RUN}/attempts/${T}/$AID; mkdir -p "$ADIR"; OUT="$ADIR/review.md" (a fresh dir; never reuse an attempt).
3. Prompt file (the rulings register is prepended, retro item 2):
{ printf '%s\\n' 'Already adjudicated in this unit (do not re-file without new facts):'; cat ${RULINGS} 2>/dev/null || echo '[]'; printf '\\n'; cat <<'ABU_SEATX_EOF'
${review}
ABU_SEATX_EOF
} > "$ADIR/prompt.txt"
4. The helper command is: ${GL} run --run-dir ${RUN} --lane l3 --mode review --model ${model} --effort high --timeout ${to} --cwd ${RUN}/wt/${T} --prompt-file "$ADIR/prompt.txt" --out "$OUT". ${POLL('<that command>', '$OUT', /astra/.test(model) ? 1620 : 1200)} The helper owns the one medium retry on timeout.
5. SUMMARY=$(${GL} summary --out "$OUT" 2>&1); VERDICT=$(${GL} adjudicate --out "$OUT" --seat codex --gate-class ${GATE_CLASS} --reviewed-sha ${sha} --requested-model ${model} 2>/dev/null); RC=$?; CLASS = the class field of "$OUT.status.json" ("error" when missing); RESET = next_probe_at of l3 in ${RUN}/lanes.json (empty when none).
6. ${GL} worktree rm --run-dir ${RUN} --task ${T} --force.
Envelope: member=seat_x; requested_model=${model}; verdict_line=$VERDICT verbatim (or "VERDICT=ABSENT reason=no_verdict_line adjudicate_exit=$RC" when empty); summary_line=$SUMMARY verbatim; runtime_model and p1_count = the runtime_model= and p1_count= tokens of the VERDICT line; class=CLASS; reset_at=RESET; report=$OUT; p1=[] (the consolidator reads $OUT). Map RC: 0 -> status PRESENT, verdict PASS; 10 -> status PRESENT, verdict FAIL; 11 -> status INVALID, verdict INVALID; anything else -> status ABSENT, verdict ABSENT.`
}

async function seatX(round, gs) {
  const once = async model => {
    const label = `r${round} seat X (${model})`
    let e = await ask(seatXPrompt(round, gs, model), { label, phase: 'Gate', model: 'haiku', effort: 'low', schema: GATE })
    if (!e) {
      const cls = await classify('haiku', label, 'Gate')
      e = await ask(seatXPrompt(round, gs, model), { label: `${label} (relay retry)`, phase: 'Gate', model: 'haiku', effort: 'low', schema: GATE })
      if (!e) e = { status: 'ABSENT', verdict: 'ABSENT', class: 'error', notes: `the relay died twice (${cls}); Seat X never ran (not a reviewer verdict)` }
    }
    e = Object.assign({}, e, { member: 'seat_x', requested_model: model })
    // fail closed: the status comes from the helper's VERDICT= token itself, never the relay's own RC mapping; without a
    // VERDICT line only a non-run (ABSENT: disabled, dead relay, failed worktree) is accepted as reported
    const vl = String(e.verdict_line || ''), st = String(e.status || '').toUpperCase()
    const tok = (vl.match(/VERDICT=(PRESENT_CLEAN|PRESENT_P1|INVALID|ABSENT)\b/) || [])[1]
    const MAP = { PRESENT_CLEAN: ['PRESENT', 'PASS'], PRESENT_P1: ['PRESENT', 'FAIL'], INVALID: ['INVALID', 'INVALID'], ABSENT: ['ABSENT', 'ABSENT'] }
    if (tok) { if (MAP[tok][0] !== st) e.notes = `relay status ${st || 'none'} overridden by its VERDICT line (${tok})`; Object.assign(e, { status: MAP[tok][0], verdict: MAP[tok][1] }) }
    else if (st !== 'ABSENT') Object.assign(e, { status: 'INVALID', verdict: 'INVALID', notes: `relay reported ${st || 'no status'} without a VERDICT line (${vl.slice(0, 120)})` })
    return e
  }
  const e = await once(SEATX)
  const st = String(e.status).toUpperCase()
  // ruling R1: Sol gets ONE substitute attempt only on an ORDINARY gate whose Astra attempt ended timeout or error.
  // Never on auth, never when codex_reviews is disabled/off, never on quota/cooling (L3 cools lane-wide: Sol cannot run).
  // The trigger is the helper's own VERDICT reason (timeout | class_error | rejected), never the relay's class: a dead relay
  // or a failed worktree means Astra never ran, so there is nothing to substitute for.
  const why = (String(e.verdict_line || '').match(/VERDICT=(?:ABSENT|INVALID)\b.*\breason=(timeout|class_error|rejected)\b/) || [])[1]
  if (/astra/.test(SEATX) && GATE_CLASS === 'ordinary' && (st === 'ABSENT' || st === 'INVALID') && why) {
    incidents.push({ step: `r${round} seat X`, model: SEATX, status: st, class: e.class, substituted: 'gpt-6.1-sol' })
    const sub = await once('gpt-6.1-sol')
    sub.substituted = `astra->sol (${e.class})`
    sub.astra = { status: st, class: e.class, verdict_line: e.verdict_line || '' }
    const subSt = String(sub.status).toUpperCase()
    if (subSt !== 'PRESENT') incidents.push({ step: `r${round} seat X (sol)`, model: 'gpt-6.1-sol', status: sub.status, class: sub.class || 'error', reset_at: sub.reset_at || '' })
    // INVALID is sticky: only a PRESENT (valid, completed) Sol review resolves Astra's INVALID; an ABSENT Sol never launders it
    if (st === 'INVALID' && subSt !== 'PRESENT') return Object.assign(sub, { status: 'INVALID', verdict: 'INVALID', notes: `Astra INVALID (${e.class}) not resolved: the Sol substitute was ${subSt}; an ABSENT substitute never launders INVALID` })
    return sub
  }
  if (st !== 'PRESENT') incidents.push({ step: `r${round} seat X`, model: SEATX, status: st, class: e.class || 'error', reset_at: e.reset_at || '' })
  return e
}

function memberCtx(round, sha) { // only the reviewed SHA: no envelope (and so no path list) reaches the prompt
  return `Ship-unit ${UNIT} = ${IDS.join(', ') || 'see the briefs'}.${opt(A.gateFocus, f => ' ' + f)} Briefs: ${BRIEFS || B}. Worktree ${LANE} (branch ${BR}) at ${sha}, RANGE=${BASE}...${sha}. Gate round ${round}. Never commit; leave git -C ${LANE} status --porcelain empty.`
}

async function dockerMember(round, gs) { // retro-2026-10-19 item 3: Docker only when triggered
  const label = `r${round} docker`
  const p = `${memberCtx(round, gs.reviewed_sha)}
Docker verification (member=docker). ${A.dockerFocus || DOCKER_DEFAULT} Use the compose project name ab-${U}-r${round}; wait for busy ports up to 30 min; never stop or remove another project's containers. If the stack needs an untracked local env file, copy it from ${REPO} and delete it at the end. Tear down with down -v. Report ${R}/gate-${U}-r${round}-docker.md. Return the envelope (member=docker; status PRESENT when the verification ran to a result, ABSENT when docker itself was unavailable, with class; verdict PASS or FAIL; a failure is a [P1] line in p1).`
  let e = await ask(p, { label, phase: 'Gate', model: 'sonnet', effort: 'high', schema: GATE })
  if (!e) e = { status: 'ABSENT', verdict: 'ABSENT', class: await classify('sonnet', label, 'Gate'), notes: 'the docker member died; not a verification result' }
  return Object.assign({}, e, { member: 'docker' })
}

// retro-2026-10-19 item 3: mutation probe runs AFTER the parallel members, scoped per round
async function mutationMember(round, gs, mode, named, delta, deltaRange) {
  const label = `r${round} mutation`
  const probe = mode === 'full'
    ? 'Round probe per SECTION F: EVERY brief-named mutation target plus AT MOST 10 own mutants.'
    : (mode === 'brief'
      ? 'LITE probe: ONLY the brief-named mutation targets (no own mutants).'
      : `Scoped probe: ONLY these fix-named mutants ${J(named)} plus every brief-named mutant whose target file is in ${renderPaths(delta, { range: deltaRange })}. When that set is empty, return status PRESENT, verdict SKIPPED.`)
  const conc = mode === 'scoped'
    ? `Re-run a multi-connection / concurrency suite 5x only when a file in ${renderPaths(delta, { range: deltaRange })} has one.`
    : 'Run every multi-connection / concurrency suite the briefs name 5x on the unmutated tree; a flake is [P1].'
  const p = `${memberCtx(round, gs.reviewed_sha)}
Mutation probe (member=mutation) in ${LANE}. ${probe} ${conc}
For each mutant: apply exactly that temporary mutation through Bash (python3 or a heredoc), run its named test${PRIV(`${DB}_gate`, LANE)} and record killed yes/no; then restore every modified file from the index (every path single-quoted and literal: git -C ${LANE} --literal-pathspecs checkout -- '<path>', or git -C ${LANE} show ':<path>' > '<path>') and confirm git -C ${LANE} status --porcelain is empty before the next mutant. Never commit. Judge survivors by ${SECF} Report ${R}/gate-${U}-r${round}-mutation.md. Return the envelope (member=mutation; mutants[] with brief_named; final_clean yes/no; p1 only per SECTION F).`
  let e = await ask(p, { label, phase: 'Gate', model: 'sonnet', effort: 'high', schema: GATE })
  if (!e) e = { status: 'ABSENT', verdict: 'ABSENT', class: await classify('sonnet', label, 'Gate'), notes: 'the mutation member died; not a probe result' }
  return Object.assign({}, e, { member: 'mutation' })
}

// ---------- fix pass + scoped delta review ------------------------------------------------------------
const byName = xs => xs.filter((x, i) => x && x.name && xs.findIndex(y => y && y.name === x.name) === i)
function fixText(owner, tag, items, findings, named) {
  return `Fix ${tag} for ${UNIT}, owner ${owner}. Briefs: ${BRIEFS || B}. Findings: ${findings}. Fix exactly: ${J(items.map(f => ({ severity: f.severity, item: f.item, mutants: arr(f.mutants) })))}, each with a test that fails without the fix (where a finding names a mutant, re-run exactly that mutant: apply it through Bash, run its test, restore the file from the index, confirm git status --porcelain is empty). Re-run typecheck, lint and the affected tests. Named checks (each MUST appear in checks[] as {name, command, exit_code}; a missing or failing one fails the fix): ${J(named)}.`
}

// Owner-routed, sequential in the lane: Claude owners first, then Codex owners, the integration owner LAST.
// Routing follows the skill's "Fix rounds" row: the original author's lane chain (implChain); P2 fix-now = Haiku max
// unless a T2/T3 task owns it. Every fix job carries named checks (the finding's targeted tests + the owner's checks),
// so checkGap can fail it.
async function fixPass(fixes, tag, findings, ph) {
  const by = {}
  for (const f of fixes) { const o = OWNERS.includes(f.owner) ? f.owner : 'integration'; (by[o] = by[o] || []).push(f) }
  const rank = o => (o === 'integration' ? 2 : (byId[o] && byId[o].impl === 'claude') ? 0 : 1)
  const owners = Object.keys(by).sort((a, b) => rank(a) - rank(b))
  const where = { kind: 'lane', cwd: LANE }
  const out = {}
  for (const owner of owners) {
    const items = by[owner], t = byId[owner], hasP1 = items.some(f => f.severity === 'P1')
    const named = byName(items.flatMap(f => arr(f.checks)).concat(namedChecks(owner)))
    const job = { id: owner, tag, tier: t ? tierOf(t) : (hasP1 ? 'T2' : 'T1'), named, text: fixText(owner, tag, items, findings, named), report: `${R}/fix-${U}-${tag}-${safe(owner)}.md` }
    let env
    if (t && !isLow(t)) env = await runChain(job, where, '', implChain(t), ph) // T2/T3 owner: its tier row, P1 or P2
    else if (t && t.impl === 'codex' && hasP1) env = await runChain(job, where, '', [{ lane: 'l3', model: tierGuard(t).model || 'gpt-6.1-sol', effort: t.effort || 'high' }, { lane: 'l1', low: true, m: HAIKU }], ph)
    else if (t) env = await claudeImpl(job, where, '', HAIKU, '', ph) // v1.8 D-C: T0/T1 owner -> Haiku max
    else if (hasP1) env = await runChain(job, where, '', [{ lane: 'l1', model: 'claude-opus-5-5', effort: 'high' }, { lane: 'l2', model: 'claude-opus-5-5', effort: 'high' }, { lane: 'l3', model: 'gpt-6.1-sol', effort: 'high' }], ph) // integration owner row
    else env = await claudeImpl(job, where, '', HAIKU, '', ph)
    out[owner] = env
    if (!env || !/^DONE/.test(String(env.status || ''))) return { stop: { stopped: `fix ${tag} owner ${owner} not DONE${env && env.failure_class ? ` (${env.failure_class})` : ''}`, fix: env, failure_class: env && env.failure_class } }
    const gap = checkGap(job, env) // after any escalation: an unverified fix never counts as DONE
    if (gap) return { stop: { stopped: `fix ${tag} owner ${owner} not verified: ${gap}`, fix: env, failure_class: 'check' } }
  }
  return { out }
}

// Rote inventory: HEAD (full SHA) + files changed since `from`. null when unreadable (callers fail closed).
async function headFiles(label, from, ph, extra) {
  const r = await ask(`Rote: return head = git -C ${LANE} rev-parse HEAD (full SHA) and files = git -C ${LANE} diff --name-only ${from}..HEAD (one path per entry; [] when none).${extra || ''}`, { label, phase: ph || curPhase, model: 'haiku', effort: 'low', schema: FILES })
  if (!r || !SHA_RE.test(String(r.head || '')) || !Array.isArray(r.files)) return null
  const rb = badPaths(r, ['files'], `${label} inventory`)
  if (rb) return { bad: rb }
  return r
}

// retro-2026-10-19 item 1: ONE Claude seat over the fix delta + the mutants the fixes name; not a round.
// Both range ends are literal SHAs (never a moving ref); the review must report reviewed_sha == toSha.
async function deltaReview(tag, fromSha, toSha, mutants, findings, why, rerun, scope) {
  const p = `Scoped delta review (one Claude seat; ${why}) for ${UNIT}: RANGE=${fromSha}..${toSha} in ${LANE} (branch ${BR}); diff exactly this range, never HEAD; reviewed_sha = ${toSha}.${scope ? ` Review ONLY the changes to these paths: ${scopeText(scope, fromSha, toSha)} The rest of the range is upstream code merged from the base branch, already reviewed there.` : ''}${opt(A.deltaKnown, k => ' ' + k)}${rerun ? ' A previous attempt at this review was incomplete: complete it now.' : ''} Already adjudicated in this unit (do not re-file without new facts): read ${RULINGS} first. Review ONLY this delta against what it claims to fix (${findings}) and the briefs (${BRIEFS || B}): each change does what was asked, carries a test that fails without it where it changes behaviour, and introduces no new defect. Re-run exactly these mutants: ${J(mutants)} — apply each through Bash, run its named test${PRIV(`${DB}_delta`, LANE)}, restore the file from the index, confirm git -C ${LANE} status --porcelain is empty at the end; a mutant a fix claimed to kill that survives is [P1]. Never edit anything else; never commit. ${SEV} Append the claims you adjudicate to ${RULINGS} (temp file + mv; keep every existing entry; entry shape {claim_id, disposition, reason, round: ${J(tag)}, member: "delta"}). Write ${R}/gate-${U}-${tag}-delta.md. Return the envelope: verdict PASS only when you COMPLETED the review and keep no [P1]; verdict FAIL with every kept [P1] in p1 (and owner-routed fixes, owner in ${J(OWNERS)}, each with the checks that verify it) when you keep one; if you could not complete the review, verdict FAIL with p1 EMPTY and the reason in notes. p2 = the remaining [P2] findings.`
  return callChain(`${tag} delta review`, synChain(A.deltaModel || synFirst(1, 1)), p, { label: `${tag} delta review${rerun ? ' (re-run)' : ''}`, phase: curPhase, effort: 'high', schema: DR })
}
// the review scope in a prompt: plain paths verbatim (JSON); a credential-shaped path only by its <path:ID>, with the
// local command that resolves IDs to names (git hash-object of each changed path), so its text is never relayed
// Paths reach git as LITERAL pathspecs, each single-quoted (safe: PATH_OK rejects ').
function scopeText(scope, fromSha, toSha) {
  const plain = scope.filter(f => !pathSecret(f)), held = scope.filter(pathSecret)
  const lit = `git -C ${LANE} --literal-pathspecs diff ${fromSha}..${toSha} --`
  const diff = plain.length ? ` Diff exactly these paths as literal pathspecs, each single-quoted (a [name] is NOT a glob here): ${lit} ${shellPaths(plain)}.` : ''
  if (!held.length) return `${renderPaths(scope)}.${diff}`
  const hid = pathIdList(held)
  return `${renderPaths(plain)} plus ${held.length} credential-shaped path(s) withheld from this prompt, by id: ${hid.text}. Resolve them locally with: ${pathResolver(`${fromSha}..${toSha}`, hid.n)} (review those paths too, diffing each the same literal way: ${lit} '<path>'; refer to them only by id in everything you write).${diff}`
}
// ruling R4: PASS needs an explicit PASS, zero [P1] and the expected reviewed_sha; [P1]s are P1; anything else is INCOMPLETE
function deltaOutcome(r, toSha) {
  if (arr(r.p1).length) return 'P1'
  if (r.verdict === 'PASS' && String(r.reviewed_sha || '') === toSha) return 'PASS'
  return 'INCOMPLETE'
}
// An incomplete delta review is re-run ONCE; incomplete twice -> the caller BLOCKs (never a pass, never a P1).
async function deltaChecked(tag, fromSha, toSha, mutants, findings, why, scope) {
  let d = await deltaReview(tag, fromSha, toSha, mutants, findings, why, false, scope)
  if (!d.r) return { outcome: 'FAILED', class: d.class }
  let o = deltaOutcome(d.r, toSha)
  if (o === 'INCOMPLETE') {
    incidents.push({ step: `${tag} delta review`, class: 'incomplete', note: `verdict ${d.r.verdict}, reviewed_sha ${d.r.reviewed_sha || 'none'} (expected ${toSha}): ${d.r.notes || ''}`.slice(0, 300) })
    d = await deltaReview(tag, fromSha, toSha, mutants, findings, why, true, scope)
    if (!d.r) return { outcome: 'FAILED', class: d.class }
    o = deltaOutcome(d.r, toSha)
  }
  return { outcome: o, r: d.r, class: d.class }
}

// retro-2026-10-19 item 8: CHANGELOG fact-check by Haiku max (v1.8 D-C), escalation Sonnet; before CI.
// Callers require verdict CLEAN (ruling R4). A non-amend fold commits through gstack-lane's guard (ruling R9);
// an amend is covered by the pre-push guard scan.
async function factCheck(tag, fromSha, amend) {
  const fold = amend
    ? `fold the corrections into the not-yet-pushed ship commit: git -C ${LANE} --literal-pathspecs commit --amend --no-edit --only -- '<doc path>' ... (each path single-quoted; literal pathspecs, so a [name] is never a glob)`
    : `commit them via ${GL} commit --cwd ${LANE} --base ${fromSha} -m "docs: make the ${UNIT} notes exact" (message ending with the trailer line "${TRAILER}"; a secret_path= / filter_path= refusal = verdict FAIL)`
  const p = `CHANGELOG / docs fact-check for ${UNIT} (one pass, claim by claim). In ${LANE} (branch ${BR}) at HEAD: read the CHANGELOG entry and every docs/README line changed in ${fromSha}..HEAD, plus any docs line this unit made stale; check each claim against the code at HEAD (cite file:line). VERSION, the package version and the CHANGELOG heading agree. Correct every INACCURATE claim in place (prose only; never touch code), then ${fold}. Prose is never [P1]: p1 stays empty. checks[] = one {name: "claim <n>", command: "<file:line you checked>", exit_code: 0 accurate as written, 1 corrected}. Return the envelope (verdict CLEAN once every claim is accurate or corrected, FAIL only if you could not finish; doc_fixes = the corrections applied; members "factcheck").`
  const c = await callChain(`${tag} fact-check`, ['haiku', 'sonnet'], p, { label: `${tag} CHANGELOG fact-check`, phase: curPhase, effort: 'max', schema: DC })
  if (c.r && c.r.verdict === 'CLEAN') return c
  if (c.r && c.model === 'haiku') { // escalate once to Sonnet (v1.8 D-C table)
    const s = await ask(p, { label: `${tag} CHANGELOG fact-check (sonnet escalation)`, phase: curPhase, model: 'sonnet', effort: 'high', schema: DC })
    if (s) return { r: s, model: 'sonnet', class: '' }
  }
  return c
}

// CI is bound to the EXACT pushed SHA (ruling R4): READY only for runs on that head with the PR head unchanged.
// ---------- repository identity, push, and API verification (ship + PATCH) -------------------------------
// The identity comes from the lane's OWN git remotes and is validated IN-SHELL (ID_SH): the remote URLs are read into
// shell variables / a private temp file (removed on EXIT, HUP, INT, TERM) and NEVER printed, so no agent ever sees a raw
// URL or its userinfo; the block prints only "ID <role> ok <host>/<owner>/<repo> scheme= user= port=" or
// "ID <role> fail scheme= host_ok= reason=". Rules: host ^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$ (lowercased), owner / repo
// ^[A-Za-z0-9_.-]+$ ('.' / '..' rejected, .git stripped); http(s)/git:// URLs with userinfo (credentials) or a port are
// rejected; ssh:// / scp-form may carry a plain user (not starting with '-') and ssh:// a numeric port; whitespace,
// control characters, empty entries and anything else are rejected. The push URL list of
// `git remote get-url --push --all origin` (pushurl / pushInsteadOf / insteadOf applied) is kept VERBATIM, one entry
// per line, empty entries included, and must hold EXACTLY ONE valid https / ssh / scp entry naming the same
// host/owner/repo. RULE: a remote whose only usable push URL embeds credentials is BLOCKED (userinfo is never accepted).
// GH_REPO / GH_HOST in the environment can redirect a directory-scoped gh call, so every gh call runs as GHX with an
// explicit, single-quoted repository (host ALWAYS included, github.com too):
//   gh pr / run / release / workflow ... --repo '<host/owner/repo>';  gh repo view '<host/owner/repo>' (positional);
//   gh api --hostname '<host>' repos/<owner>/<repo>/...
const GHX = 'env -u GH_REPO -u GH_HOST gh'
const HOST_RE = /^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$/, NAME_RE = /^[A-Za-z0-9_.-]+$/
// a single-quoted shell word (paths are also validated against SAFE_PATH in main; this is defence in depth)
const shq = x => `'${String(x).replace(/'/g, `'\\''`)}'`
// '@{' stands for '${' inside the shell blocks (a JS template literal cannot hold '${' verbatim)
const ID_SH = String.raw`# Repository identity, validated IN-SHELL: remote URLs are read into variables / a private temp file and never printed.
# Output (only): "ID <role> ok <host>/<owner>/<repo> scheme=<s> user=<u> port=<p>" or "ID <role> fail scheme=<s> host_ok=<0|1> reason=<code>",
# "PUSH_N <n>", or "ERROR <code>". Inputs (env, always read as "$VAR"): R (run repo dir), L (lane dir).
unset GIT_DIR GIT_WORK_TREE GIT_COMMON_DIR GIT_INDEX_FILE GIT_OBJECT_DIRECTORY GIT_ALTERNATE_OBJECT_DIRECTORIES GIT_NAMESPACE
lc() { printf '%s' "$1" | tr 'A-Z' 'a-z'; }
parse_url() { # $1 = url -> sets P_* ; returns 0 when valid
  local u="$1" auth path
  P_SCHEME=unknown; P_HOSTOK=0; P_REASON=""; P_ID=""; P_USER=""; P_PORT=""; P_HOST=""
  if [ -z "$u" ] || [[ "$u" =~ ^[[:space:]]+$ ]]; then P_SCHEME=none; P_REASON=empty; return 1; fi
  if [[ "$u" =~ [[:space:][:cntrl:]] ]]; then P_REASON=whitespace_or_control; return 1; fi
  if [[ "$u" =~ ^([A-Za-z][A-Za-z0-9+.-]*)://([^/]*)/(.*)$ ]]; then
    P_SCHEME=$(lc "@{BASH_REMATCH[1]}"); auth="@{BASH_REMATCH[2]}"; path="@{BASH_REMATCH[3]}"
    case "$P_SCHEME" in
      http|https|git)
        if [[ "$auth" == *@* ]]; then P_REASON=userinfo; P_HOST="@{auth##*@}"
        elif [[ "$auth" == *:* ]]; then P_REASON=port; P_HOST="@{auth%%:*}"
        else P_HOST="$auth"; fi ;;
      ssh)
        if [[ "$auth" =~ ^(([A-Za-z0-9_][A-Za-z0-9_.-]*)@)?([^@:/]+)(:([0-9]{1,5}))?$ ]]; then P_USER="@{BASH_REMATCH[2]}"; P_HOST="@{BASH_REMATCH[3]}"; P_PORT="@{BASH_REMATCH[5]}"
        else P_REASON=bad_authority; P_HOST="@{auth##*@}"; P_HOST="@{P_HOST%%:*}"; fi ;;
      *) P_REASON=unsupported_scheme ;;
    esac
  elif [[ "$u" =~ ^(([A-Za-z0-9_][A-Za-z0-9_.-]*)@)?([^@:/-][^@:/]*):(.*)$ ]]; then
    P_SCHEME=scp; P_USER="@{BASH_REMATCH[2]}"; P_HOST="@{BASH_REMATCH[3]}"; path="@{BASH_REMATCH[4]}"
  else P_REASON=unsupported_form; return 1; fi
  # the host is NEVER rewritten: it is printed as-is and compared case-insensitively by the script (DNS names are)
  [[ "$P_HOST" =~ ^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$ ]] && P_HOSTOK=1
  [ -n "$P_REASON" ] && return 1
  [ "$P_HOSTOK" = 1 ] || { P_REASON=invalid_host; return 1; }
  path="@{path%/}"; path="@{path%.git}"
  if [[ "$path" =~ ^([A-Za-z0-9_.-]+)/([A-Za-z0-9_.-]+)$ ]] && [ "@{BASH_REMATCH[1]}" != . ] && [ "@{BASH_REMATCH[1]}" != .. ] && [ "@{BASH_REMATCH[2]}" != . ] && [ "@{BASH_REMATCH[2]}" != .. ]; then
    P_ID="$P_HOST/@{BASH_REMATCH[1]}/@{BASH_REMATCH[2]}"; return 0
  fi
  P_REASON=invalid_path; return 1
}
emit() { # $1 = role, $2 = url
  if parse_url "$2"; then echo "ID $1 ok $P_ID scheme=$P_SCHEME user=$P_USER port=$P_PORT"
  else echo "ID $1 fail scheme=$P_SCHEME host_ok=$P_HOSTOK reason=$P_REASON"; fi
}
T=$(mktemp -d "@{TMPDIR:-/tmp}/abu-id.XXXXXX") || { echo "ERROR mktemp"; exit 0; }
# the temp file holds raw push URLs: removed on every exit path, signals included
trap 'rm -rf "$T"' EXIT
trap 'rm -rf "$T"; exit 1' HUP INT TERM
if U=$(git -C "$R" remote get-url origin 2>/dev/null); then emit repo "$U"; else echo "ID repo fail scheme=none host_ok=0 reason=git_error"; fi
if U=$(git -C "$L" remote get-url origin 2>/dev/null); then emit lane "$U"; else echo "ID lane fail scheme=none host_ok=0 reason=git_error"; fi
U=""
# push URLs verbatim, one per line, EMPTY entries kept (never trimmed or dropped)
if git -C "$L" remote get-url --push --all origin > "$T/push" 2>/dev/null; then
  n=0; while IFS= read -r line || [ -n "$line" ]; do n=$((n + 1)); emit "push$n" "$line"; done < "$T/push"
  echo "PUSH_N $n"
else echo "ID push1 fail scheme=none host_ok=0 reason=git_error"; echo "PUSH_N 0"; fi
rm -rf "$T"`.split('@{').join('${')
// THREAT MODEL of the push (orchestrator ruling, round 13): same-user tampering with git config or the environment
// (remote.origin.pushurl, url.*.insteadOf, credential helpers, GIT_* / ssh variables) is OUT of scope: a same-user
// process can already read everything the push would send, and isolating git from its own user is unwinnable. So the
// push is a plain `git push origin <sha>:refs/heads/<branch>` from the lane (PUSH_SH), preceded by the fail-fast,
// URL-blind identity check of the push URLs, and its OUTCOME is verified through an independent channel: the forge
// API (API_SH: GHX api --hostname <host> repos/<owner>/<repo>/git/ref/heads/<branch>) must report the pushed SHA
// for the validated repository, and the PR identity check (gh pr view --repo) must agree, before any READY. Never
// verified over git / ssh (a redirect could fool both). Residual: a redirected push could deliver the branch content to
// another repository, which grants nothing a same-user process cannot already read; it can never produce a false READY.
const API_SH = String.raw`# Forge API check of the pushed branch, URL-blind: stderr is captured privately (it can carry URLs) and only an
# allowlisted reason code is printed. Inputs (env, read as "$VAR"): H (host), OW (owner), RP (repo), B (branch).
# Prints only "API exit=<n> ref=<ok|mismatch|none> sha=<40-hex|none> reason=<ok|api_error:<code>|mismatch_ref|mismatch_url|empty|parse>".
set -u
E=$(mktemp "@{TMPDIR:-/tmp}/abu-api.XXXXXX") || { echo "API exit=9 ref=none sha=none reason=api_error:tmp"; exit 0; }
trap 'rm -f "$E"' EXIT
trap 'rm -f "$E"; exit 1' HUP INT TERM
O=$(env -u GH_REPO -u GH_HOST gh api --hostname "$H" "repos/$OW/$RP/git/ref/heads/$B" --jq '[.ref, .object.type, .object.sha, .url] | @tsv' 2>"$E"); rc=$?
if [ "$rc" != 0 ]; then
  if grep -q 'HTTP 404' "$E"; then c=http_404; elif grep -q 'HTTP 401' "$E"; then c=http_401; elif grep -q 'HTTP 403' "$E"; then c=http_403
  elif grep -q -E 'HTTP 5[0-9][0-9]' "$E"; then c=http_5xx; elif grep -q -i -E 'could not resolve|connection|timeout|dial tcp|no such host|network' "$E"; then c=network
  elif grep -q -i -E 'authenticat|gh auth login' "$E"; then c=auth; else c=other; fi
  echo "API exit=$rc ref=none sha=none reason=api_error:$c"; exit 0
fi
[ -n "$O" ] || { echo "API exit=0 ref=none sha=none reason=empty"; exit 0; }
IFS=$'\t' read -r REF TYP SHA URL <<< "$O"
case "$SHA" in *[!0-9a-f]*|'') echo "API exit=0 ref=none sha=none reason=parse"; exit 0 ;; esac
[ "@{#SHA}" = 40 ] || { echo "API exit=0 ref=none sha=none reason=parse"; exit 0; }
[ "$REF" = "refs/heads/$B" ] && [ "$TYP" = commit ] || { echo "API exit=0 ref=mismatch sha=$SHA reason=mismatch_ref"; exit 0; }
# the branch suffix EXACTLY (git refs are case-sensitive); host / owner / repo case-insensitively (as GitHub treats them)
SUF="/git/refs/heads/$B"
case "$URL" in *"$SUF") PRE="@{URL%"$SUF"}" ;; *) echo "API exit=0 ref=mismatch sha=$SHA reason=mismatch_url"; exit 0 ;; esac
if [ "$(printf '%s' "$H" | tr 'A-Z' 'a-z')" = github.com ]; then W="https://api.github.com/repos/$OW/$RP"; else W="https://$H/api/v3/repos/$OW/$RP"; fi
[ "$(printf '%s' "$PRE" | tr 'A-Z' 'a-z')" = "$(printf '%s' "$W" | tr 'A-Z' 'a-z')" ] || { echo "API exit=0 ref=mismatch sha=$SHA reason=mismatch_url"; exit 0; }
echo "API exit=0 ref=ok sha=$SHA reason=ok"`.split('@{').join('${')
// The remaining network calls of the ship / PATCH paths run as URL-blind blocks too: private stderr, allowlisted codes.
const PRV_SH = String.raw`# PR identity, URL-blind: gh stderr is captured privately and only an allowlisted code is printed; every field is
# validated against its allowlist and printed verbatim, or rejected (never rewritten). Inputs (env, read as "$VAR"):
# N (PR number), X (host/owner/repo). Prints only "PR exit=0 number=<n> state=<S> cross=<true|false>
# head_repo=<owner/repo> head_ref=<branch> head=<sha>" or "PR exit=<n> reason=<api_error:<code>|invalid_field:<name>>".
set -u
E=$(mktemp "@{TMPDIR:-/tmp}/abu-pr.XXXXXX") || { echo "PR exit=9 reason=api_error:tmp"; exit 0; }
trap 'rm -f "$E"' EXIT
trap 'rm -f "$E"; exit 1' HUP INT TERM
# shared: classify a private stderr file into an allowlisted code (never printed raw)
ecode() { if grep -q 'HTTP 404' "$1"; then echo http_404; elif grep -q 'HTTP 401' "$1"; then echo http_401; elif grep -q 'HTTP 403' "$1"; then echo http_403
  elif grep -q -E 'HTTP 5[0-9][0-9]' "$1"; then echo http_5xx; elif grep -q -i -E 'could not resolve|connection|timeout|dial tcp|no such host|network' "$1"; then echo network
  elif grep -q -i -E 'authenticat|gh auth login|permission denied' "$1"; then echo auth; else echo other; fi; }
PFX="PR exit=0"
# an identity field is compared EXACTLY downstream: it is never rewritten; a value outside its allowlist is rejected
chk() { if [ -z "$2" ] || ! [[ "$2" =~ $3 ]]; then echo "$PFX reason=invalid_field:$1"; exit 0; fi; }
S='[.number, .state, .isCrossRepository, (.headRepositoryOwner.login + "/" + .headRepository.name), .headRefName, .headRefOid] | map(tostring) | @tsv'
O=$(env -u GH_REPO -u GH_HOST gh pr view "$N" --repo "$X" --json number,state,isCrossRepository,headRepository,headRepositoryOwner,headRefName,headRefOid --jq "$S" 2>"$E"); rc=$?
[ "$rc" = 0 ] || { echo "PR exit=$rc reason=api_error:$(ecode "$E")"; exit 0; }
IFS=$'\t' read -r PN PS PC PH PR PO <<< "$O"
chk number "$PN" '^[0-9]{1,9}$'; chk state "$PS" '^[A-Z_]{1,20}$'; chk cross "$PC" '^(true|false)$'
chk head_repo "$PH" '^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$'; chk head_ref "$PR" '^[A-Za-z0-9._/-]{1,255}$'; chk head "$PO" '^[0-9a-f]{40}$'
echo "PR exit=0 number=$PN state=$PS cross=$PC head_repo=$PH head_ref=$PR head=$PO"`.split('@{').join('${')
const PSETUP_SH = String.raw`# PATCH setup, URL-blind: every network command (gh, git fetch) has its stderr captured privately; only allowlisted
# codes are printed. Inputs (env, read as "$VAR"): RUN, K (unit key), N (PR number), X (host/owner/repo), L (lane),
# B (branch). Prints only "SETUP <key>=<value> ..." (recorded_pr recorded_branch state cross head_repo head_ref head
# remote_head reason); every field is validated and printed verbatim, or rejected (invalid_field:<name>), never rewritten.
set -u
unset GIT_DIR GIT_WORK_TREE GIT_COMMON_DIR GIT_INDEX_FILE GIT_OBJECT_DIRECTORY GIT_ALTERNATE_OBJECT_DIRECTORIES GIT_NAMESPACE
E=$(mktemp "@{TMPDIR:-/tmp}/abu-setup.XXXXXX") || { echo "SETUP reason=api_error:tmp"; exit 0; }
trap 'rm -f "$E"' EXIT
trap 'rm -f "$E"; exit 1' HUP INT TERM
# shared: classify a private stderr file into an allowlisted code (never printed raw)
ecode() { if grep -q 'HTTP 404' "$1"; then echo http_404; elif grep -q 'HTTP 401' "$1"; then echo http_401; elif grep -q 'HTTP 403' "$1"; then echo http_403
  elif grep -q -E 'HTTP 5[0-9][0-9]' "$1"; then echo http_5xx; elif grep -q -i -E 'could not resolve|connection|timeout|dial tcp|no such host|network' "$1"; then echo network
  elif grep -q -i -E 'authenticat|gh auth login|permission denied' "$1"; then echo auth; else echo other; fi; }
PFX="SETUP"
# an identity field is compared EXACTLY downstream: it is never rewritten; a value outside its allowlist is rejected
chk() { if [ -z "$2" ] || ! [[ "$2" =~ $3 ]]; then echo "$PFX reason=invalid_field:$1"; exit 0; fi; }
rec() { for f in "$RUN/state.json" "$RUN/state.final.json"; do v=$(jq -r --arg k "$K" "$1" "$f" 2>/dev/null) && [ -n "$v" ] && [ "$v" != null ] && [ "$v" != 0 ] && { printf '%s' "$v"; return; }; done; printf '%s' "$2"; }
RP=$(rec '.prs[$k].pr // 0' 0); RB=$(rec '.prs[$k].branch // ""' none)
chk recorded_pr "$RP" '^[0-9]{1,9}$'; chk recorded_branch "$RB" '^[A-Za-z0-9._/-]{1,255}$'
S='[.state, .isCrossRepository, (.headRepositoryOwner.login + "/" + .headRepository.name), .headRefName] | map(tostring) | @tsv'
O=$(env -u GH_REPO -u GH_HOST gh pr view "$N" --repo "$X" --json state,isCrossRepository,headRepository,headRepositoryOwner,headRefName --jq "$S" 2>"$E"); rc=$?
[ "$rc" = 0 ] || { echo "SETUP recorded_pr=$RP recorded_branch=$RB reason=api_error:$(ecode "$E")"; exit 0; }
IFS=$'\t' read -r PS PC PH PR <<< "$O"
chk state "$PS" '^[A-Z_]{1,20}$'; chk cross "$PC" '^(true|false)$'; chk head_repo "$PH" '^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$'; chk head_ref "$PR" '^[A-Za-z0-9._/-]{1,255}$'
P="SETUP recorded_pr=$RP recorded_branch=$RB state=$PS cross=$PC head_repo=$PH head_ref=$PR"
[ "$(git -C "$L" rev-parse --abbrev-ref HEAD 2>/dev/null)" = "$B" ] || { echo "$P head=none remote_head=none reason=wrong_branch"; exit 0; }
[ -z "$(git -C "$L" status --porcelain 2>/dev/null)" ] || { echo "$P head=none remote_head=none reason=dirty"; exit 0; }
git -C "$L" fetch --quiet origin "$B" >/dev/null 2>"$E" || { echo "$P head=none remote_head=none reason=fetch_error:$(ecode "$E")"; exit 0; }
git -C "$L" merge --quiet --ff-only "origin/$B" >/dev/null 2>&1 || { echo "$P head=none remote_head=none reason=not_ff"; exit 0; }
H=$(git -C "$L" rev-parse HEAD 2>/dev/null); RH=$(git -C "$L" rev-parse "origin/$B" 2>/dev/null)
echo "$P head=@{H:-none} remote_head=@{RH:-none} reason=ok"`.split('@{').join('${')
const CI_SH = String.raw`# CI wait for exactly one head, URL-blind and bounded. NO free text is relayed: no check names, no logs; only
# allowlisted codes and integer counts. gh stderr is captured privately; every gh call runs under the REMAINING
# deadline with kill escalation: TERM at the deadline, KILL G seconds later, to the call's whole process group
# (timeout -k / gtimeout -k, else a perl watchdog doing the same), so a stalled or TERM-resistant call cannot outlive
# TOTAL + G. A TERM to this watcher (the outer cleanup) is forwarded to the running call the same way before exit.
# Inputs (env, read as "$VAR"):
# N (PR number), X (host/owner/repo), H (expected head), APPEAR (s), TOTAL (s), POLL (s, default 30). Prints only
# "CI status=<READY|BLOCKED> head=<sha|none|invalid> reason=<code> pass=<n> fail=<n> pending=<n>" with code one of
# ci:pass ci:none ci:fail ci:pending ci:timeout head_moved not_mergeable api_error:<code>.
set -u
E=$(mktemp "@{TMPDIR:-/tmp}/abu-ci.XXXXXX") || { echo "CI status=BLOCKED head=none reason=api_error:tmp pass=0 fail=0 pending=0"; exit 0; }
F="$E.out"; G=5; TP=
# the running call (TP) is stopped with the same TERM -> G -> KILL escalation (both helpers do it on TERM), then reaped;
# sweep() then KILLs what is left of a timeout/gtimeout call's own process group (pgid == TP): a TERM-ignoring
# grandchild of a gh that did exit. The group id stays reserved while any member lives, so it names only that group.
sweep() { kill -KILL -- "-$1" 2>/dev/null; }
stop() { [ -n "$TP" ] && { kill -TERM "$TP" 2>/dev/null; wait "$TP" 2>/dev/null; sweep "$TP"; }; rm -f "$E" "$F"; }
trap 'rm -f "$E" "$F"' EXIT
trap 'stop; exit 1' HUP INT TERM
# shared: classify a private stderr file into an allowlisted code (never printed raw)
ecode() { if grep -q 'HTTP 404' "$1"; then echo http_404; elif grep -q 'HTTP 401' "$1"; then echo http_401; elif grep -q 'HTTP 403' "$1"; then echo http_403
  elif grep -q -E 'HTTP 5[0-9][0-9]' "$1"; then echo http_5xx; elif grep -q -i -E 'could not resolve|connection|timeout|dial tcp|no such host|network' "$1"; then echo network
  elif grep -q -i -E 'authenticat|gh auth login|permission denied' "$1"; then echo auth; else echo other; fi; }
# tmo runs in a background subshell and EXECs the helper, so TP is the helper itself (never a wrapper shell)
tmo() { local t="$1"; shift
  if command -v timeout >/dev/null 2>&1; then exec timeout -k "$G" "$t" "$@"; elif command -v gtimeout >/dev/null 2>&1; then exec gtimeout -k "$G" "$t" "$@"
  else exec perl -MPOSIX=:sys_wait_h -e '($t, $g) = splice(@ARGV, 0, 2); defined($p = fork) or exit 125; if (!$p) { setpgrp(0, 0); exec @ARGV or exit 127 }
    $k = sub { $SIG{$_} = "IGNORE" for qw(ALRM TERM HUP INT); kill "TERM", -$p; for (1 .. 10 * $g) { last if waitpid($p, WNOHANG) > 0; select(undef, undef, undef, 0.1) } kill "KILL", -$p; waitpid($p, 0); exit 124 };
    $SIG{$_} = $k for qw(ALRM TERM HUP INT); alarm $t; waitpid($p, 0); $s = $?; alarm 0; kill "KILL", -$p; exit(($s & 127) ? 128 + ($s & 127) : $s >> 8)' "$t" "$G" "$@"; fi; }
START=$(date +%s); P=@{POLL:-30}
S='[.headRefOid, .mergeable, .mergeStateStatus, ([.statusCheckRollup[]? | if .__typename == "CheckRun" then (if .status != "COMPLETED" then "PENDING" else (.conclusion // "PENDING") end) else (.state // "PENDING") end | if . == "SUCCESS" or . == "SKIPPED" or . == "NEUTRAL" then "pass" elif . == "PENDING" or . == "EXPECTED" or . == "QUEUED" or . == "IN_PROGRESS" or . == "WAITING" or . == "REQUESTED" then "pending" else "fail" end] | ((map(select(. == "pass")) | length), (map(select(. == "fail")) | length), (map(select(. == "pending")) | length)))] | map(tostring) | @tsv'
out() { echo "CI status=$1 head=$2 reason=$3 pass=@{4:-0} fail=@{5:-0} pending=@{6:-0}"; exit 0; }
while :; do
  EL=$(( $(date +%s) - START )); LEFT=$(( TOTAL - EL ))
  [ "$LEFT" -gt 0 ] || out BLOCKED none ci:timeout
  # in the background + wait, so a TERM to this watcher runs stop() at once (bash defers traps behind a foreground child)
  tmo "$LEFT" env -u GH_REPO -u GH_HOST gh pr view "$N" --repo "$X" --json headRefOid,mergeable,mergeStateStatus,statusCheckRollup --jq "$S" > "$F" 2>"$E" & TP=$!
  { wait "$TP"; } 2>/dev/null; rc=$?; sweep "$TP"; TP=; O=$(cat "$F" 2>/dev/null)
  case "$rc" in 124|137|142) out BLOCKED none ci:timeout ;; esac
  [ "$rc" = 0 ] || out BLOCKED none "api_error:$(ecode "$E")"
  IFS=$'\t' read -r HD MG MS NP NF NQ <<< "$O"
  [[ "$HD" =~ ^[0-9a-f]{40}$ ]] || out BLOCKED invalid head_moved
  [[ "$NP$NF$NQ" =~ ^[0-9]+$ ]] || out BLOCKED "$HD" api_error:parse
  [ "$HD" = "$H" ] || out BLOCKED "$HD" head_moved "$NP" "$NF" "$NQ"
  [ "$NF" = 0 ] || out BLOCKED "$HD" ci:fail "$NP" "$NF" "$NQ"
  MOK=0; [ "$MG" = MERGEABLE ] && { [ "$MS" = CLEAN ] || [ "$MS" = HAS_HOOKS ]; } && MOK=1
  if [ "$NQ" = 0 ] && [ "$NP" != 0 ]; then [ "$MOK" = 1 ] && out READY "$HD" ci:pass "$NP" 0 0; out BLOCKED "$HD" not_mergeable "$NP" 0 0; fi
  if [ "$NP$NQ" = 00 ] && [ "$EL" -ge "$APPEAR" ]; then [ "$MOK" = 1 ] && out READY "$HD" ci:none 0 0 0; out BLOCKED "$HD" not_mergeable 0 0 0; fi
  EL=$(( $(date +%s) - START )); [ "$EL" -ge "$TOTAL" ] && out BLOCKED "$HD" ci:timeout "$NP" "$NF" "$NQ"
  W=$P; [ $(( TOTAL - EL )) -lt "$W" ] && W=$(( TOTAL - EL )); sleep "$W"
done`.split('@{').join('${')
const PUSH_SH = String.raw`# Plain push of exactly the validated SHA from the lane to its origin (the fail-fast identity check ran first; the
# outcome is then verified through the forge API). Inputs (env, always read as "$VAR"): L (lane), S (full SHA),
# B (branch). Prints only "PUSH exit=<n> local=<sha|none> reason=<code>"; git output is discarded (it can echo a URL).
set -u
unset GIT_DIR GIT_WORK_TREE GIT_COMMON_DIR GIT_INDEX_FILE GIT_OBJECT_DIRECTORY GIT_ALTERNATE_OBJECT_DIRECTORIES GIT_NAMESPACE
git check-ref-format --branch "$B" >/dev/null 2>&1 || { echo "PUSH exit=6 local=none reason=bad_branch"; exit 0; }
[ "$(git -C "$L" rev-parse HEAD 2>/dev/null)" = "$S" ] || { echo "PUSH exit=3 local=none reason=head_moved"; exit 0; }
git -C "$L" push --quiet origin "$S:refs/heads/$B" >/dev/null 2>&1; rc=$?
echo "PUSH exit=$rc local=$S reason=$([ $rc = 0 ] && echo ok || echo push_failed)"`.split('@{').join('${')
const IDL = { type: 'object', properties: { lines: STRS }, required: ['lines'] }
const ID_OK = /^ID (\S+) ok ([A-Za-z0-9.-]+)\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+) scheme=(https|http|git|ssh|scp) user=((?:[A-Za-z0-9_][A-Za-z0-9_.-]*)?) port=([0-9]{0,5})$/
const ID_FAIL = /^ID (\S+) fail scheme=([a-z0-9+.-]+) host_ok=([01]) reason=([a-z_]+)$/
function idOf(lines, role) {
  const l = lines.find(x => String(x).startsWith(`ID ${role} `))
  if (!l) return { fail: `no ${role} identity line` }
  const ok = String(l).match(ID_OK)
  if (ok && ok[1] === role && HOST_RE.test(ok[2]) && ![ok[3], ok[4]].some(n => !NAME_RE.test(n) || n === '.' || n === '..')) {
    // host / owner / repo are case-insensitive (DNS, GitHub): lowercased ONLY for comparisons and the --repo / --hostname /
    // API-path arguments (lc*); no other transformation. Branches and SHAs are always compared exactly.
    return { host: ok[2], owner: ok[3], repo: ok[4], slug: `${ok[3]}/${ok[4]}`, arg: `${ok[2]}/${ok[3]}/${ok[4]}`.toLowerCase(), lcHost: ok[2].toLowerCase(), lcOwner: ok[3].toLowerCase(), lcRepo: ok[4].toLowerCase(), scheme: ok[5], user: ok[6], port: ok[7] }
  }
  const f = String(l).match(ID_FAIL)
  return { fail: f ? `scheme ${f[2]}, host ${f[3] === '1' ? 'valid' : 'invalid'}, reason ${f[4]}` : `unrecognized ${role} identity line` }
}
const sameId = (x, y) => x.arg === y.arg // host/owner/repo case-insensitive (already lowercased in arg); nothing else folded
// the gh rule every dispatch on the ship / PATCH paths gets (no bare gh anywhere)
const ghRule = rid => `Run every gh command as ${GHX} (never a bare gh): gh pr / run / release / workflow subcommands with --repo '${rid.arg}'; gh repo view with the repository positional ('${rid.arg}', never --repo); gh api with --hostname '${rid.host}' and repos/${rid.slug}/... paths (never --repo). Run every gh and every network git command (fetch, pull, push, ls-remote) with its stderr redirected to a private temp file (2>file) and report only an error code (http_404, http_401, http_403, http_5xx, network, auth or other), never tool stderr, which can carry URLs and credentials.`
// -> { arg, slug, host, owner, repo } or { why } (BLOCK)
async function repoIdentity(tag, ph) {
  const r = await ask(`Rote repository identity for ${UNIT} (${tag}). Write the block below verbatim to a temp file with a quoted heredoc and run it with: R=${shq(REPO)} L=${shq(LANE)} bash <file> (then delete the file). It prints only parsed identities and reason codes, never a URL. lines = its stdout lines, verbatim and in order. Run no other command: never read, print or quote a git remote URL yourself.
${ID_SH}`, { label: `repo identity (${tag})`, phase: ph, model: 'haiku', effort: 'low', schema: IDL })
  if (!r || !Array.isArray(r.lines)) return { why: 'repository identity did not report' }
  const lines = r.lines.map(String)
  const a = idOf(lines, 'repo'), b = idOf(lines, 'lane')
  if (a.fail) return { why: `the run repository's origin remote was rejected (${a.fail})` }
  if (b.fail) return { why: `the lane's origin remote was rejected (${b.fail})` }
  if (!sameId(a, b)) return { why: `the lane fetches from ${b.arg}, not the run repository ${a.arg}` }
  const nl = lines.find(x => /^PUSH_N \d+$/.test(x))
  const n = nl ? Number(nl.slice(7)) : -1
  if (n < 0) return { why: 'the push URL count was not reported' }
  if (n === 0) return { why: 'the lane origin has no resolvable push URL' }
  for (let i = 1; i <= n; i++) { // every entry, verbatim (an empty / whitespace entry is a fail line, never dropped)
    const c = idOf(lines, `push${i}`)
    if (c.fail) return { why: `the lane's push URL #${i} was rejected (${c.fail})` }
    if (!sameId(c, b)) return { why: `the lane's push URL #${i} targets ${c.arg}, not ${b.arg} (pushurl / pushInsteadOf redirect)` }
    if (!['https', 'ssh', 'scp'].includes(c.scheme)) return { why: `the lane's push URL #${i} uses ${c.scheme}; pushes go over https or ssh only` }
  }
  if (n !== 1) return { why: `the lane origin has ${n} effective push URLs; exactly one is supported` }
  // lowercase forms only: they feed the comparisons and the --repo / --hostname / repos/<owner>/<repo> arguments
  return { arg: b.arg, slug: `${b.lcOwner}/${b.lcRepo}`, host: b.lcHost, owner: b.lcOwner, repo: b.lcRepo }
}
// push (PUSH_SH) + outcome verification over the forge API (see THREAT MODEL above). Success only when the push
// exited 0 for exactly `sha` AND the API reports the validated repository's branch head == sha.
const PUSHR = { type: 'object', properties: { line: STR }, required: ['line'] }
async function pushAndVerify(tag, ph, rid, sha) {
  // fail fast: the push URLs are re-read (URL-blind) right before the push and must still name the validated repository
  const again = await repoIdentity(`${tag} pre-push`, ph)
  if (again.why) return { ok: false, why: `pre-push identity check: ${again.why}` }
  if (again.arg !== rid.arg) return { ok: false, why: `pre-push identity check: the lane now pushes to ${again.arg}, not ${rid.arg}` }
  const r = await ask(`Rote push for ${UNIT} (${tag}). Write the block below verbatim to a temp file with a quoted heredoc and run it with: L=${shq(LANE)} S=${sha} B=${shq(BR)} bash <file> (then delete the file). Never run git push yourself, never force, never open a PR, never bump a version. line = its one PUSH line, verbatim.
${PUSH_SH}`, { label: `${tag} push`, phase: ph, model: 'haiku', effort: 'low', schema: PUSHR })
  const m = r && String(r.line || '').match(/^PUSH exit=(\d+) local=([0-9a-f]{40}|none) reason=([a-z_]+)$/)
  if (!m) return { ok: false, why: 'the push step did not report a PUSH line' }
  const res = { exit_code: Number(m[1]), local_head: m[2], reason: m[3] }
  if (res.exit_code !== 0 || res.local_head !== sha) return { ok: false, why: `push failed (exit ${res.exit_code}, reason ${res.reason}, local ${res.local_head}, expected ${sha})`, res }
  // API_SH: the API answer must be self-describing (ref == refs/heads/<branch>, object.type == commit, url == the API
  // URL of the validated repository and branch); stderr stays private and only an allowlisted reason code comes back
  const v = await ask(`Rote forge API check for ${UNIT} (${tag}). Write the block below verbatim to a temp file with a quoted heredoc and run it with: H=${shq(rid.host)} OW=${shq(rid.owner)} RP=${shq(rid.repo)} B=${shq(BR)} bash <file> (then delete the file). Run no other command. line = its one API line, verbatim.
${API_SH}`, { label: `${tag} verify push`, phase: ph, model: 'haiku', effort: 'low', schema: PUSHR })
  const am = v && String(v.line || '').match(/^API exit=(\d+) ref=(ok|mismatch|none) sha=([0-9a-f]{40}|none) reason=(ok|api_error:[a-z0-9_]+|mismatch_ref|mismatch_url|empty|parse)$/)
  if (!am) return { ok: false, why: `push not verified: the ${rid.arg} API check did not report an API line`, res }
  if (am[1] !== '0' || am[2] !== 'ok') return { ok: false, why: `push not verified: the ${rid.arg} API check failed (exit ${am[1]}, reason ${am[4]})`, res }
  if (am[3] !== sha) return { ok: false, why: `push not verified: ${rid.arg} branch ${BR} is at ${am[3]}, not the pushed ${sha} (the push went elsewhere or was overwritten)`, res }
  return { ok: true, res: Object.assign(res, { verified_sha: am[3] }) }
}

const LINE = { type: 'object', properties: { line: STR }, required: ['line'] }
// "PR exit=0 number= state= cross= head_repo= head_ref= head=" | "PR exit=<n> reason=api_error:<code>" -> object or null
// "SETUP recorded_pr= recorded_branch= state= cross= head_repo= head_ref= head= remote_head= reason=" -> object or null
function setupLine(r) {
  const l = String((r && r.line) || '')
  if (!/^SETUP( [a-z_]+=[A-Za-z0-9._\/:-]*)+$/.test(l)) return null
  const kv = Object.fromEntries(l.slice(6).split(' ').map(x => [x.slice(0, x.indexOf('=')), x.slice(x.indexOf('=') + 1)]))
  if (!kv.reason) return null
  return { recorded_pr: Number(kv.recorded_pr || 0), recorded_branch: kv.recorded_branch === 'none' ? '' : kv.recorded_branch || '', state: kv.state || '', cross_repo: kv.cross === 'false' ? false : kv.cross === 'true' ? true : null, head_repo: kv.head_repo || '', head_ref: kv.head_ref || '', head: kv.head || '', remote_head: kv.remote_head || '', reason: kv.reason }
}
function prLine(r) {
  const l = String((r && r.line) || '')
  const ok = l.match(/^PR exit=0 number=(\d+) state=([A-Z_]+) cross=(true|false) head_repo=([A-Za-z0-9._-]+\/[A-Za-z0-9._-]+) head_ref=([A-Za-z0-9._\/-]+) head=([A-Za-z0-9._\/-]*)$/)
  if (ok) return { pr: Number(ok[1]), state: ok[2], cross_repo: ok[3] === 'true', head_repo: ok[4], head_ref: ok[5], head: ok[6] }
  const f = l.match(/^PR exit=(\d+) reason=(api_error:[a-z0-9_]+|invalid_field:[a-z_]+)$/)
  return f ? { pr: 0, notes: f[2] } : null
}

// Bounded: runs for the SHA must appear within CI_APPEAR_MIN and finish within CI_TOTAL_MIN, else BLOCKED with the
// missing / pending checks named (a path-filtered workflow never leaves the unit waiting forever). `repo`
// (host/owner/repo) scopes every gh call.
const CI_APPEAR_MIN = 20, CI_TOTAL_MIN = 120
// ciWait launch / cleanup (run by the agent's own shell, bash or zsh; every path is absolute and derived from RUN and the
// PR number, so each Bash call re-states it). The launcher makes the watcher a process-group leader and writes ITS pid
// (== its pgid) to "$O.pid" itself, then execs bash on the block file "$BF". CI_STOP kills only after proving the pid
// file names that watcher: a positive integer > 1, not the caller's own pgid, still a group leader, and its command line
// EXACTLY "bash $BF" (the launch argv, never a substring match); otherwise it prints a skip reason and kills nothing (an
// empty value must never become `kill -- -0`, which is the caller's own group). It signals the watcher's group (always
// seeded first: "ok" is printed only when that TERM was delivered) AND every process group of the watcher's
// descendants (a timeout/gtimeout call sits in its own group), collected once BEFORE the leader's TERM: TERM,
// 8 s (> the in-block grace G=5), KILL.
const CI_RUN = String.raw`nohup perl -e '$f = shift; setpgrp(0, 0); open(my $h, ">", $f) or exit 126; print $h "$$\n"; close $h; exec @ARGV or exit 127' "$O.pid" bash "$BF" > "$O" 2>/dev/null &`.split('@{').join('${')
const CI_STOP = String.raw`P=$(cat "$O.pid" 2>/dev/null); ME=$(ps -o pgid= -p $$ 2>/dev/null | tr -d ' ')
case "$P" in
  ''|0*|*[!0-9]*) echo "CI_STOP skip=no_pid" ;;
  *) if [ "$P" -le 1 ] || [ -z "$ME" ] || [ "$P" = "$ME" ]; then echo "CI_STOP skip=own_group"
     elif [ "$(ps -o pgid= -p "$P" 2>/dev/null | tr -d ' ')" != "$P" ] || [ "$(ps -ww -o command= -p "$P" 2>/dev/null)" != "bash $BF" ]; then echo "CI_STOP skip=not_watcher"
     else GS=$(printf '%s\n' "$P"; ps -A -o pid= -o ppid= -o pgid= 2>/dev/null | awk -v r="$P" -v me="$ME" '{ pp[$1] = $2; pg[$1] = $3 } END { for (i in pp) { j = i; n = 0; while (j != r && (j in pp) && n++ < 64) j = pp[j]; if (j == r && pg[i] > 1 && pg[i] != me) s[pg[i]] = 1 } for (x in s) print x }')
       if ! kill -TERM -- "-$P" 2>/dev/null; then echo "CI_STOP skip=gone"
       else printf '%s\n' "$GS" | while read -r g; do [ -n "$g" ] && [ "$g" != "$P" ] && kill -TERM -- "-$g" 2>/dev/null; done; sleep 8
         printf '%s\n' "$GS" | while read -r g; do [ -n "$g" ] && kill -KILL -- "-$g" 2>/dev/null; done; echo "CI_STOP ok"; fi; fi ;;
esac`.split('@{').join('${')
async function ciWait(prNumber, head, repo) {
  const total = CI_TOTAL_MIN * 60
  const bf = `${RUN}/ci-${prNumber}.sh`, vars = `O=${shq(`${RUN}/ci-${prNumber}.out`)}; BF=${shq(bf)}`
  const p = `Rote CI wait for PR #${prNumber} of ${UNIT} (branch ${BR}). Do NOT merge. Write the block below verbatim, with a quoted heredoc, to ${shq(bf)}. It runs up to ${CI_TOTAL_MIN} minutes, so launch it in the background, exactly: ${vars}; rm -f "$O" "$O.pid"; N=${prNumber} X=${shq(repo)} H=${head} APPEAR=${CI_APPEAR_MIN * 60} TOTAL=${total} ${CI_RUN}
Then poll in separate Bash calls (shell variables do not survive between calls: every call starts with ${vars}), each under 10 minutes (for i in $(seq 1 18); do grep -q '^CI ' "$O" && break; sleep 30; done), until "$O" holds its CI line or ${CI_TOTAL_MIN + 5} minutes have passed (then the line is "CI status=BLOCKED head=none reason=ci:timeout pass=0 fail=0 pending=0"). In EVERY case finish with exactly this (it kills nothing unless "$O.pid" names the watcher):
${vars}; ${CI_STOP}
then delete "$BF", "$O" and "$O.pid". Never end your turn while it runs. Run no other command. line = its one CI line, verbatim.
${CI_SH}`
  const c = await callChain(`PR #${prNumber} CI wait`, ['haiku', 'sonnet'], p, { label: `wait CI #${prNumber}`, phase: 'Ship', effort: 'low', schema: LINE })
  if (!c.r) return { status: 'BLOCKED', notes: `CI watcher failed (${c.class})`, failure_class: c.class }
  // only codes and integer counts are accepted: no check names, no logs, no free text
  const m = String(c.r.line || '').match(/^CI status=(READY|BLOCKED) head=([0-9a-f]{40}|none|invalid) reason=(ci:(?:pass|fail|pending|timeout|none)|head_moved|not_mergeable|api_error:[a-z0-9_]+) pass=(\d{1,4}) fail=(\d{1,4}) pending=(\d{1,4})$/)
  if (!m) return { status: 'BLOCKED', notes: 'the CI watcher did not report a CI line' }
  const r = { status: m[1], head: m[2], notes: m[3], checks: { pass: Number(m[4]), fail: Number(m[5]), pending: Number(m[6]) } }
  if (r.status === 'READY' && (r.head !== head || !['ci:pass', 'ci:none'].includes(r.notes))) return Object.assign(r, { status: 'BLOCKED', notes: `CI READY reported for head ${r.head} (${r.notes}), not a pass on the pushed ${head}` })
  if (/^api_error:/.test(r.notes)) r.failure_class = r.notes.slice(10)
  return r
}

// v1.8 decision D-E: late gate-born follow-ups (ship-delta / PATCH-delta P2s) append to hardening.json. false = not written.
async function appendHardening(tag, prefix, items) {
  if (!items.length) return true
  const p = `Append ${UNIT} ${tag} follow-ups (rote: write exactly the content given; edit ONLY these two files). 1) ${RUN}/hardening.json: a JSON array (create [] if missing; write a temp file and mv it over; keep every existing entry); append one object per item {id, source_unit: ${J(UNIT)}, finding, severity, files, owner_tier} with ids ${prefix}1, ${prefix}2, ... in the order given. 2) ${RUN}/deferred-ledger.md: append a "### ${UNIT} ${tag}" subsection with one row per item, same ids. Items: ${J(items)}. Return the ids you wrote, one per line.`
  const c = await callChain(`${UNIT} ${tag} hardening rows`, ['haiku', 'sonnet'], p, { label: `${UNIT} ${tag} hardening rows`, phase: curPhase, effort: 'low' })
  return !!c.r
}
const p2Items = (r, owner) => arr(r && r.p2).map(f => ({ finding: String(f), files: [], severity: 'P2', owner_tier: (byId[owner] && tierOf(byId[owner])) || 'T1' }))

// ruling R9: the guard scan before ANY push. gstack-lane commit --cwd scans every commit in base..HEAD (merges against
// each parent, amends included) for credential-shaped / filtered paths; on a clean tree it commits nothing.
async function prePushGuard(tag, base, cmpSha, reviewedTree) {
  const p = `Pre-push secret guard for ${UNIT} (${tag}; rote: run the commands and copy their output). 1) git -C ${LANE} status --porcelain must be empty; if not, skip step 2 and return exit_code 2 with lines = ["dirty: " + the first 5 paths]. 2) Run ${GL} commit --cwd ${LANE} --base ${base} -m "chore(${UNIT}): pre-push guard scan" and capture its stdout and exit status: exit_code = that status; lines = every stdout line that starts with secret_path=, filter_path=, control_changed= or no_changes=. 3) head = git -C ${LANE} rev-parse HEAD (full SHA). 4) files_since = git -C ${LANE} diff --name-only ${cmpSha}..HEAD.${reviewedTree ? ` 5) tree_delta = git -C ${LANE} diff --name-only ${reviewedTree} HEAD (the saved reviewed tree vs the head to push; [] when equal).` : ''} Return the envelope.`
  const g = await ask(p, { label: `${tag} pre-push guard`, phase: curPhase, model: 'haiku', effort: 'low', schema: GUARD })
  if (g && Number(g.exit_code) !== 0) return { ok: false, why: `guard refused (exit ${g.exit_code}): ${arr(g.lines).join(' | ') || 'no detail'}`, g }
  if (!g || !SHA_RE.test(String(g.head || '')) || !Array.isArray(g.files_since) || (reviewedTree && !Array.isArray(g.tree_delta))) return { ok: false, why: 'guard scan did not report (no evidence)' }
  const gb = badPaths(g, ['files_since', 'tree_delta'], `${tag} guard scan`)
  if (gb) return { ok: false, why: gb }
  if (!arr(g.lines).some(l => /^no_changes=true/.test(String(l)))) return { ok: false, why: 'guard scan did not confirm no_changes=true (an unscanned commit or a dirty tree)', g }
  return { ok: true, g }
}

// ---------- gate loop (retro items 1, 2, 3, 4, 5, 9; v1.8 D-B, D-E) -----------------------------------
async function gateLoop() {
  let maxR = flow === 'LITE' ? 1 : MAXR
  let autoFourthUsed = false
  let prev = ''
  const last = {}
  let rerun = new Set()
  let seatCScope = 'full'
  let fixMutants = []
  let forceFullMut = false
  let dockerEverRan = false
  let mutFullDone = false
  let invalidPrev = []
  const owed = new Set() // seats with an unresolved INVALID in this gate: only a PRESENT result clears it
  let frozenSha = '' // set for an INVALID re-run: that round must review exactly this SHA (no commit, no HEAD move)
  const deferred = []
  const briefMutants = has(A.prebuilt) || Object.values(refreshTasks).some(t => arr(t.mutation_targets).length > 0)
  const up = x => String(x || '').toUpperCase()

  // ruling R3: INVALID seat evidence is resolved (re-run clean) BEFORE any round-cap / shipOpenP1 / DEGRADED path:
  // a round that must re-run an INVALID seat extends the cap by one instead of reaching it.
  // Every INVALID re-run is an EXTRA review at the same SHA, outside the full-round budget: the cap grows by one each time.
  let invalidExtra = 0
  function extendForInvalid(inv, why) {
    if (!inv.length) return
    maxR += 1; invalidExtra += 1
    rounds.push({ invalid_rerun_round: round + 1, seats: inv.join(','), why, counts_as_round: false })
    say(`${UNIT}: round ${round + 1} re-runs INVALID ${inv.join(', ')} (${why}); it does not count against the round cap`)
  }

  // P1 path: LITE -> FULL, round cap / automatic 4th, owner-routed fix, then only failed + invalidated members re-run
  async function onP1(cons, gs, invalidated, why, inv) {
    const keptP1 = arr(cons.p1).length
    if (flow === 'LITE') { upgrade(`kept [P1] (${why}) in round ${round}`, round); maxR = Math.max(maxR, MAXR + invalidExtra) }
    if (round >= maxR && arr(inv).length) extendForInvalid(arr(inv), 'kept [P1] with an INVALID seat')
    else if (round >= maxR) {
      const p1Fixes = arr(cons.fixes).filter(f => f.severity === 'P1')
      if (AUTO4 && !autoFourthUsed && cons.new_p1 && p1Fixes.length) {
        autoFourthUsed = true
        maxR += 1
        rounds.push({ auto_extra_round: maxR, why: `round ${round} found a NEW [P1] with an in-scope fix` })
        say(`${UNIT}: automatic round ${maxR} (round ${round} found a new [P1] with an in-scope fix)`)
      } else if (has(A.shipOpenP1)) return { result: { verdict: 'FAIL', cons, deferred, shippedOpen: true, gatedSha: gs.reviewed_sha } }
      else return { result: { stop: { stopped: `gate FAIL: ${keptP1} kept [P1] after ${round - invalidExtra} full round(s)${invalidExtra ? ` (+${invalidExtra} INVALID re-run(s), not counted)` : ''}`, final: cons, decision: `${UNIT}: gate FAIL after ${round - invalidExtra} full rounds with ${keptP1} kept [P1]: another round, ship open (shipOpenP1), or re-plan?` } } }
    }
    enter('Fix')
    await writeState(`Fix r${round}`)
    const fx = await fixPass(arr(cons.fixes), `r${round}`, `${R}/gate-${U}-r${round}-consolidated.md`, 'Fix')
    if (fx.stop) return { result: { stop: fx.stop } }
    const failed = ['seat_c', 'seat_x', 'docker', 'mutation'].filter(n => last[n] && ['FAIL', 'INVALID'].includes(up(last[n].env.verdict)))
    rerun = new Set(failed.concat(arr(invalidated)).concat(arr(inv)))
    seatCScope = 'full'
    if (!rerun.has('seat_c') && !rerun.has('seat_x')) { rerun.add('seat_c'); seatCScope = 'delta' } // the fix code still gets one Claude look
    if (!dockerEverRan && flow === 'FULL') rerun.add('docker') // an upgraded LITE owes FULL's Docker run
    if (!mutFullDone && flow === 'FULL') { rerun.add('mutation'); forceFullMut = true }
    fixMutants = uniq(arr(cons.fixes).flatMap(f => arr(f.mutants)))
    prev = gs.reviewed_sha
    return { next: true }
  }

  for (;;) {
    round++
    enter('Gate')
    await writeState(`Gate r${round}`)
    const gsLabel = `r${round} gate start`, prevAtStart = prev
    // ruling R9 / the skill's step c: commit through the helper's secret guard first (a no-op on a clean tree); it also
    // scans every commit in BASE..HEAD (raw merges and amends included) before anything is reviewed or pushed.
    const gs = await ask(`Gate start for ${UNIT}, round ${round} (rote: run the commands, report their output). 0) ${frozenSha ? `This round re-runs an INVALID seat at the frozen SHA ${frozenSha}: do NOT commit anything. If git -C ${LANE} status --porcelain is not empty, guard_exit = 2 and guard_lines = ["dirty: " + the first 5 paths], stop here and return the envelope with reviewed_sha "" and empty lists; else guard_exit = 0 and guard_lines = [].` : `Run ${GL} commit --cwd ${LANE} --base ${BASE} -m "wip(${UNIT}): gate round ${round}" and capture its stdout and exit status: guard_exit = that status; guard_lines = every stdout line starting with secret_path=, filter_path=, control_changed=, no_changes= or result_sha=. On a non-zero guard_exit stop here and return the envelope with reviewed_sha "" and empty lists.`} 1) mkdir -p ${GATES}; if ${RULINGS} does not exist, write [] to it (never overwrite an existing register). 2) reviewed_sha = git -C ${LANE} rev-parse HEAD (full SHA). 3) files_since_base = git -C ${LANE} diff --name-only ${BASE}...<reviewed_sha>. 4) files_since_prev = ${prev ? `git -C ${LANE} diff --name-only ${prev}..<reviewed_sha>` : 'the same list as files_since_base'}. 5) rulings = the number of entries in ${RULINGS}. Return the envelope.`, { label: gsLabel, phase: 'Gate', model: 'haiku', effort: 'low', schema: GS })
    if (gs && frozenSha && Number(gs.guard_exit) !== 0) return { stop: { stopped: `BLOCKED: the INVALID re-run of round ${round} found a dirty lane (${arr(gs.guard_lines).join(' | ')}); it must review the frozen SHA ${frozenSha} unchanged`, failure_class: 'error' } }
    if (gs && Number(gs.guard_exit) !== 0) return { stop: { stopped: `BLOCKED: secret guard refused the unit's commits at gate round ${round} (exit ${gs.guard_exit}): ${arr(gs.guard_lines).join(' | ') || 'no detail'}`, failure_class: 'guard', decision: `${UNIT}: credential-shaped or filtered path(s) in the unit's commits; remove them from history before the gate` } }
    if (!gs || !SHA_RE.test(String(gs.reviewed_sha || '')) || !Array.isArray(gs.files_since_base) || !Array.isArray(gs.files_since_prev)) {
      const cls = gs ? 'error' : await classify('haiku', gsLabel, 'Gate')
      return { stop: { stopped: `BLOCKED: gate start failed in round ${round} (${cls})`, failure_class: cls } }
    }
    const gsb = badPaths(gs, ['files_since_base', 'files_since_prev'], `gate start of round ${round}`)
    if (gsb) return { stop: { stopped: `BLOCKED: ${gsb}`, failure_class: 'error' } }
    if (frozenSha && gs.reviewed_sha !== frozenSha) return { stop: { stopped: `BLOCKED: the INVALID re-run of round ${round} is at ${gs.reviewed_sha}, not the frozen SHA ${frozenSha} (HEAD moved); the unresolved review must be re-run on the same code`, failure_class: 'error' } }
    frozenSha = ''
    const sinceBase = arr(gs.files_since_base)
    const delta = round === 1 ? sinceBase : arr(gs.files_since_prev)
    const deltaRange = round === 1 || !prevAtStart ? `${BASE}...${gs.reviewed_sha}` : `${prevAtStart}..${gs.reviewed_sha}`
    const sched = round === 1
      ? { seat_c: true, seat_x: true, docker: flow === 'FULL' || GATE_CLASS === 'critical' || touches(sinceBase, DOCKER_RES).length > 0, mutation: true }
      : { seat_c: rerun.has('seat_c'), seat_x: rerun.has('seat_x'), docker: rerun.has('docker') || touches(delta, DOCKER_RES).length > 0, mutation: rerun.has('mutation') || fixMutants.length > 0 || (briefMutants && delta.length > 0) }
    const mutMode = (round === 1 && flow === 'FULL') || forceFullMut ? 'full' : (round === 1 ? 'brief' : 'scoped')
    const scopeNow = round === 1 ? 'full' : seatCScope

    const names = [], thunks = []
    if (sched.seat_c) { names.push('seat_c'); thunks.push(() => seatC(round, scopeNow, gs, prev)) }
    if (sched.seat_x) { names.push('seat_x'); thunks.push(() => seatX(round, gs)) }
    if (sched.docker) { names.push('docker'); thunks.push(() => dockerMember(round, gs)) }
    const got = await parallel(thunks)
    const envs = {}
    names.forEach((n, i) => { envs[n] = got[i] || { member: n, status: 'ABSENT', verdict: 'ABSENT', class: 'error', notes: 'member returned nothing' } })
    if (envs.docker && up(envs.docker.status) === 'PRESENT') dockerEverRan = true

    // ruling R1 + v1.8 decision D-B: Seat X ABSENT. A critical gate always waits for Astra (never Sol, never CLEAN);
    // an ordinary gate waits on an Astra quota/cooling unless the operator's policy accepts DEGRADED (acceptDegraded).
    if (envs.seat_x && up(envs.seat_x.status) === 'ABSENT') {
      const sx = envs.seat_x, cls = sx.class || 'error', cooling = cls === 'quota'
      const resume = `${sx.reset_at || 'the l3 reset (next_probe_at in lanes.json)'} + 2 min (resumeFromRunId)`
      if (GATE_CLASS === 'critical') {
        return { stop: { stopped: `BLOCKED: critical gate requires ${SEATX}; Seat X ABSENT (${cls})`, failure_class: cls, wait_until: cooling ? (sx.reset_at || '') : '', seat_x: sx, decision: cls === 'disabled' ? `${UNIT}: critical gate needs Seat X but codex_reviews is off: re-enable it, or stop?` : `${UNIT}: critical gate waits for ${SEATX}; schedule the auto-resume at ${resume} with gateAttempt incremented` } }
      }
      if (cooling && !has(A.acceptDegraded)) {
        return { stop: { stopped: `BLOCKED: Seat X ${SEATX} ABSENT on quota/cooling; the gate waits for the reset (Sol cannot run on a cooling L3)`, failure_class: 'quota', wait_until: sx.reset_at || '', seat_x: sx, decision: `${UNIT}: Seat X waits for ${SEATX}; schedule the auto-resume at ${resume} with gateAttempt incremented, or accept DEGRADED (acceptDegraded)` } }
      }
    }
    if (envs.seat_c && envs.seat_x && up(envs.seat_c.status) === 'ABSENT' && up(envs.seat_x.status) === 'ABSENT') {
      return { stop: { stopped: `BLOCKED: both gate seats ABSENT in round ${round} (seat C ${envs.seat_c.class || 'error'}, seat X ${envs.seat_x.class || 'error'}); a member failure, not a gate verdict`, failure_class: envs.seat_x.class || envs.seat_c.class || 'error', wait_until: envs.seat_x.reset_at || '' } }
    }

    if (sched.mutation) {
      const m = await mutationMember(round, gs, mutMode, fixMutants, delta, deltaRange)
      if (up(m.verdict) !== 'SKIPPED') {
        envs.mutation = m
        if (mutMode === 'full' && up(m.status) === 'PRESENT') mutFullDone = true
      }
    }
    forceFullMut = false
    // INVALID is sticky within the gate (rulings R3/R4): a later ABSENT for the same seat (a retry, a substitute, a quota)
    // never overwrites it, so invalidPrev catches INVALID -> ABSENT and DEGRADED acceptance stays unreachable
    for (const n of ['seat_c', 'seat_x']) {
      if (!envs[n]) continue
      const s = up(envs[n].status)
      if (s === 'INVALID' || !['PRESENT', 'ABSENT'].includes(s)) owed.add(n)
      else if (s === 'PRESENT') owed.delete(n)
      else if (owed.has(n)) envs[n] = Object.assign({}, envs[n], { status: 'INVALID', verdict: 'INVALID', notes: `${n} ABSENT (${envs[n].class || 'unknown'}) after an earlier INVALID in this gate: the INVALID stays unresolved` })
    }
    for (const n of Object.keys(envs)) last[n] = { env: envs[n], round }
    const carried = Object.keys(last).filter(n => !envs[n]).map(n => ({ member: n, from_round: last[n].round, verdict: last[n].env.verdict, report: last[n].env.report || '', note: 'not re-run: its evidence is unaffected by the fix delta' }))

    // retro-2026-10-19 item 2: the consolidator reads, then writes, the rulings register
    const consP = `Consolidate the ${UNIT} gate, round ${round} (flow ${flow}, gate class ${GATE_CLASS}). Envelopes this round: ${J(envs)}. Carried members (not re-run; their range is unaffected): ${J(carried)}. Read every report they name (Seat X's review text is at its report path; trust the text over any summary). A member with status INVALID or ABSENT supplies no evidence either way.
RULINGS REGISTER ${RULINGS}: read it FIRST. A claim already in it is not re-verified; a member re-raising it without a new fact is recorded as "re-raise" and counts as PASS for that claim. Verify every NEW claimed [P1] in code (${LANE}, RANGE ${BASE}...${gs.reviewed_sha}); keep it or downgrade it with a code-cited reason. Fail-closed. Apply ${SECF} A Docker failure or a concurrency-suite flake is [P1]. CHANGELOG and docs prose is never [P1]. Then rewrite the register (temp file + mv; JSON array; keep every existing entry) adding one entry per claim adjudicated this round: {claim_id (short hash of file + one-line gist), disposition (kept-P1 | downgraded-P2 | refuted | deferred-to <id> | out-of-scope | re-raise), reason (one sentence, code-cited), round: ${round}, member}.
Verdict rules (the script re-checks them): CLEAN = Seat C and Seat X both PRESENT with completed reviews and zero kept [P1]; DEGRADED = zero kept [P1] but a seat, or a scheduled Docker/mutation check, ABSENT (never CLEAN); FAIL = any kept [P1] (p1 MUST then list them); BLOCKED = the gate cannot be decided (say why in members). P2 fix-now items never block CLEAN and never trigger a full round.
p1 = every kept [P1] still unfixed at ${gs.reviewed_sha}, including ones kept in earlier rounds. fixes = every kept [P1] (severity P1) plus cheap in-scope P2 fix-now items (severity P2), each with owner in ${J(OWNERS)}, the mutants to re-run to verify it, its files, and checks = the named checks that verify it ({name, command}: the targeted tests plus typecheck). deferred_p2 = the remaining P2s {finding, files, owner, target, cost_if_wrong}. invalidates = members whose evidence the P1 fixes will invalidate beyond the FAILed ones. member_downgrades = each Docker or mutation FAIL you did NOT keep as a [P1], with its code-cited reason. new_p1 = true when a kept [P1] was not raised in any earlier round. members_present = per seat PRESENT|ABSENT|INVALID, per check PASS|FAIL|SKIPPED|ABSENT. Write ${R}/gate-${U}-r${round}-consolidated.md. Return the envelope.`
    const c = await callChain(`r${round} consolidate`, synChain(synFirst(A.synConsFrom || 99, round)), consP, { label: `r${round} consolidate`, phase: 'Gate', effort: 'high', schema: CONS })
    if (!c.r) return { stop: { stopped: `BLOCKED: consolidator failed in round ${round} (${c.class}); a consolidator failure, not a gate verdict`, failure_class: c.class } }
    const cons = c.r
    if (has(A.extraFixes) && round === A.extraFixRound) cons.fixes = arr(cons.fixes).concat(arr(A.extraFixes).map(f => Object.assign({ severity: 'P2', checks: [] }, f)))
    deferred.push(...arr(cons.deferred_p2))

    // retro-2026-10-19 item 9: the script, not the consolidator, decides presence and the verdict.
    // Unknown / malformed seat status => INVALID (fail closed); a seat that never ran => ABSENT.
    const seat = n => { const e = last[n] && last[n].env; if (!e) return 'ABSENT'; const s = up(e.status); return ['PRESENT', 'ABSENT', 'INVALID'].includes(s) ? s : 'INVALID' }
    const check = n => { const e = last[n] && last[n].env; if (!e) return 'SKIPPED'; if (up(e.status) !== 'PRESENT') return 'ABSENT'; return up(e.verdict) === 'PASS' || up(e.verdict) === 'SKIPPED' ? 'PASS' : 'FAIL' }
    const mp = { seat_c: seat('seat_c'), seat_x: seat('seat_x'), docker: check('docker'), mutation: check('mutation') }
    cons.members_present = mp
    const keptP1 = arr(cons.p1).length
    const inv = ['seat_c', 'seat_x'].filter(n => mp[n] === 'INVALID')
    const downgraded = arr(cons.member_downgrades).map(d => d.member)
    const checkFail = ['docker', 'mutation'].filter(n => mp[n] === 'FAIL' && !downgraded.includes(n))
    let v, why = ''
    if (cons.verdict === 'BLOCKED') { v = 'BLOCKED'; why = String(cons.members || 'consolidator BLOCKED') }
    else if (cons.verdict === 'FAIL' && !keptP1) { v = 'BLOCKED'; why = 'consolidator inconsistency: verdict FAIL with no kept [P1]' }
    else if (inv.length && GATE_CLASS === 'critical') { v = 'BLOCKED'; why = `${inv.join(', ')} INVALID on a critical gate` }
    else if (inv.some(n => invalidPrev.includes(n))) { v = 'BLOCKED'; why = `${inv.filter(n => invalidPrev.includes(n)).join(', ')} INVALID again after a clean re-run was attempted` }
    else if (inv.length) v = 'RERUN_INVALID' // resolved at the SAME frozen SHA before any fix, cap or DEGRADED path
    else if (keptP1 > 0) v = 'FAIL'
    else if (checkFail.length) { v = 'BLOCKED'; why = `consolidator inconsistency: ${checkFail.join(', ')} FAIL with no kept [P1] and no cited downgrade` }
    else if (mp.seat_c !== 'PRESENT' || mp.seat_x !== 'PRESENT' || mp.docker === 'ABSENT' || mp.mutation === 'ABSENT') v = 'DEGRADED'
    else v = 'CLEAN'
    cons.verdict = v === 'RERUN_INVALID' ? 'BLOCKED' : v
    invalidPrev = inv
    rounds.push({ round, flow, members: Object.keys(envs).map(n => `${n}:${envs[n].verdict}${envs[n].substituted ? ` (${envs[n].substituted})` : ''}`).join(' '), carried: carried.map(x => `${x.member}:${x.verdict}@r${x.from_round}`).join(' '), verdict: v, p1: keptP1, fixes: arr(cons.fixes).length, members_present: mp })

    if (v === 'BLOCKED') return { stop: { stopped: `BLOCKED: gate round ${round}: ${why}; not a gate verdict`, final: cons, failure_class: 'error' } }
    if (v === 'RERUN_INVALID') { // ordinary gate: re-run the INVALID seat clean at the same SHA before anything else;
      // kept [P1]s wait (they stay in the rulings register and the next consolidation keeps them as still unfixed)
      extendForInvalid(inv, keptP1 ? `INVALID seat; ${keptP1} kept [P1] wait for the re-run` : 'INVALID seat, no kept [P1]')
      rerun = new Set(inv); seatCScope = 'full'; fixMutants = []; prev = gs.reviewed_sha; frozenSha = gs.reviewed_sha
      continue
    }
    if (v === 'FAIL') {
      const o = await onP1(cons, gs, cons.invalidates, 'gate', [])
      if (o.result) return o.result
      continue
    }

    // CLEAN or DEGRADED: P2 fix-now -> ONE owner-routed pass + scoped delta review (retro-2026-10-19 item 1)
    const p2 = arr(cons.fixes).filter(f => f.severity !== 'P1')
    if (!p2.length) return { verdict: v, cons, deferred, gatedSha: gs.reviewed_sha }
    enter('Fix')
    await writeState(`Fix r${round} (P2 fix-now)`)
    const fx = await fixPass(p2, `r${round}-p2`, `${R}/gate-${U}-r${round}-consolidated.md`, 'Fix')
    if (fx.stop) return { stop: fx.stop }
    const hf = await headFiles(`r${round}-p2 delta head`, gs.reviewed_sha, 'Fix')
    if (!hf) return { stop: { stopped: `BLOCKED: P2 fix delta inventory unreadable in round ${round}`, failure_class: 'error' } }
    if (hf.bad) return { stop: { stopped: `BLOCKED: ${hf.bad}`, failure_class: 'error' } }
    const dc = await deltaChecked(`r${round}-p2`, gs.reviewed_sha, hf.head, uniq(p2.flatMap(f => arr(f.mutants))), `the P2 fix-now items of ${R}/gate-${U}-r${round}-consolidated.md`, 'P2 fix-now verification')
    if (dc.outcome === 'FAILED') return { stop: { stopped: `BLOCKED: scoped delta review failed (${dc.class}); a member failure, not a gate verdict`, failure_class: dc.class } }
    rounds.push({ delta_review: `r${round}-p2`, verdict: dc.r.verdict, outcome: dc.outcome, p1: arr(dc.r.p1).length, counts_as_round: false })
    // ruling R4: an incomplete delta review (re-run once already) BLOCKs; it is never a pass and never a [P1]
    if (dc.outcome === 'INCOMPLETE') return { stop: { stopped: `BLOCKED: the P2 scoped delta review of round ${round} was incomplete twice (${dc.r.notes || 'no reason given'}); not a gate verdict`, failure_class: 'error', delta: dc.r } }
    deferred.push(...arr(dc.r.p2).map(f => ({ finding: f, files: [], owner: 'integration' })))
    if (dc.outcome === 'PASS') return { verdict: v, cons, deferred, gatedSha: hf.head, delta: dc.r }
    // a kept [P1] in the fix delta: treat it as this round's P1 result; both seats look again
    const dcons = Object.assign({}, cons, { verdict: 'FAIL', p1: arr(dc.r.p1), fixes: arr(dc.r.fixes).map(f => Object.assign({ checks: [] }, f, { severity: 'P1' })), new_p1: true })
    rounds[rounds.length - 1].verdict = 'FAIL'
    const o = await onP1(dcons, Object.assign({}, gs, { reviewed_sha: hf.head }), ['seat_c', 'seat_x'], 'P2 fix delta', [])
    if (o.result) return o.result
  }
}

// ---------- FULL / LITE unit flow ---------------------------------------------------------------------
function refreshPrompt() {
  const plan = WAVES.map((w, i) => `wave ${i + 1}: ` + w.map(t => `${t.id} [${tierOf(t)}] (${t.impl === 'codex' ? 'Codex' : 'Claude'}: ${routeDesc(t)})`).join(' || ')).join('; then ')
  return `Brief refresh for ship-unit ${UNIT} (flow ${flow}, gate class ${GATE_CLASS}) right before build. Base ${BASE}; lane ${LANE} (branch ${BR} starts at ${BASE}).${opt(A.context, x => ` Unit context: ${x}`)}
For ${BRIEFS}: verify every path, anchor, symbol, signature, enum/migration fact and base precondition against the code at ${BASE} (read-only); fix stale items in place (edit only under ${B}). Execution plan: ${plan}; the first Claude task of a wave runs in the lane, every other task in its own gstack-lane worktree, and each wave's worktree branches merge into the lane before the next wave. Make the briefs agree (bases, who commits, reports at ${R}/<id>-report.md). Confirm tasks in the same wave are file-disjoint (name overlaps + hunk placement). For each task list its NAMED CHECKS (every command the brief requires to pass: typecheck, lint, named tests — name + exact command) and its mutation targets (the P1 set under ${SECF}). Confirm the baseline is GREEN at ${BASE}${PRIV(`${DB}_ref`, LANE)} Write ${R}/${U}-brief-refresh.md. Return the envelope (status READY or BLOCKED; disjoint; baseline; tasks[] with named_checks and mutation_targets).`
}

async function runWave(wi) {
  const wave = WAVES[wi]
  let laneTaken = false
  const placed = wave.map(t => {
    const inLane = t.impl === 'claude' && !laneTaken
    if (inLane) laneTaken = true
    return { t, inLane, wtTask: inLane ? '' : safe(`${U}-${t.id}`) }
  })
  const wtTasks = placed.filter(p => !p.inLane).map(p => p.wtTask)
  const wbLabel = `wave ${wi + 1} base`
  const wkey = `${UNIT_DIR}/w${wi + 1}`
  // Resume safety: the trusted task base is the wave base the SCRIPT recorded in ${RUN}/state.json (wave_bases), never a
  // value re-read from the run tree's worktree metadata or from any file inside a task worktree.
  const wb = await ask(`Prepare wave ${wi + 1} of ${UNIT} (rote). 1) If branch ${BR} does not exist: git -C ${LANE} status --porcelain must be empty (else return head "DIRTY"); git -C ${LANE} switch -c ${BR} ${BASE}. If it exists it must be checked out in ${LANE}. 2) FROM: if ${RUN}/state.json has wave_bases[${J(wkey)}] (jq -r --arg k ${J(wkey)} '.wave_bases[$k] // empty' ${RUN}/state.json), this is a resumed wave: FROM = that value, and it must be an ancestor of HEAD (git -C ${LANE} merge-base --is-ancestor <FROM> HEAD; else return head "BASE_MISMATCH"); otherwise FROM=$(git -C ${LANE} rev-parse HEAD). 3) ${wtTasks.length ? `For each task in ${J(wtTasks)}: if ${RUN}/wt/<task> already exists (a resumed run) reuse it as is; otherwise ${GL} worktree add --run-dir ${RUN} --task <task> --base <FROM> --repo ${REPO}. Record base_sha = FROM for every task (never read it from ${RUN}/wt-meta or from any file inside a worktree) and the branch (git -C ${RUN}/wt/<task> rev-parse --abbrev-ref HEAD).` : 'No task worktrees this wave: worktrees=[].'} Return the envelope (head = FROM, full SHA; worktrees[] {task, path, branch, base_sha}).`, { label: wbLabel, phase: 'Build', model: 'haiku', effort: 'low', schema: WB })
  if (!wb || !SHA_RE.test(String(wb.head || ''))) return { stop: { stopped: `BLOCKED: wave ${wi + 1} base not prepared (${wb ? wb.head : await classify('haiku', wbLabel, 'Build')})` } }
  const FROM = wb.head
  const wtInfo = Object.fromEntries(arr(wb.worktrees).map(w => [w.task, w]))
  const missingWt = wtTasks.filter(x => !wtInfo[x] || !wtInfo[x].path)
  if (missingWt.length) return { stop: { stopped: `BLOCKED: wave ${wi + 1} worktrees missing: ${missingWt.join(', ')}` } }
  const badBase = wtTasks.filter(x => wtInfo[x].base_sha !== FROM)
  if (badBase.length) return { stop: { stopped: `BLOCKED: wave ${wi + 1} task base mismatch (${badBase.join(', ')} not based on the recorded wave base ${FROM})` } }
  if (!(await writeState(`Build wave ${wi + 1}`, [], { wave_bases: { [wkey]: FROM } }))) return { stop: { stopped: `BLOCKED: wave ${wi + 1} base not recorded in state.json (resume would lose the trusted task base)` } }

  const results = await parallel(placed.map(p => async () => {
    const t = p.t
    // where.base is the script's own FROM (trusted), never the agent-reported value
    const where = p.inLane ? { kind: 'lane', cwd: LANE } : { kind: 'task', cwd: wtInfo[p.wtTask].path, task: p.wtTask, base: FROM }
    const job = { id: t.id, tier: tierOf(t), named: namedChecks(t.id), report: `${R}/${t.id}-report.md`, text: `Implement task ${t.id} (${UNIT}, tier ${tierOf(t)}) exactly per ${B}/${t.id}.md${has(A.prebuilt) ? '' : ` (refreshed: ${R}/${U}-brief-refresh.md)`}. Named checks: ${J(namedChecks(t.id))}.${opt(t.note, n => ' ' + n)}` }
    return runChain(job, where, FROM, implChain(t), 'Build') // the skill's routing table, tier guard first
  }))
  const built = {}
  placed.forEach((p, i) => { built[p.t.id] = results[i] })
  const bad = placed.filter((p, i) => !results[i] || !/^DONE/.test(String(results[i].status || ''))).map(p => p.t.id)
  if (bad.length) return { stop: { stopped: `wave ${wi + 1} not DONE: ${bad.join(', ')}`, built } }
  if (wtTasks.length) {
    const branches = wtTasks.map(x => ({ task: x, branch: wtInfo[x].branch }))
    const m = await callChain(`merge wave ${wi + 1}`, ['claude-opus-5-5', 'claude-opus-4-8'], `In lane ${LANE} (branch ${BR}), merge these task branches in this order: ${J(branches)} (git -C ${LANE} merge --no-ff <branch> -m "integrate <task> into ${UNIT}" with the trailer "${TRAILER}"); resolve conflicts preserving each brief's intent (${BRIEFS}).${opt(A.mergeNotes, x => ' ' + x)} Verify typecheck, lint and the wave's named checks${PRIV(DB, LANE)} ${CONC} Fix only seams; commit seam fixes via ${GL} commit --cwd ${LANE} --base ${BASE} -m "<summary>" (message ending with the trailer line; a secret_path= / filter_path= refusal = status RED with the lines in notes). ${EDIT_NOTE} Then remove each merged task worktree: ${GL} worktree rm --run-dir ${RUN} --task <task>. Return the envelope (status GREEN or RED, head, notes).`, { label: `merge wave ${wi + 1}`, phase: 'Build', effort: 'high', schema: MERGE })
    if (!m.r || m.r.status !== 'GREEN') return { stop: { stopped: `wave ${wi + 1} merge ${m.r ? 'RED' : `failed (${m.class})`}`, built, merge: m.r, failure_class: m.r ? '' : m.class } }
  }
  return { built }
}

// The skill's mid-milestone meter: the same step-f reading after a wave. null when the meter itself failed.
async function waveMeter(wi) {
  const r = await ask(`Rote size meter for ${UNIT} after wave ${wi + 1}. Run exactly: ${METER} — and return prod_loc and test_loc from its SHIP_METER line (line = that line verbatim). If it prints a "SHIP_METER FAIL" line, or exits non-zero, return prod_loc -1 and test_loc -1 with line = that output.`, { label: `wave ${wi + 1} meter`, phase: 'Build', model: 'haiku', effort: 'low', schema: METERS })
  if (!r || !Number.isFinite(Number(r.prod_loc)) || !Number.isFinite(Number(r.test_loc)) || Number(r.prod_loc) < 0 || Number(r.test_loc) < 0 || /FAIL/.test(String(r.line || ''))) return null
  return { prod: Number(r.prod_loc), test: Number(r.test_loc) }
}

async function shipPhase(g, integ) {
  enter('Ship')
  const cons = g.cons
  // ruling R4: a state.json write failure at the Ship boundary stops BEFORE anything is published
  if (!(await writeState('Ship'))) return finish({ stopped: 'BLOCKED: state.json write failed at the Ship boundary; nothing published', final: cons, failure_class: 'error' })
  const shippedOpen = !!g.shippedOpen
  if (g.verdict === 'DEGRADED' && !has(A.acceptDegraded)) {
    return finish({ stopped: `gate DEGRADED (members_present ${J(cons.members_present)}): /ship needs an operator-accepted record (acceptDegraded)`, final: cons, decision: `${UNIT}: accept the DEGRADED gate and ship, or re-run the missing member?` })
  }
  // shipping open at the round cap with a seat ABSENT is also a DEGRADED gate: it needs acceptDegraded too
  const mpS = cons.members_present || {}
  if (shippedOpen && (mpS.seat_c !== 'PRESENT' || mpS.seat_x !== 'PRESENT') && !has(A.acceptDegraded)) {
    return finish({ stopped: `shipOpenP1 with a seat not PRESENT (members_present ${J(mpS)}): needs an operator-accepted DEGRADED record (acceptDegraded) as well`, final: cons, decision: `${UNIT}: ship open AND accept the missing seat, or re-run it?` })
  }
  const skip = g.verdict === 'CLEAN' || (g.verdict === 'DEGRADED' && has(A.acceptDegraded))

  // ledger + hardening rows (v1.8 decision D-E): rote, content decided by the consolidator
  const seen = new Set(), items = []
  const addItem = (d, sev) => { const k = String(d.finding || ''); if (!k || seen.has(k)) return; seen.add(k); const t = byId[d.owner]; items.push({ finding: k, files: arr(d.files), severity: sev, owner_tier: t ? tierOf(t) : 'T1', ruling: d.ruling || 'deferred by the gate consolidator', target: d.target || '', cost_if_wrong: d.cost_if_wrong || '' }) }
  arr(g.deferred).forEach(d => addItem(d, 'P2'))
  if (shippedOpen) arr(cons.fixes).forEach(f => addItem({ finding: f.item, files: f.files, owner: f.owner, ruling: 'unapplied at the round cap' }, f.severity))
  const ledgerP = `Append the ${UNIT} gate follow-ups (rote: write exactly the content given; edit ONLY these two files).
1) ${RUN}/deferred-ledger.md: append a "### ${UNIT} ship" subsection (create the file with a "# Deferred ledger" heading if missing); one table row per item with ids ${LID}-F1, ${LID}-F2, ... in the order given: | id | finding | files | severity | ruling | target | cost if wrong |.
2) ${RUN}/hardening.json: a JSON array (create [] if missing; write a temp file and mv it over; keep every existing entry); append one object per item {id, source_unit: ${J(UNIT)}, finding, severity, files, owner_tier} with the same ids.
Items: ${J(items)}${shippedOpen ? `\nThe operator ships with the final gate NOT clean: ${A.shipOpenP1} Also add one row and one hardening entry (severity "P1", ruling "shipped open by that operator decision", target: its upgrade trigger) per kept P1: ${J(arr(cons.p1))}` : ''}
Return the ids you wrote, one per line (or "none").`
  const ledger = await callChain(`${UNIT} ledger rows`, ['haiku', 'sonnet'], ledgerP, { label: `${UNIT} ledger + hardening rows`, phase: 'Ship', effort: 'low' })
  if (!ledger.r) return finish({ stopped: `BLOCKED: ledger rows not written (${ledger.class})`, final: cons, failure_class: ledger.class })
  const gatedHead = lastSha(await ask(`Return only the output of: git -C ${LANE} rev-parse HEAD`, { label: 'gated head', phase: 'Ship', model: 'haiku', effort: 'low' }))
  if (!gatedHead) return finish({ stopped: 'BLOCKED: gated head unreadable', final: cons })
  if (g.gatedSha && gatedHead !== g.gatedSha) return finish({ stopped: `BLOCKED: lane HEAD ${gatedHead} is not the gated head ${g.gatedSha} (ungated commits)`, final: cons })
  if (shippedOpen && has(A.shipOpenP1Markers)) {
    await ask(`Comment-only commit in ${LANE} (branch ${BR}), operator decision: ${A.shipOpenP1} Add exactly these shortcut comments, each directly above the code it names, with NO behaviour change and NO user-facing string: ${J(A.shipOpenP1Markers)}. If an accuracy test quotes a shifted line, re-point it by content (never weaken it). Run typecheck, lint and the touched files' tests. ${EDIT_NOTE} Commit via ${GL} commit --cwd ${LANE} --base ${BASE} -m "<summary>" (message ending with the trailer line "${TRAILER}"; report a refusal verbatim). Return: head, files, tests.`, { label: `${UNIT} shortcut markers`, phase: 'Ship', model: 'claude-opus-5-5', effort: 'high' })
  }

  // /ship as a subagent reading ship/SKILL.md from disk; prepare (no push) -> fact-check -> publish (retro item 8)
  const shipModel = A.shipModel || (skip ? 'haiku' : 'claude-opus-5-5')
  const shipEffort = /haiku/.test(shipModel) ? 'max' : 'high'
  const gateLine = shippedOpen
    ? `Gate NOT clean (latest ${R}/gate-${U}-r*-consolidated.md); the operator ships anyway: ${A.shipOpenP1}`
    : `Gate ${g.verdict} (latest ${R}/gate-${U}-r*-consolidated.md)${g.verdict === 'DEGRADED' ? `; DEGRADED accepted by the operator: ${A.acceptDegraded}` : ''}.`
  // the repository is resolved BEFORE /ship prepare (lane origin remote), so prepare's base-branch lookups, the push, the
  // PR and every gh call target it (ghRule: no bare gh anywhere in the ship flow)
  const rid = await repoIdentity('ship', 'Ship')
  if (rid.why) return finish({ stopped: `BLOCKED: ${rid.why}`, final: cons, failure_class: 'error' })
  const prepP = `Ship ship-unit ${UNIT} from ${LANE}, branch ${BR}, part 1 of 2 (prepare). ${gateLine} Read ${SK}/ship/SKILL.md from disk and execute its flow against the repository's default branch (the branch ${BASE} came from), taking the recommended option wherever it would ask and listing those choices. Repository: ${rid.arg}. ${ghRule(rid)}${skip ? ` ${SHIP_SKIP} Do ONLY: merge the base branch, save the reviewed-tree snapshot, version bump, CHANGELOG entry, commit.` : ''} STOP before any push: do not push, do not create the PR (part 2 does that after the CHANGELOG fact-check). If merging the base branch conflicts beyond VERSION / CHANGELOG ordering, run git -C ${LANE} merge --abort and return status BLOCKED with merge_conflict true (an Opus 5.5 dispatch resolves it). Commit trailers "${TRAILER}". CHANGELOG prose states only what the code does. code_changed = true only when, because of a conflict resolution or an edit YOU made, a path's content now differs from the gated head ${gatedHead} (VERSION, CHANGELOG and .md/.txt/.rst prose excepted; any package.json change, a version bump included, counts); code that arrived cleanly from the base branch does not count.${opt(A.shipExtra, x => ' ' + x)} Do not merge. Return the envelope (status COMMITTED or BLOCKED; head; version; code_changed; changed_files; decisions_auto_taken;${skip ? ' reviewed_tree = the gstack-wtree output you saved;' : ''} failure_class when BLOCKED).`
  let prep = await callChain(`${UNIT} /ship prepare`, uniq([shipModel, skip ? 'sonnet' : 'claude-opus-4-8']), prepP, { label: `${UNIT} /ship prepare`, phase: 'Ship', effort: shipEffort, schema: SHIPPREP })
  if (prep.r && prep.r.status === 'BLOCKED' && prep.r.merge_conflict && prep.model !== 'claude-opus-5-5') { // the skill: Opus 5.5 when /ship must resolve a merge conflict
    incidents.push({ step: `${UNIT} /ship prepare`, class: 'merge_conflict', note: 'base merge conflicted; re-dispatched on claude-opus-5-5' })
    prep = await callChain(`${UNIT} /ship prepare (conflict)`, ['claude-opus-5-5', 'claude-opus-4-8'], `${prepP} The base merge conflicted on the previous attempt (merge_conflict): resolve every conflict preserving both sides' intent, re-run typecheck and the affected tests, and set code_changed true.`, { label: `${UNIT} /ship prepare (merge conflict)`, phase: 'Ship', effort: 'high', schema: SHIPPREP })
  }
  if (!prep.r || prep.r.status !== 'COMMITTED') return finish({ stopped: `BLOCKED: /ship prepare ${prep.r ? 'BLOCKED: ' + (prep.r.notes || '') : 'failed'}`, failure_class: (prep.r && prep.r.failure_class) || prep.class || 'error', final: cons })
  // the skip list replaces "Bind the reviews" with the reviewed-tree snapshot; without it "Verification Gate" cannot compare
  if (skip && !/^[0-9a-f]{40}([0-9a-f]{24})?$/.test(String(prep.r.reviewed_tree || ''))) return finish({ stopped: `BLOCKED: /ship prepare did not save the reviewed-tree snapshot (gstack-wtree), which replaces "Bind the reviews"`, final: cons, ship: prep.r, failure_class: 'error' })
  // ruling R4: the file inventory is evidence; a missing one blocks (never an empty list that suppresses review).
  // It lists /ship's OWN changes: paths that differ from the gated head AND from the upstream side of /ship's base merge
  // (upstream-only files merged in are not /ship's change). Any package.json change is code (no version-only exemption).
  const flP = `Rote /ship change inventory for ${UNIT}. Write this block verbatim to a temp file with a quoted heredoc, run it with bash (G=${gatedHead} L=${LANE} bash <file>) and copy its output: head = the HEAD line, snap_tree = the SNAP line, files = every FILE line's path ([] when none). An ERROR line, or a non-zero exit: return head "ERROR".
${INV_SH}`
  const flr = await ask(flP, { label: 'ship delta files', phase: 'Ship', model: 'haiku', effort: 'low', schema: FILES })
  const fl = flr && SHA_RE.test(String(flr.head || '')) && Array.isArray(flr.files) && /^[0-9a-f]{40}([0-9a-f]{24})?$/.test(String(flr.snap_tree || '')) ? flr : null
  if (!fl) return finish({ stopped: 'BLOCKED: /ship delta file inventory unreadable; publication needs positive evidence of what /ship changed', final: cons, failure_class: 'error' })
  const flb = badPaths(fl, ['files'], '/ship delta inventory')
  if (flb) return finish({ stopped: `BLOCKED: ${flb}`, final: cons, failure_class: 'error' })
  // the reviewed-tree snapshot is BOUND to the gated tree: it must equal the tree of /ship's base-merge commit (or of the
  // gated head when the base merge was a no-op), i.e. gated code + reviewed merge changes only
  if (skip && prep.r.reviewed_tree !== fl.snap_tree) return finish({ stopped: `BLOCKED: reviewed-tree snapshot ${prep.r.reviewed_tree} is not the merged gated tree ${fl.snap_tree}`, final: cons, ship: prep.r, failure_class: 'error' })
  const notBookkeeping = f => !BOOKKEEP_RE.test(f)
  const codeChanged = !!prep.r.code_changed || fl.files.some(notBookkeeping)
  const scope = fl.files.filter(notBookkeeping)
  // contradictory evidence: /ship says it changed code but the inventory finds no code path to review
  if (codeChanged && !scope.length) return finish({ stopped: 'BLOCKED: /ship reports code_changed but the inventory lists no code path; the delta review would review nothing', final: cons, ship: prep.r, failure_class: 'error' })
  let shipDelta = null
  if (codeChanged) { // a code change /ship made gets the item-1 scoped delta review; it needs an explicit PASS (ruling R4)
    const dc = await deltaChecked('ship', gatedHead, fl.head, [], 'the commits /ship added after the gated head', '/ship changed code after the gated head', scope)
    if (dc.outcome === 'FAILED') return finish({ stopped: `BLOCKED: ship delta review failed (${dc.class})`, failure_class: dc.class, final: cons })
    if (dc.outcome === 'INCOMPLETE') return finish({ stopped: `BLOCKED: ship delta review incomplete twice (${dc.r.notes || 'no reason given'})`, failure_class: 'error', final: cons, ship_delta: dc.r })
    shipDelta = dc.r
    if (dc.outcome === 'P1') return finish({ stopped: `ship-born [P1] in the /ship delta: ${arr(dc.r.p1).join(' | ')}`, final: cons, ship_delta: dc.r, decision: `${UNIT}: /ship introduced a [P1]; fix it (PATCH-style) before publishing?` })
    if (!(await appendHardening('ship delta', `${LID}-S`, p2Items(dc.r, 'integration')))) return finish({ stopped: 'BLOCKED: ship-delta P2 follow-ups not written to hardening.json', final: cons, ship_delta: dc.r })
  }
  const fc = await factCheck('ship', gatedHead, true)
  if (!fc.r || fc.r.verdict !== 'CLEAN') return finish({ stopped: `BLOCKED: CHANGELOG fact-check not CLEAN (${fc.r ? fc.r.verdict : fc.class})`, final: cons, factcheck: fc.r, failure_class: fc.r ? 'error' : fc.class })
  // ruling R9: the guard scan over every commit of the unit (incl. /ship's commits and the fact-check amend) before the push;
  // after the reviewed head only prose / release bookkeeping may have changed.
  const gd = await prePushGuard('ship', BASE, fl.head, skip ? prep.r.reviewed_tree : '')
  if (!gd.ok) return finish({ stopped: `BLOCKED: pre-push guard: ${gd.why}`, final: cons, failure_class: 'guard' })
  // the pushed tree vs the saved reviewed tree (stands in for "Verification Gate" stage 2): only the release bookkeeping
  // the fact-check covered (VERSION, prose) or a path the ship-delta review PASSED (e.g. the package.json version bump) may differ
  const treeLate = skip ? gd.g.tree_delta.filter(f => notBookkeeping(f) && !(shipDelta && scope.includes(f))) : []
  if (treeLate.length) return finish({ stopped: `BLOCKED: the head to push differs from the reviewed tree ${prep.r.reviewed_tree} beyond release bookkeeping: ${showPaths(treeLate)}`, final: cons })
  const lateCode = gd.g.files_since.filter(f => !BOOKKEEP_RE.test(f))
  if (lateCode.length) return finish({ stopped: `BLOCKED: unreviewed change after the reviewed head ${fl.head}: ${showPaths(lateCode)}`, final: cons })
  const pushHead = gd.g.head
  // the unit script pushes and verifies the push over the forge API; /ship publish only creates the PR and binds CI
  const ip = await pushAndVerify('ship', 'Ship', rid, pushHead)
  if (!ip.ok) return finish({ stopped: `BLOCKED: ${ip.why}`, final: cons, push: ip.res, failure_class: 'error' })
  const pubP = `Ship ship-unit ${UNIT} from ${LANE}, branch ${BR}, part 2 of 2 (publish). Continue the /ship flow of ${SK}/ship/SKILL.md after its push and do nothing else: the unit script has ALREADY pushed exactly ${pushHead} to ${BR} of ${rid.arg} (skip "Push"; never run git push yourself); create the PR against the default branch of ${rid.arg}, bind CI. ${ghRule(rid)} Make no new commit.${skip ? ' ' + SHIP_SKIP : ''} PR body ends with "${PR_FOOTER}" and names: ship-unit ${UNIT}, tasks ${IDS.join(', ') || '(prebuilt)'},${opt(A.shipNotes, x => ' ' + x)} the gate verdict ${g.verdict} with members_present ${J(cons.members_present)}, the full gate rounds ${J(rounds.filter(x => x.round).map(x => `r${x.round}:${x.verdict} ${x.members}`))} (delta reviews are not rounds; note every substitution and ABSENT member), and the deferred ledger ids: ${String(ledger.r).trim()}.${shippedOpen ? ' The PR body MUST carry a "Known issues (shipped open)" section naming each kept P1, its ledger id and its upgrade trigger.' : ''}${opt(A.shipExtra, x => ' ' + x)} Do NOT merge. Return the envelope: status PUBLISHED only when the PR exists for ${BR} at head ${pushHead}; otherwise status BLOCKED with notes = the failing command's name and one error code (http_404, http_401, http_403, network, auth or other; never raw error text, which can carry URLs); pr_number; head = git -C ${LANE} rev-parse HEAD.`
  const pub = await callChain(`${UNIT} /ship publish`, uniq([shipModel, skip ? 'sonnet' : 'claude-opus-4-8']), pubP, { label: `${UNIT} /ship publish`, phase: 'Ship', effort: shipEffort, schema: PUB })
  if (!pub.r) return finish({ stopped: `BLOCKED: /ship publish failed (${pub.class})`, failure_class: pub.class, final: cons })
  // ruling R4: publication needs an explicit success token; a BLOCKED / failed push never counts, even if a PR exists
  if (pub.r.status !== 'PUBLISHED' || pub.r.head !== pushHead) return finish({ stopped: `BLOCKED: /ship publish not confirmed (status ${pub.r.status}, head ${pub.r.head || '?'}, expected ${pushHead}): ${pub.r.notes || ''}`.slice(0, 400), ship: pub.r, final: cons, failure_class: 'error' })
  // PR identity (parity with PATCH): the PR number the publish step returned, verified in the run's repository by
  // GHX pr view --repo <slug> (slug from the lane's origin remote via repoIdentity, exactly as patchFlow): OPEN, same-repo head, head branch == BR, head SHA == pushed
  // head. Any mismatch or gh failure -> BLOCKED before the PR is recorded or its CI is awaited.
  const prn = Number(pub.r.pr_number)
  if (!(prn > 0)) return finish({ stopped: 'BLOCKED: /ship publish returned no PR number', ship: pub.r, final: cons, failure_class: 'error' })
  const prl = await ask(`Rote PR identity check for ${UNIT}. Write the block below verbatim to a temp file with a quoted heredoc and run it with: N=${prn} X=${shq(rid.arg)} bash <file> (then delete the file). Run no other command. line = its one PR line, verbatim.${opt(A.shipAttempt, a => ` (ship attempt ${a})`)}
${PRV_SH}`, { label: 'find PR', phase: 'Ship', model: 'haiku', effort: 'low', schema: LINE })
  const pr = prLine(prl)
  if (!pr) return finish({ stopped: `BLOCKED: PR #${prn} identity check did not report a PR line`, ship: pub.r, final: cons, failure_class: 'error' })
  const slug = rid.slug
  const prWhy = Number(pr.pr) !== prn ? `gh pr view returned #${pr.pr || 0}, not the published #${prn}${pr.notes ? ' (' + pr.notes + ')' : ''}`
    : up1(pr.state) !== 'OPEN' ? `PR #${prn} is ${pr.state || 'unknown'}, not OPEN`
    : pr.cross_repo !== false || String(pr.head_repo || '').toLowerCase() !== slug ? `PR #${prn} head lives in ${pr.head_repo || 'unknown'} (cross_repo ${pr.cross_repo}), not ${slug}`
    : pr.head_ref !== BR ? `PR #${prn} head branch is ${pr.head_ref || 'unknown'}, not ${BR}`
    : pr.head !== pushHead ? `PR #${prn} head ${pr.head || 'unknown'} is not the guarded head ${pushHead}` : ''
  if (prWhy) return finish({ stopped: `BLOCKED: ${prWhy}`, ship: pub.r, final: cons, pr, failure_class: 'error' })
  // run ownership: record this unit's PR in state.json; a later PATCH proves the PR belongs to this run against it
  if (!(await writeState(`Ship: PR #${pr.pr}`, [], { prs: { [UNIT_DIR]: { pr: pr.pr, branch: BR, head: pushHead, repo: rid.arg } } }))) return finish({ stopped: `BLOCKED: PR #${pr.pr} published but not recorded in state.json prs (a later PATCH could not prove ownership); record it, then resume`, ship: pub.r, final: cons, pr, failure_class: 'error' })
  const ready = await ciWait(pr.pr, pushHead, rid.arg)
  return finish({ status: ready.status, stopped: ready.status === 'READY' ? undefined : `CI: ${ready.notes}${ready.checks ? ` (pass ${ready.checks.pass}, fail ${ready.checks.fail}, pending ${ready.checks.pending})` : ''}`, failure_class: ready.failure_class, integ, final: cons, ship: prep.r, ship_delta: shipDelta, factcheck: fc.r, pr, ready, gated_head: gatedHead, pushed_head: pushHead })
}

async function unitFlow() {
  // a critical gate (T3-containing or the FINAL milestone) never runs as LITE, and its gate always runs Docker
  // (the skill: "the FINAL milestone's gate always runs Docker")
  if (GATE_CLASS === 'critical') upgrade('critical gate (T3-containing or FINAL): never LITE; Docker always runs', 0)
  if (flow === 'LITE') {
    const hi = TASKS.filter(t => !isLow(t)).map(t => `${t.id}:${tierOf(t)}`)
    if (hi.length) upgrade(`T2/T3 task(s) ${hi.join(', ')}`, 0)
  }
  for (const t of TASKS) { // rule 1 tier guard, recorded before anything is dispatched
    const g = tierGuard(t)
    if (g.refused) { incidents.push({ step: `route ${t.id}`, class: 'override_refused', note: `${tierOf(t)} task: model override ${g.refused} refused (no Sonnet / Haiku / Luna for T2/T3); tier default ${routeDesc(t)}` }); say(`${t.id}: model override ${g.refused} refused for ${tierOf(t)}`) }
  }
  enter('Refresh')
  await writeState('Refresh')
  let refresh = { status: 'PREBUILT', tasks: [] }
  if (!has(A.prebuilt)) {
    const c = await callChain(`refresh ${UNIT}`, synChain(synFirst(1, 1)), refreshPrompt(), { label: `refresh ${UNIT}`, phase: 'Refresh', effort: 'high', schema: REFRESH })
    if (!c.r) return finish({ stopped: `BLOCKED: brief refresh failed (${c.class})`, failure_class: c.class })
    refresh = c.r
    for (const t of arr(refresh.tasks)) refreshTasks[t.id] = t
    if (refresh.status !== 'READY' || refresh.disjoint === false || refresh.baseline === 'RED') {
      return finish({ stopped: `refresh not ready (status ${refresh.status}, disjoint ${refresh.disjoint}, baseline ${refresh.baseline})`, refresh, decision: `${UNIT}: brief refresh found ${J(arr(refresh.open_issues))}` })
    }
  }

  enter('Build')
  await writeState('Build')
  const built = {}
  let meterStop = null
  if (!has(A.prebuilt)) {
    for (let wi = 0; wi < WAVES.length; wi++) {
      const w = await runWave(wi)
      if (w.stop) return finish(Object.assign({ refresh, built }, w.stop))
      Object.assign(built, w.built)
      if (wi === WAVES.length - 1) break // the Integrate reading below is the authoritative one
      // the skill's mid-milestone SHIP_METER check: meter after each wave; at the cap stop dispatching feature waves
      const mt = await waveMeter(wi)
      if (!mt) return finish({ stopped: `SHIP_METER STOP: the meter failed after wave ${wi + 1} (a broken meter is a stop, never a 0-LOC reading)`, refresh, built, failure_class: 'error' })
      say(`SHIP_METER after wave ${wi + 1}: ${mt.prod} prod + ${mt.test} test`)
      if (mt.prod >= PROD_CAP) {
        meterStop = { after_wave: wi + 1, prod: mt.prod, test: mt.test, unbuilt_waves: WAVES.slice(wi + 1).map(x => arr(x).map(t => t.id)) }
        say(`SHIP_METER: ${mt.prod} prod LOC >= ${PROD_CAP} after wave ${wi + 1}: no further feature waves; gate and checkpoint what is built`)
        // cut the unit's acceptance scope to the built work: the unbuilt tasks leave TASKS / IDS / OWNERS / BRIEFS (so no
        // reviewer, integrator or fix can demand them) and are queued as deferred in state.json for the next unit
        const cut = new Set(meterStop.unbuilt_waves.flat())
        const keep = (xs, k) => xs.splice(0, xs.length, ...xs.filter(x => !cut.has(k(x))))
        keep(TASKS, t => t.id); keep(IDS, x => x); keep(OWNERS, x => x)
        for (const id of cut) delete refreshTasks[id]
        BRIEFS = IDS.map(id => `${B}/${id}.md`).join(', ')
        meterStop.deferred_tasks = [...cut]
        if (!(await writeState(`Build: meter stop after wave ${wi + 1}`, [`${UNIT}: tasks ${[...cut].join(', ')} deferred by the mid-milestone SHIP_METER stop; plan them into the next unit`], { deferred_tasks: { [UNIT_DIR]: [...cut] } }))) {
          return finish({ stopped: `BLOCKED: the deferred tasks of the meter stop could not be recorded in state.json`, refresh, built, meter_stop: meterStop, failure_class: 'error' })
        }
        break
      }
      if (mt.prod >= PROD_WARN) say(`SHIP_METER WARNING: ${mt.prod} prod LOC after wave ${wi + 1} (warn ${PROD_WARN}, stop ${PROD_CAP})`)
    }
  }

  enter('Integrate')
  await writeState('Integrate')
  // retro-2026-10-19 item 6: SHIP_METER on production LOC, the skill's step-f meter (METER) + the R7 linear rule (LINEAR)
  const intP = `Unit verification for ${UNIT} (flow ${flow}) in lane ${LANE} (branch ${BR}: ${IDS.join(' + ') || 'prebuilt'}${opt(A.prebuilt, x => `; prebuilt: ${x}`)}). Unit rule: 0 typecheck errors, 0 red tests. Verify: any codegen step the project needs, typecheck, lint, every brief-named test${PRIV(DB, LANE)} ${CONC} ${flow === 'LITE' ? 'Targeted tests only: the briefs\' tests plus the tests of touched modules (no full suite).' : 'Migrations apply cleanly and idempotently on a fresh private database when the unit adds any; the FULL suite once (shards on fresh databases if needed).'} Record every check in checks[]. Fix only seams; commit seam fixes via ${GL} commit --cwd ${LANE} --base ${BASE} -m "<summary>" (message ending with the trailer line "${TRAILER}"; a refusal = RED with the lines in notes); a task's own bug = RED naming it. ${EDIT_NOTE} Size meter, run exactly: ${METER} — prod_loc and test_loc from its SHIP_METER line, loc = their sum; a "SHIP_METER FAIL" line or a non-zero exit = prod_loc -1 and test_loc -1 (never 0). linear: run exactly ${LINEAR} — linear = (LINEAR=true). files = git -C ${LANE} diff --name-only ${BASE}...HEAD plus git -C ${LANE} ls-files --others --exclude-standard. Write ${R}/${U}-integration.md. Return the envelope.`
  const ic = await callChain(`integrate ${UNIT}`, ['claude-opus-5-5', 'claude-opus-4-8'], intP, { label: `integrate ${UNIT}`, phase: 'Integrate', effort: 'high', schema: INT })
  const integ = ic.r
  if (!integ) return finish({ stopped: `BLOCKED: integration agent failed (${ic.class})`, failure_class: ic.class, refresh, built })
  if (integ.status !== 'GREEN') return finish({ stopped: 'integration RED', refresh, built, integ })
  if (!Number.isFinite(Number(integ.prod_loc)) || !Number.isFinite(Number(integ.test_loc)) || Number(integ.prod_loc) < 0 || Number(integ.test_loc) < 0 || !Array.isArray(integ.files) || typeof integ.linear !== 'boolean') return finish({ stopped: 'SHIP_METER STOP: the integration envelope lacks a meter reading, the file list or the linear flag (fail closed)', refresh, built, integ })
  const ib = badPaths(integ, ['files'], 'integration file list')
  if (ib) return finish({ stopped: `BLOCKED: ${ib}`, refresh, built, failure_class: 'error' })
  if (meterStop) integ.meter_stop = meterStop
  const prod = Number(integ.prod_loc), test = Number(integ.test_loc)
  integ.loc = prod + test
  say(`SHIP_METER: ${prod} prod + ${test} test`)
  if (test >= TEST_WARN) say(`SHIP_METER WARNING: ${test} test LOC (warn ${TEST_WARN}; never a stop)`)
  if (prod >= PROD_CAP) {
    if (integ.linear && prod <= PROD_LINEAR_CAP) {
      integ.meter_exception = `${prod} prod LOC >= ${PROD_CAP} on a green linear branch (<= +20%): gated as one unit; the orchestrator records the reason`
      say(`SHIP_METER: ${integ.meter_exception}`)
    } else return finish({ stopped: `SHIP_METER STOP: ${prod} prod LOC >= ${PROD_CAP}${integ.linear ? ` (+20% band ends at ${PROD_LINEAR_CAP})` : ' (branch not linear: a base-branch merge after the ship base)'}`, integ, meter_stop: meterStop, decision: `${UNIT}: ${prod} production LOC over the cap: split at a pre-agreed boundary or accept?` })
  } else if (prod >= PROD_WARN) say(`SHIP_METER WARNING: ${prod} prod LOC (warn ${PROD_WARN}, stop ${PROD_CAP})`)
  if (flow === 'LITE') { // v1.8 decision D-E: LITE = <= liteLocCap prod LOC, T0/T1 only, no sensitive path
    if (prod > LITE_CAP) upgrade(`${prod} prod LOC > LITE cap ${LITE_CAP}`, 0)
    const sens = sensitiveFiles(integ.files)
    if (sens.length) upgrade(`sensitive path(s) ${showPaths(sens.slice(0, 5))}`, 0)
  }

  const g = await gateLoop()
  if (g.stop) return finish(Object.assign({ refresh, built, integ }, g.stop))
  return shipPhase(g, integ)
}

// ---------- PATCH flow (v1.8 decision D-E) -----------------------------------------------------------
// Fails closed (ruling R4): the PR must be OPEN on this branch; the delta review / fact-check must PASS / be CLEAN;
// the guard scan and the push must succeed; CI is bound to the exact pushed SHA.
async function patchFlow() {
  enter('Fix')
  await writeState('PATCH fix')
  const N = A.prNumber
  const fixes = arr(A.extraFixes).map(f => Object.assign({ severity: 'P2', checks: [] }, f))
  if (!fixes.length) return finish({ stopped: 'PATCH needs extraFixes [{owner, item}]' })
  // rule 1 in PATCH: a fix is routed by its owner task's tier; an owner that is not a task of `waves` must carry its own
  // `tier` (and optionally impl/model), else the unit stops (never a silent Haiku fix of T2/T3 code)
  // `integration` is no exception: it is a sentinel, not a task, so it needs a tier like any other non-wave owner
  const rankT = x => Number(String(x).slice(1))
  for (const f of fixes) {
    if (IDS.includes(f.owner)) continue
    const tier = String(f.tier || '').toUpperCase()
    if (!/^T[0-3]$/.test(tier)) return finish({ stopped: `BLOCKED: PATCH fix owner ${J(f.owner || null)} is not a task of waves and carries no tier (T0-T3); routing would be a guess` })
    const id = String(f.owner)
    const prevT = byId[id]
    if (!prevT || rankT(tier) > rankT(prevT.tier)) byId[id] = { id, tier, impl: f.impl === 'codex' ? 'codex' : 'claude', model: f.model, effort: f.effort } // several fixes: the highest tier wins
    if (!OWNERS.includes(id)) OWNERS.splice(OWNERS.length - 1, 0, id)
  }
  // repository identity: the slug comes from the lane's origin remote (repoIdentity; never gh repo view, which GH_REPO /
  // GH_HOST can redirect), the run repo's origin must name the same repository, every gh call is GHX ... --repo <slug>,
  // and the PR's head must live in it (not a fork that happens to use the same branch name)
  const rid = await repoIdentity(`PATCH #${N}`, 'Fix')
  if (rid.why) return finish({ stopped: `BLOCKED: PATCH repository identity unverified: ${rid.why}`, failure_class: 'error' })
  const stl = await ask(`PATCH setup for PR #${N} (${UNIT}). Write the block below verbatim to a temp file with a quoted heredoc and run it with: RUN=${shq(RUN)} K=${shq(UNIT_DIR)} N=${N} X=${shq(rid.arg)} L=${shq(LANE)} B=${shq(BR)} bash <file> (then delete the file). Run no other command. line = its one SETUP line, verbatim.
${PSETUP_SH}`, { label: `PATCH #${N} setup`, phase: 'Fix', model: 'haiku', effort: 'low', schema: LINE })
  const st = setupLine(stl)
  if (!st) return finish({ stopped: 'BLOCKED: PATCH setup did not report a SETUP line', failure_class: 'error' })
  if (/^api_error:/.test(st.reason)) return finish({ stopped: `BLOCKED: PATCH setup: gh pr view failed (${st.reason})`, failure_class: 'error' })
  if (/^invalid_field:/.test(st.reason)) return finish({ stopped: `BLOCKED: PATCH setup: ${st.reason.slice(14)} has a character outside its allowlist (rejected, never rewritten)`, failure_class: 'error' })
  const slug = rid.slug
  // run ownership: the PR must be the one this run recorded for this unit when it shipped (state.json prs)
  if (Number(st.recorded_pr) !== Number(N) || st.recorded_branch !== BR) return finish({ stopped: `BLOCKED: PR #${N} is not recorded as ${UNIT}'s PR in ${RUN}/state.json (recorded: #${st.recorded_pr || 'none'} on ${st.recorded_branch || 'none'}); PATCH only fixes this run's own PRs` })
  if (st.cross_repo !== false || String(st.head_repo || '').toLowerCase() !== slug) return finish({ stopped: `BLOCKED: PR #${N} head lives in ${st.head_repo || 'unknown'} (cross_repo ${st.cross_repo}), not the run's repository ${slug}` })
  if (up1(st.state) !== 'OPEN') return finish({ stopped: `BLOCKED: PR #${N} is ${st.state || 'unknown'}, not OPEN`, decision: up1(st.state) === 'MERGED' ? `${UNIT}: PR #${N} is merged; a fix to a merged PR is a new unit (LITE or the hardening batch)` : undefined })
  if (st.head_ref !== BR) return finish({ stopped: `BLOCKED: PR #${N} head branch is ${st.head_ref || 'unknown'}, not ${BR}` })
  if (!SHA_RE.test(String(st.head || '')) || st.head !== st.remote_head) return finish({ stopped: `BLOCKED: PATCH lane not ready (${st.head || 'no head'}; ${st.reason})` })
  const from = st.head
  const findings = `the PATCH request for PR #${N}${opt(A.context, x => `: ${x}`)}`
  const fx = await fixPass(fixes, 'patch', findings, 'Fix')
  if (fx.stop) return finish(fx.stop)
  const hf = await headFiles('PATCH delta files', from, 'Fix')
  if (!hf) return finish({ stopped: 'BLOCKED: PATCH delta file inventory unreadable', failure_class: 'error' })
  if (hf.bad) return finish({ stopped: `BLOCKED: ${hf.bad}`, failure_class: 'error' })
  const files = hf.files
  if (!files.length) return finish({ stopped: 'PATCH produced no change' })
  const sens = sensitiveFiles(files)
  if (sens.length) return finish({ stopped: `PATCH escalates to a full re-round: the delta touches sensitive path(s) ${showPaths(sens)}`, escalate: 'FULL', decision: `${UNIT}: PATCH on PR #${N} touches a sensitive path; run a full gate round` })
  let review = null
  if (files.every(f => PROSE_RE.test(f))) { // prose-only delta (by extension): Haiku fact-check instead of a delta review
    const fc = await factCheck('patch', from, false)
    if (!fc.r || fc.r.verdict !== 'CLEAN') return finish({ stopped: `BLOCKED: PATCH fact-check not CLEAN (${fc.r ? fc.r.verdict : fc.class})`, failure_class: fc.r ? 'error' : fc.class, factcheck: fc.r })
    review = { factcheck: fc.r }
  } else {
    const dc = await deltaChecked('patch', from, hf.head, uniq(fixes.flatMap(f => arr(f.mutants))), findings, 'PATCH delta')
    if (dc.outcome === 'FAILED') return finish({ stopped: `BLOCKED: PATCH delta review failed (${dc.class})`, failure_class: dc.class })
    if (dc.outcome === 'INCOMPLETE') return finish({ stopped: `BLOCKED: PATCH delta review incomplete twice (${dc.r.notes || 'no reason given'})`, failure_class: 'error', delta: dc.r })
    review = { delta: dc.r }
    if (dc.outcome === 'P1') return finish({ stopped: `PATCH escalates to a full re-round: the delta review kept [P1]: ${arr(dc.r.p1).join(' | ')}`, escalate: 'FULL', delta: dc.r, decision: `${UNIT}: PATCH delta kept a [P1]; run a full gate round` })
    if (!(await appendHardening(`PATCH #${N} delta`, `${LID}-P${safe(N)}-`, p2Items(dc.r, fixes[0].owner)))) return finish({ stopped: 'BLOCKED: PATCH-delta P2 follow-ups not written to hardening.json', review })
  }
  enter('Ship')
  if (!(await writeState('PATCH push'))) return finish({ stopped: 'BLOCKED: state.json write failed at the PATCH push boundary; nothing pushed', review, failure_class: 'error' })
  const gd = await prePushGuard('PATCH', from, hf.head)
  if (!gd.ok) return finish({ stopped: `BLOCKED: pre-push guard: ${gd.why}`, review, failure_class: 'guard' })
  const late = gd.g.files_since.filter(f => !PROSE_RE.test(f))
  if (late.length) return finish({ stopped: `BLOCKED: unreviewed change after the reviewed head ${hf.head}: ${showPaths(late)}`, review })
  const want = gd.g.head
  const ip = await pushAndVerify(`PATCH #${N}`, 'Ship', rid, want)
  if (!ip.ok) return finish({ stopped: `BLOCKED: PATCH ${ip.why}`, review, push: ip.res, failure_class: 'error' })
  const ready = await ciWait(N, want, rid.arg)
  return finish({ status: ready.status, stopped: ready.status === 'READY' ? undefined : `CI: ${ready.notes}${ready.checks ? ` (pass ${ready.checks.pass}, fail ${ready.checks.fail}, pending ${ready.checks.pending})` : ''}`, failure_class: ready.failure_class, pr: N, head: want, review, ready })
}
const up1 = x => String(x || '').toUpperCase()

// plain-name rule + git check-ref-format --branch rules (no component starting with '.' or ending in '.lock', no '..',
// no '//' or trailing '/', no trailing '.', no '@{', not 'HEAD', not starting with '-')
const branchOk = b => /^[A-Za-z0-9._][A-Za-z0-9._/-]*$/.test(b) && b !== 'HEAD' && !/\.\.|\/\/|\/$|\.$|@\{/.test(b) && b.split('/').every(c => c.length > 0 && !c.startsWith('.') && !c.endsWith('.lock'))
const SAFE_PATH = /^\/[A-Za-z0-9_.\/+@%,=-]*$/ // no ':' either, so no scheme:// or user:pass@ can hide in a path
// Tokens that end up in shell commands: base (a full commit SHA, as documented), unit and task / owner ids, model and
// effort names, prNumber, the attempt counters, privtest (an absolute command path). Prose args (context, gateFocus,
// notes, decisions) are instructions to agents, never interpolated into a command line by this script.
const ID_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/, MODEL_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/
const EFFORTS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']
function argProblem() {
  if (!SHA_RE.test(String(A.base))) return `base must be a full 40-hex commit SHA`
  if (!ID_TOKEN.test(String(A.unit))) return `unit must be a plain id (letters, digits, . _ -)`
  if (FLOW_REQ === 'PATCH' && !/^[1-9][0-9]{0,8}$/.test(String(A.prNumber))) return `prNumber must be a positive integer`
  for (const k of ['gateAttempt', 'shipAttempt', 'maxRounds', 'extraFixRound', 'liteLocCap']) if (has(A[k]) && !/^[0-9]{1,6}$/.test(String(A[k]))) return `${k} must be a small non-negative integer`
  if (has(A.privtest) && !SAFE_PATH.test(String(A.privtest))) return `privtest must be an absolute command path`
  for (const k of ['synModel', 'deltaModel', 'shipModel', 'seatCModel', 'seatXModel']) if (has(A[k]) && !MODEL_TOKEN.test(String(A[k]))) return `${k} must be a plain model id`
  const jobs = TASKS.map(t => ['waves task', t]).concat(arr(A.extraFixes).map(f => ['extraFixes owner', { id: f && f.owner, model: f && f.model, effort: f && f.effort, impl: f && f.impl }]))
  for (const [what, t] of jobs) {
    if (!t || !ID_TOKEN.test(String(t.id))) return `${what} id must be a plain id`
    if (has(t.model) && !MODEL_TOKEN.test(String(t.model))) return `${what} model must be a plain model id`
    if (has(t.effort) && !EFFORTS.includes(String(t.effort))) return `${what} effort must be one of ${EFFORTS.join('|')}`
    if (has(t.impl) && !['claude', 'codex'].includes(String(t.impl))) return `${what} impl must be claude or codex`
  }
  return ''
}
// every result, early stops included, leaves the script scrubbed
async function main() { return scrubOut(await runUnit()) }
// validation failures name the arg and the rule, never the rejected value (it may hold a credential)
async function runUnit() {
  const missing = REQUIRED.filter(k => !has(A[k]))
  if (missing.length) return { status: 'STOPPED', stopped: `missing required args: ${missing.join(', ')}` }
  if (!['FULL', 'LITE', 'PATCH'].includes(FLOW_REQ)) return { status: 'STOPPED', stopped: `flow must be FULL, LITE or PATCH` }
  // the branch name goes into shell commands and API paths: a plain name that ALSO passes git check-ref-format --branch
  // (mirrored here so the unit stops before any work; PUSH_SH re-checks it with git itself before pushing)
  if (!branchOk(String(BR))) return { status: 'STOPPED', stopped: `branch must be a plain, valid git branch name (letters, digits, . _ / -; git check-ref-format --branch rules)` }
  // every path arg is interpolated into shell commands: absolute and free of whitespace, quotes and shell metacharacters
  const badPath = ['runDir', 'lane', 'repo', 'briefsDir', 'reportsDir'].find(k => !SAFE_PATH.test(String(A[k])))
  if (badPath) return { status: 'STOPPED', stopped: `${badPath} must be an absolute path of letters, digits and / . _ - + @ % , = only` }
  // every other arg that reaches a shell command or a command-shaped prompt line is validated here, before ANY dispatch
  const badArg = argProblem()
  if (badArg) return { status: 'STOPPED', stopped: `invalid argument: ${badArg}` }
  if (has(A.seatXModel) && A.seatXModel !== 'gpt-6-astra') return { status: 'STOPPED', stopped: `seatXModel must be gpt-6-astra: Seat X always starts on Astra; Sol only substitutes under ruling R1` }
  if (!['ordinary', 'critical'].includes(GATE_CLASS)) return { status: 'STOPPED', stopped: `gateClass must be ordinary or critical` }
  if (FLOW_REQ === 'PATCH') {
    if (!has(A.prNumber)) return { status: 'STOPPED', stopped: 'PATCH flow needs prNumber' }
    return patchFlow()
  }
  if (!WAVES.length && !has(A.prebuilt)) return { status: 'STOPPED', stopped: 'FULL/LITE flow needs waves (or prebuilt)' }
  return unitFlow()
}

// The Workflow runtime wraps the body in an async function (acorn: allowReturnOutsideFunction), so the unit's
// result is returned from the top level here. It is the only top-level return in this file.
return await main()
