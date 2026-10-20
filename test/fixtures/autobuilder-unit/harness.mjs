// Mock harness for autobuilder-loop/autobuilder-unit.js: runs the workflow body with a fake agent() and asserts
// per-scenario expectations. The repository-identity step runs the script's REAL ID_SH block against scratch git
// repositories (lib.mjs realIdentity), and every scenario also asserts that no configured remote URL reaches any prompt
// or the result (Astra r12 finding 2).
// Library: import { scenarios, runScenario, runAll } from './harness.mjs'
// CLI:     node harness.mjs [script] [scenario] [v]
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadScript, shellBlock, realIdentity, SHA, DEFAULT_SCRIPT, fake } from './lib.mjs'
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
const ID = spec => ({ __id: spec }) // an identity spec: run the real ID_SH against scratch repos configured from it
const DEFAULT_ID = { repo_url: 'git@github.com:acme/app.git', lane_url: 'https://github.com/acme/app', push_urls: [] }
const rangeEnd = p => { const m = String(p).match(/RANGE=([0-9a-f]{40})\.\.([0-9a-f]{40})/); return m ? m[2] : '' }
const expHead = p => { const m = String(p).match(/ H=([0-9a-f]{40}) /); return m ? m[1] : '' }

const PRV = { repo_slug: 'acme/app', lane_slug: 'acme/app', pr: 12, state: 'OPEN', cross_repo: false, head_repo: 'acme/app', head_ref: 'feat/u1', head: SHA('f'), title: 't' }
const PRL = o => ({ line: `PR exit=0 number=${o.pr} state=${o.state} cross=${o.cross_repo} head_repo=${o.head_repo} head_ref=${o.head_ref} head=${o.head}` })
const SETL = o => ({ line: `SETUP recorded_pr=${o.recorded_pr} recorded_branch=${o.recorded_branch || 'none'} state=${o.state} cross=${o.cross_repo} head_repo=${o.head_repo} head_ref=${o.head_ref} head=${o.head} remote_head=${o.remote_head} reason=${o.reason || 'ok'}` })
const CIL = (status, head, reason = 'ci:pass', pass = 1, fail = 0, pending = 0) => ({ line: `CI status=${status} head=${head} reason=${reason} pass=${pass} fail=${fail} pending=${pending}` })
const PSET = { repo_slug: 'acme/app', lane_slug: 'acme/app', recorded_pr: 12, recorded_branch: 'feat/u1', state: 'OPEN', head_ref: 'feat/u1', cross_repo: false, head_repo: 'acme/app', head: SHA('1'), remote_head: SHA('1') }
const SEATC_OK = { member: 'seat_c', status: 'PRESENT', verdict: 'PASS', p1: [], final_line: 'REVIEW_COMPLETE: findings=0', actual_model: 'claude-fable-5-1' }
const SEATX_OK = { member: 'seat_x', status: 'PRESENT', verdict: 'PASS', class: 'ok', report: '/r.md', verdict_line: 'VERDICT=PRESENT_CLEAN reason=no_p1 p1_count=0 runtime_model=gpt-6-astra' }
const CONS_CLEAN = { verdict: 'CLEAN', members_present: { seat_c: 'PRESENT', seat_x: 'PRESENT' }, p1: [], fixes: [], deferred_p2: [{ finding: 'minor naming', owner: 'T-A' }], members: 'all' }
const CONS_P1 = { verdict: 'FAIL', members_present: { seat_c: 'PRESENT', seat_x: 'PRESENT' }, p1: ['bug'], fixes: [{ owner: 'T-A', item: 'fix bug', severity: 'P1', checks: [{ name: 'unit', command: 'bun test a' }] }], deferred_p2: [], members: 'x', new_p1: true }

function makeAgent(sc, calls, ctx) {
  const st = { headN: 1, gated: '' }
  return async (prompt, opts = {}) => {
    const L = opts.label || ''
    calls.push({ label: L, model: opts.model, effort: opts.effort, prompt })
    if (typeof prompt !== 'string' || /undefined|\[object Object\]/.test(prompt)) throw new Error(`prompt leak in: ${L}`)
    const o = sc.override && sc.override(L, opts, prompt, calls, st)
    let r = o !== undefined ? o : base(L, prompt)
    if (r && r.__id) { // the real ID_SH, run on scratch repos; the agent returns its stdout lines verbatim
      ctx.specs.push(r.__id)
      r = { lines: realIdentity(ctx.idsh, r.__id) }
      calls[calls.length - 1].output = r.lines.join('\n')
    }
    return r && typeof r === 'object' ? structuredClone(r) : r
  }
  function base(L, prompt) {
    if (L.startsWith('probe ')) return 'OK'
    if (L.startsWith('state:')) return 'ok'
    if (L.startsWith('refresh')) return { status: 'READY', disjoint: true, baseline: 'GREEN', tasks: [{ id: 'T-A', named_checks: [{ name: 'typecheck', command: 'bun run typecheck' }, { name: 'unit', command: 'bun test a' }], mutation_targets: ['m1'] }, { id: 'T-B', named_checks: [], mutation_targets: [] }] }
    if (/^wave \d+ base/.test(L)) return { head: SHA('a'), worktrees: (sc.wt || ['T-B']).map(id => ({ task: `u1-${id}`, path: `/run/wt/u1-${id}`, branch: `ab/run/u1-${id}`, base_sha: SHA('a') })) }
    if (/^wave \d+ meter/.test(L)) return { prod_loc: sc.waveProd || 100, test_loc: 10 }
    if (/^(build|fix|esc|spill)/.test(L)) return { status: 'DONE', head: SHA('b'), test_result: 'pass', checks: [{ name: 'typecheck', command: 'bun run typecheck', exit_code: 0 }, { name: 'unit', command: 'bun test a', exit_code: 0 }] }
    if (L.startsWith('merge wave')) return { status: 'GREEN', head: SHA('c') }
    if (L.startsWith('integrate')) return { status: 'GREEN', head: SHA('c'), prod_loc: sc.prod || 300, test_loc: 200, linear: sc.linear !== false, files: sc.files || ['src/a.ts'] }
    if (/gate start/.test(L) && /frozen SHA ([0-9a-f]{40})/.test(prompt)) { const fz = prompt.match(/frozen SHA ([0-9a-f]{40})/)[1]; st.gated = fz; return { guard_exit: 0, guard_lines: [], reviewed_sha: fz, files_since_base: sc.files || ['src/a.ts'], files_since_prev: [], rulings: 0 } }
    if (/gate start/.test(L)) { st.headN++; st.gated = SHA(String(st.headN % 10)); return { guard_exit: 0, guard_lines: ['no_changes=true'], reviewed_sha: st.gated, files_since_base: sc.files || ['src/a.ts'], files_since_prev: ['src/a.ts'], rulings: 0 } }
    if (/seat C/.test(L)) return SEATC_OK
    if (/seat X/.test(L)) return SEATX_OK
    if (/docker/.test(L)) return { member: 'docker', status: 'PRESENT', verdict: 'PASS' }
    if (/mutation/.test(L)) return { member: 'mutation', status: 'PRESENT', verdict: 'PASS' }
    if (/consolidate/.test(L)) return CONS_CLEAN
    if (/delta head/.test(L)) { st.gated = SHA('d'); return { head: SHA('d'), files: ['src/a.ts'] } }
    if (/delta review/.test(L)) return { verdict: 'PASS', p1: [], reviewed_sha: rangeEnd(prompt) }
    if (/hardening rows/.test(L)) return 'ok'
    if (/ledger/.test(L)) return 'U1-F1'
    if (L === 'gated head') return st.gated
    if (/\/ship prepare/.test(L)) return { status: 'COMMITTED', head: SHA('f'), code_changed: !!sc.codeChanged, reviewed_tree: SHA('e') }
    if (L === 'ship delta files') return { head: SHA('f'), files: sc.deltaFiles || ['CHANGELOG.md', 'VERSION'], snap_tree: SHA('e') }
    if (/fact-check/.test(L)) return { verdict: 'CLEAN', p1: [], doc_fixes: [], members: 'factcheck' }
    if (L === 'ship pre-push guard') return { exit_code: 0, lines: ['no_changes=true'], head: SHA('f'), files_since: [], tree_delta: ['VERSION', 'CHANGELOG.md'] }
    if (/\/ship publish/.test(L)) { const m = String(prompt).match(/pushed exactly ([0-9a-f]{40})/); return { status: 'PUBLISHED', pr_number: 12, head: m ? m[1] : '' } }
    if (L === 'find PR') return PRL(PRV)
    if (/^repo identity/.test(L)) return ID(sc.id || DEFAULT_ID)
    if (/ push$/.test(L) && /^Rote push for /.test(prompt)) { const m = String(prompt).match(/ S=([0-9a-f]{40}) /); st.pushed = m ? m[1] : 'none'; return { line: `PUSH exit=0 local=${st.pushed} reason=ok` } }
    if (/ verify push$/.test(L)) return { line: `API exit=0 ref=ok sha=${st.pushed || 'none'} reason=ok` }
    if (/wait CI/.test(L)) return CIL('READY', expHead(prompt))
    if (/PATCH #\d+ setup/.test(L)) return SETL(PSET)
    if (L === 'PATCH delta files') return { head: SHA('2'), files: sc.patchFiles || ['src/a.ts'] }
    if (L === 'PATCH pre-push guard') return { exit_code: 0, lines: ['no_changes=true'], head: SHA('2'), files_since: [] }
    throw new Error('unmocked label: ' + L)
  }
}

const baseArgs = { runDir: '/run', lane: '/lane', repo: '/repo', briefsDir: '/b', reportsDir: '/r', unit: 'U1', base: SHA('0'), branch: 'feat/u1', waves: [[{ id: 'T-A', impl: 'claude', model: 'haiku', tier: 'T1' }, { id: 'T-B', impl: 'codex', model: 'gpt-6.1-sol', tier: 'T2' }]] }
const PATCH = { flow: 'PATCH', prNumber: 12, extraFixes: [{ owner: 'T-A', item: 'CI fix', checks: [{ name: 'unit', command: 'bun test a' }] }] }
const has = (calls, re) => calls.some(c => re.test(c.label))
const count = (calls, re) => calls.filter(c => re.test(c.label)).length
const idx = (calls, re) => calls.findIndex(c => re.test(c.label))

const scenarios = {
  // ---- carried over from the v1 harness (expectations updated to the round-1 rules) ----
  cleanFull: { expect: (r, c) => r.status === 'READY' && r.pushed_head === SHA('f') },
  p1ThenP2: {
    override(L) {
      if (/r1 seat X/.test(L)) return Object.assign({}, SEATX_OK, { verdict: 'FAIL', verdict_line: 'VERDICT=PRESENT_P1 reason=p1_found p1_count=1 runtime_model=gpt-6-astra' })
      if (/r1 consolidate/.test(L)) return { verdict: 'FAIL', members_present: {}, p1: ['race in a.ts'], fixes: [{ owner: 'T-B', item: 'fix race', severity: 'P1', mutants: ['m9'], checks: [{ name: 'race', command: 'bun test race' }] }, { owner: 'T-A', item: 'rename', severity: 'P2', checks: [] }], deferred_p2: [], members: 'x', new_p1: true }
      if (/fix-r1 T-B/.test(L)) return { status: 'DONE', head: SHA('b'), test_result: 'pass', checks: [{ name: 'race', command: 'bun test race', exit_code: 0 }] }
      if (/r2 consolidate/.test(L)) return { verdict: 'CLEAN', members_present: {}, p1: [], fixes: [{ owner: 'integration', item: 'doc cite', severity: 'P2', checks: [] }], deferred_p2: [], members: 'x' }
    },
    expect: (r, c) => r.status === 'READY' && has(c, /r2-p2 delta review/) && !has(c, /r2 seat C/) && has(c, /r2 seat X/),
  },
  astraQuotaOrdinaryWaits: { // R1: no Sol after an Astra quota; ordinary gate waits without acceptDegraded
    override(L) { if (/seat X \(gpt-6-astra\)/.test(L)) return { member: 'seat_x', status: 'ABSENT', verdict: 'ABSENT', class: 'quota', reset_at: '2026-10-19T22:00:00Z' } },
    expect: (r, c) => r.status === 'BLOCKED' && r.wait_until === '2026-10-19T22:00:00Z' && !has(c, /seat X \(gpt-6\.1-sol\)/) && /\+ 2 min/.test(r.decision),
  },
  astraQuotaOrdinaryAccepted: {
    args: { acceptDegraded: 'operator: ordinary gates may close DEGRADED on a cooling Codex lane' },
    override(L) { if (/seat X \(gpt-6-astra\)/.test(L)) return { member: 'seat_x', status: 'ABSENT', verdict: 'ABSENT', class: 'quota', reset_at: 'x' } },
    expect: (r, c) => r.status === 'READY' && r.rounds[0].verdict === 'DEGRADED' && !has(c, /seat X \(gpt-6\.1-sol\)/),
  },
  astraTimeoutSol: {
    override(L) { if (/seat X \(gpt-6-astra\)/.test(L)) return { member: 'seat_x', status: 'ABSENT', verdict: 'ABSENT', class: 'timeout', verdict_line: 'VERDICT=ABSENT reason=timeout p1_count=0 runtime_model=null' } },
    expect: (r, c) => r.status === 'READY' && r.rounds[0].verdict === 'CLEAN' && /astra->sol \(timeout\)/.test(r.rounds[0].members),
  },
  astraErrorInvalidSol: {
    override(L) { if (/seat X \(gpt-6-astra\)/.test(L)) return { member: 'seat_x', status: 'INVALID', verdict: 'INVALID', class: 'error', verdict_line: 'VERDICT=INVALID reason=class_error' } },
    expect: (r, c) => r.status === 'READY' && has(c, /seat X \(gpt-6\.1-sol\)/),
  },
  astraAuthNoSol: {
    override(L) { if (/seat X \(gpt-6-astra\)/.test(L)) return { member: 'seat_x', status: 'ABSENT', verdict: 'ABSENT', class: 'auth' } },
    expect: (r, c) => r.status === 'STOPPED' && /DEGRADED/.test(r.stopped) && !has(c, /seat X \(gpt-6\.1-sol\)/),
  },
  codexDisabled: {
    override(L) { if (/seat X/.test(L)) return { member: 'seat_x', status: 'ABSENT', verdict: 'ABSENT', class: 'disabled' } },
    expect: (r, c) => r.status === 'STOPPED' && /DEGRADED/.test(r.stopped) && !has(c, /seat X \(gpt-6\.1-sol\)/),
  },
  codexDisabledCritical: {
    args: { gateClass: 'critical' },
    override(L) { if (/seat X/.test(L)) return { member: 'seat_x', status: 'ABSENT', verdict: 'ABSENT', class: 'disabled' } },
    expect: (r) => r.status === 'BLOCKED' && /codex_reviews is off/.test(r.decision) && !r.wait_until,
  },
  astraQuotaCritical: {
    args: { gateClass: 'critical' },
    override(L) { if (/seat X \(gpt-6-astra\)/.test(L)) return { member: 'seat_x', status: 'ABSENT', verdict: 'ABSENT', class: 'quota', reset_at: 'R' } },
    expect: (r, c) => r.status === 'BLOCKED' && r.wait_until === 'R' && !has(c, /seat X \(gpt-6\.1-sol\)/),
  },
  fableQuota: { override(L, o) { if (o.model === 'fable') return null }, expect: (r, c) => r.status === 'READY' && has(c, /r1 seat C \[claude-opus-5-5\]/) },
  seatCAllDown: {
    override(L, o) {
      if (/seat C \(L2/.test(L)) return { member: 'seat_c', status: 'ABSENT', verdict: 'ABSENT', class: 'quota' }
      if (/seat C/.test(L) && o.model !== 'haiku') return null
    },
    expect: (r) => r.status === 'STOPPED' && /DEGRADED/.test(r.stopped),
  },
  consolidatorDead: { override(L) { if (/consolidate/.test(L)) return null }, expect: (r) => r.status === 'BLOCKED' && /consolidator failed/.test(r.stopped) },
  haikuMissingCheck: {
    override(L) { if (L.startsWith('build T-A (haiku')) return { status: 'DONE', head: SHA('b'), test_result: 'pass', checks: [{ name: 'typecheck', command: 'bun run typecheck', exit_code: 0 }] } },
    expect: (r, c) => r.status === 'READY' && has(c, /esc-Build T-A \(l3 gpt-6\.1-sol\)/),
  },
  liteP1Upgrade: {
    args: { flow: 'LITE', waves: [[{ id: 'T-A', impl: 'claude', model: 'haiku', tier: 'T1' }]] }, wt: [],
    override(L) { if (/r1 consolidate/.test(L)) return CONS_P1 },
    expect: (r) => r.status === 'READY' && r.flow === 'FULL' && r.flow_upgrades.length === 1,
  },
  failAtCap: { args: { maxRounds: 1, autoFourth: false }, override(L) { if (/consolidate/.test(L)) return CONS_P1 }, expect: (r) => r.status === 'STOPPED' && /gate FAIL: 1 kept/.test(r.stopped) },
  degradedNoAccept: { override(L) { if (/docker/.test(L)) return { member: 'docker', status: 'ABSENT', verdict: 'ABSENT', class: 'error' } }, expect: (r) => r.status === 'STOPPED' && /DEGRADED/.test(r.stopped) },
  meterStop: { prod: 3500, expect: (r) => /SHIP_METER STOP/.test(r.stopped) },
  patchCode: { args: PATCH, expect: (r, c) => r.status === 'READY' && has(c, /patch delta review/) && r.head === SHA('2') },
  patchProse: { args: Object.assign({}, PATCH, { extraFixes: [{ owner: 'integration', item: 'CHANGELOG wording', tier: 'T1' }] }), patchFiles: ['CHANGELOG.md'], expect: (r, c) => r.status === 'READY' && has(c, /patch CHANGELOG fact-check/) && !has(c, /delta review/) },
  patchSensitive: { args: PATCH, patchFiles: ['src/auth/session.ts'], expect: (r) => r.escalate === 'FULL' },
  missingArgs: { args: { runDir: '' }, expect: (r) => r.status === 'STOPPED' && /missing required/.test(r.stopped) },

  // ---- R3: INVALID seats resolved before any cap / shipOpenP1 / DEGRADED path ----
  seatCNoMarker: {
    override(L) { if (/^r1 seat C/.test(L)) return Object.assign({}, SEATC_OK, { final_line: 'REVIEW_INCOMPLETE: could not read the diff' }) },
    expect: (r, c) => r.status === 'READY' && r.rounds[0].verdict === 'RERUN_INVALID' && has(c, /^r2 seat C/) && !has(c, /^r2 seat X/),
  },
  seatCCoercedModel: {
    override(L) { if (/^r1 seat C/.test(L)) return Object.assign({}, SEATC_OK, { actual_model: 'claude-sonnet-5-5' }) },
    expect: (r) => r.status === 'READY' && r.rounds[0].verdict === 'RERUN_INVALID',
  },
  seatCInvalidTwice: {
    override(L) { if (/seat C/.test(L)) return Object.assign({}, SEATC_OK, { final_line: '' }) },
    expect: (r) => r.status === 'BLOCKED' && /INVALID again/.test(r.stopped),
  },
  liteInvalidAtCap: { // LITE maxR=1: an INVALID seat extends the cap instead of BLOCKing (F12)
    args: { flow: 'LITE', waves: [[{ id: 'T-A', impl: 'claude', model: 'haiku', tier: 'T1' }]] }, wt: [],
    override(L) { if (/^r1 seat X/.test(L)) return Object.assign({}, SEATX_OK, { status: 'INVALID', verdict: 'INVALID', verdict_line: 'VERDICT=INVALID reason=no-completion-marker' }) },
    expect: (r, c) => r.status === 'READY' && r.flow === 'LITE' && has(c, /^r2 seat X/),
  },
  invalidWithKeptP1AtCap: { // kept P1 + INVALID seat at the cap: the INVALID seat is re-run at the SAME SHA before any fix / cap path
    args: { maxRounds: 1, autoFourth: false, shipOpenP1: 'ship anyway' },
    override(L) {
      if (/^r1 seat X/.test(L)) return Object.assign({}, SEATX_OK, { status: 'INVALID', verdict: 'INVALID', verdict_line: 'VERDICT=INVALID reason=stale_sha' })
      if (/r1 consolidate/.test(L)) return CONS_P1
    },
    expect: (r, c) => r.status === 'READY' && r.rounds[0].verdict === 'RERUN_INVALID' && has(c, /^r2 seat X/) && !has(c, /^r2 seat C/) && !has(c, /^fix-r1 /) && idx(c, /^r2 seat X/) < Math.max(0, idx(c, /^fix/)) + 1e9,
  },
  astraInvalidSolAbsent: { // Astra INVALID (error) + Sol ABSENT: INVALID stays (never DEGRADED)
    args: { acceptDegraded: 'policy' },
    override(L) {
      if (/^r1 seat X \(gpt-6-astra\)/.test(L)) return { member: 'seat_x', status: 'INVALID', verdict: 'INVALID', class: 'error', verdict_line: 'VERDICT=INVALID reason=class_error' }
      if (/^r1 seat X \(gpt-6\.1-sol\)/.test(L)) return { member: 'seat_x', status: 'ABSENT', verdict: 'ABSENT', class: 'timeout' }
    },
    expect: (r, c) => r.status === 'READY' && r.rounds[0].verdict === 'RERUN_INVALID' && r.rounds[0].members_present.seat_x === 'INVALID' && has(c, /^r2 seat X/),
  },
  astraInvalidSolAbsentTwice: { // ...and the same again on the re-run: BLOCKED, never DEGRADED
    args: { acceptDegraded: 'policy' },
    override(L) {
      if (/seat X \(gpt-6-astra\)/.test(L)) return { member: 'seat_x', status: 'INVALID', verdict: 'INVALID', class: 'error', verdict_line: 'VERDICT=INVALID reason=class_error' }
      if (/seat X \(gpt-6\.1-sol\)/.test(L)) return { member: 'seat_x', status: 'ABSENT', verdict: 'ABSENT', class: 'timeout' }
    },
    expect: (r, c) => r.status === 'BLOCKED' && /INVALID again/.test(r.stopped) && !has(c, /ship prepare/),
  },
  invalidThenAbsentRetry: { // INVALID in r1, the re-run ends ABSENT: sticky INVALID -> BLOCKED, not DEGRADED
    args: { acceptDegraded: 'policy' },
    override(L, o) {
      if (/^r1 seat C/.test(L)) return Object.assign({}, SEATC_OK, { final_line: '' })
      if (/^r2 seat C \(L2/.test(L)) return { member: 'seat_c', status: 'ABSENT', verdict: 'ABSENT', class: 'quota' }
      if (/^r2 seat C/.test(L) && o.model !== 'haiku') return null
    },
    expect: (r, c) => r.status === 'BLOCKED' && /INVALID again/.test(r.stopped) && !has(c, /ship prepare/),
  },
  invalidRerunFrozen: { // the INVALID re-run reviews the frozen SHA: no guard commit, same SHA
    override(L) { if (/^r1 seat C/.test(L)) return Object.assign({}, SEATC_OK, { final_line: '' }) },
    expect: (r, c) => { const g2 = c.find(x => x.label === 'r2 gate start'); return r.status === 'READY' && /do NOT commit/.test(g2.prompt) && !/commit --cwd/.test(g2.prompt) && r.rounds.some(x => x.round === 2) && r.rounds.some(x => x.invalid_rerun_round === 2 && x.counts_as_round === false) },
  },
  invalidRerunHeadMoved: {
    override(L) {
      if (/^r1 seat C/.test(L)) return Object.assign({}, SEATC_OK, { final_line: '' })
      if (L === 'r2 gate start') return { guard_exit: 0, guard_lines: [], reviewed_sha: SHA('8'), files_since_base: [], files_since_prev: ['x'] }
    },
    expect: (r, c) => r.status === 'BLOCKED' && /HEAD moved/.test(r.stopped) && !has(c, /^r2 seat/),
  },
  invalidRerunDirty: {
    override(L) {
      if (/^r1 seat C/.test(L)) return Object.assign({}, SEATC_OK, { final_line: '' })
      if (L === 'r2 gate start') return { guard_exit: 2, guard_lines: ['dirty: src/a.ts'], reviewed_sha: '', files_since_base: [], files_since_prev: [] }
    },
    expect: (r, c) => r.status === 'BLOCKED' && /dirty lane/.test(r.stopped) && !has(c, /^r2 seat/),
  },
  relayDiedNoSol: { // a dead relay means Astra never ran: no Sol substitute (Fable r3)
    override(L) { if (/seat X \(gpt-6-astra\)/.test(L)) return null },
    expect: (r, c) => !has(c, /seat X \(gpt-6\.1-sol\)/) && r.rounds[0].members_present.seat_x === 'ABSENT',
  },
  gateAttemptSeatXOnly: {
    args: { gateAttempt: 2 },
    expect: (r, c) => r.status === 'READY' && /gate attempt 2/.test(c.find(x => /^r1 seat X/.test(x.label)).prompt) && !c.some(x => !/seat X/.test(x.label) && /gate attempt/.test(x.prompt)),
  },
  quotaWaitMentionsGateAttempt: {
    override(L) { if (/seat X \(gpt-6-astra\)/.test(L)) return { member: 'seat_x', status: 'ABSENT', verdict: 'ABSENT', class: 'quota', reset_at: 'R' } },
    expect: (r) => r.status === 'BLOCKED' && /gateAttempt incremented/.test(r.decision),
  },
  sensitiveAcronym: { args: { flow: 'LITE', waves: [[{ id: 'T-A', impl: 'claude', model: 'haiku', tier: 'T1' }]] }, wt: [], files: ['src/HTTPAuthHandler.ts'], expect: (r) => r.flow === 'FULL' },
  sensitiveAcronymOAuth2: { args: PATCH, patchFiles: ['src/OAuth2Client.ts'], expect: (r) => r.escalate === 'FULL' },
  sensitiveAcronymXML: { args: PATCH, patchFiles: ['src/XMLPaymentParser.ts'], expect: (r) => r.escalate === 'FULL' },
  notSensitiveAcronyms: { args: PATCH, patchFiles: ['src/HTMLParser.ts', 'src/AuthorCard.tsx'], expect: (r) => r.status === 'READY' && !r.escalate },
  sensitiveAcronymPatch: { args: PATCH, patchFiles: ['src/APIPermissions.ts'], expect: (r) => r.escalate === 'FULL' },
  invalidRerunNotCounted: { // r1 INVALID re-run does not consume the budget: cap 2 -> two full rounds after the re-run
    args: { maxRounds: 2, autoFourth: false },
    override(L) {
      if (/^r1 seat C/.test(L)) return Object.assign({}, SEATC_OK, { final_line: '' })
      if (/^r[23] consolidate/.test(L)) return CONS_P1
    },
    expect: (r, c) => r.status === 'STOPPED' && /after 2 full round\(s\) \(\+1 INVALID re-run/.test(r.stopped) && has(c, /^fix-r2 /) && has(c, /^r3 /),
  },
  invalidRerunMidBudget: { // INVALID in r1 (before the cap) + P1 later: the template's example, cap 3 -> 3 full rounds + the re-run
    args: { maxRounds: 3, autoFourth: false },
    override(L) {
      if (/^r1 seat C/.test(L)) return Object.assign({}, SEATC_OK, { final_line: '' })
      if (/^r[2-9] consolidate/.test(L)) return CONS_P1
    },
    expect: (r, c) => r.status === 'STOPPED' && has(c, /^r4 consolidate/) && !has(c, /^r5 /) && count(c, /^fix-r\d /) >= 2,
  },
  shipCleanUpstreamMerge: { // a clean upstream merge + VERSION/CHANGELOG bump: /ship's own scope is bookkeeping only -> no BLOCK, no review
    deltaFiles: ['VERSION', 'CHANGELOG.md'],
    expect: (r, c) => r.status === 'READY' && !has(c, /ship delta review/) && /arrived cleanly from the base branch does not count/.test(c.find(x => /ship prepare/.test(x.label)).prompt),
  },
  sensitiveLoginR8: { args: PATCH, patchFiles: ['src/LoginForm.tsx'], expect: (r) => r.escalate === 'FULL' },
  sensitiveJwtR8: { args: { flow: 'LITE', waves: [[{ id: 'T-A', impl: 'claude', model: 'haiku', tier: 'T1' }]] }, wt: [], files: ['lib/jwtVerify.ts'], expect: (r) => r.flow === 'FULL' },
  userSignInR9: { args: PATCH, patchFiles: ['src/userSignIn.ts'], expect: (r) => r.escalate === 'FULL' },
  userLogInR9: { args: { flow: 'LITE', waves: [[{ id: 'T-A', impl: 'claude', model: 'haiku', tier: 'T1' }]] }, wt: [], files: ['src/userLogIn.ts'], expect: (r) => r.flow === 'FULL' },
  consoleNotSensitiveR8: { args: PATCH, patchFiles: ['src/console.ts'], expect: (r) => r.status === 'READY' && !r.escalate },
  sensitiveACLs: { args: { flow: 'LITE', waves: [[{ id: 'T-A', impl: 'claude', model: 'haiku', tier: 'T1' }]] }, wt: [], files: ['src/ACLs.ts'], expect: (r) => r.flow === 'FULL' },
  sensitiveUserACLs: { args: PATCH, patchFiles: ['src/userACLs.ts'], expect: (r) => r.escalate === 'FULL' },
  sensitiveRBACs: { args: PATCH, patchFiles: ['src/RBACs.ts'], expect: (r) => r.escalate === 'FULL' },
  authorTsNotSensitive: { args: PATCH, patchFiles: ['src/author.ts'], expect: (r) => r.status === 'READY' && !r.escalate },
  prsArchiveFallback: { args: PATCH, expect: (r, c) => r.status === 'READY' && /state\.final\.json/.test(c.find(x => /setup/.test(x.label)).prompt) },
  seatXModelSolRefused: { args: { seatXModel: 'gpt-6.1-sol' }, expect: (r, c) => r.status === 'STOPPED' && /seatXModel must be gpt-6-astra/.test(r.stopped) && c.length === 0 },
  seatXModelAstraExplicit: { args: { seatXModel: 'gpt-6-astra' }, expect: (r, c) => r.status === 'READY' && has(c, /^r1 seat X \(gpt-6-astra\)/) && !has(c, /seat X \(gpt-6\.1-sol\)/) },
  seatXDefaultAstraFirst: { expect: (r, c) => r.status === 'READY' && c.filter(x => /seat X/.test(x.label)).every(x => /gpt-6-astra/.test(x.label)) },
  seatCModelNotExact: { override(L) { if (/^r1 seat C/.test(L)) return Object.assign({}, SEATC_OK, { actual_model: 'claude-opus-5-5-preview' }) }, expect: (r) => r.rounds[0].verdict === 'RERUN_INVALID' },
  seatCModelLookalike: { override(L) { if (/^r1 seat C/.test(L)) return Object.assign({}, SEATC_OK, { actual_model: 'not-fable' }) }, expect: (r) => r.rounds[0].verdict === 'RERUN_INVALID' },
  seatCL2ModelNotAllowed: {
    override(L, o) {
      if (/^r1 seat C \(L2/.test(L)) return { member: 'seat_c', status: 'PRESENT', verdict: 'PASS', class: 'ok', verdict_line: 'SEATC status=PRESENT class=ok reason=complete p1=0 runtime_model=claude-sonnet-5-5' }
      if (/^r1 seat C/.test(L) && o.model !== 'haiku') return null
    },
    expect: (r) => r.rounds[0].verdict === 'RERUN_INVALID',
  },
  relayPresentWithoutVerdict: {
    override(L) { if (/^r1 seat X/.test(L)) return Object.assign({}, SEATX_OK, { verdict_line: '' }) },
    expect: (r) => r.status === 'READY' && r.rounds[0].verdict === 'RERUN_INVALID',
  },
  unknownSeatStatus: { // the relay's own status is ignored: an INVALID VERDICT line reported as ABSENT is INVALID (Fable r2)
    override(L) { if (/^r1 seat X/.test(L)) return Object.assign({}, SEATX_OK, { status: 'ABSENT', verdict_line: 'VERDICT=INVALID reason=stale_sha p1_count=0' }) },
    expect: (r) => r.status === 'READY' && r.rounds[0].members_present.seat_x === 'INVALID',
  },
  relayGarbageStatus: {
    override(L) { if (/^r1 seat X/.test(L)) return Object.assign({}, SEATX_OK, { status: 'MAYBE', verdict_line: '' }) },
    expect: (r) => r.status === 'READY' && r.rounds[0].members_present.seat_x === 'INVALID',
  },
  seatCL2Invalid: {
    override(L, o) {
      if (/seat C \(L2/.test(L)) return { member: 'seat_c', status: 'INVALID', verdict: 'INVALID', class: 'ok', runtime_model: 'claude-opus-5-5', verdict_line: 'SEATC status=INVALID class=ok reason=no-completion-marker p1=0' }
      if (/seat C/.test(L) && o.model !== 'haiku') return null
    },
    expect: (r) => r.status === 'BLOCKED' && /INVALID again/.test(r.stopped),
  },
  seatCL2LiesPresent: {
    override(L, o) {
      if (/seat C \(L2/.test(L)) return { member: 'seat_c', status: 'PRESENT', verdict: 'PASS', class: 'ok', runtime_model: 'claude-opus-5-5', verdict_line: 'SEATC status=INVALID class=ok reason=no-completion-marker p1=0' }
      if (/seat C/.test(L) && o.model !== 'haiku') return null
    },
    expect: (r) => r.status === 'BLOCKED' && /INVALID/.test(r.stopped),
  },

  // ---- consolidator consistency (F6, F21) ----
  consFailNoP1: { override(L) { if (/r1 consolidate/.test(L)) return Object.assign({}, CONS_CLEAN, { verdict: 'FAIL', p1: [] }) }, expect: (r, c) => r.status === 'BLOCKED' && /inconsistency/.test(r.stopped) && !has(c, /^fix/) },
  dockerFailNoP1: { override(L) { if (/r1 docker/.test(L)) return { member: 'docker', status: 'PRESENT', verdict: 'FAIL' } }, expect: (r) => r.status === 'BLOCKED' && /docker FAIL/.test(r.stopped) },
  dockerFailDowngraded: {
    override(L) {
      if (/r1 docker/.test(L)) return { member: 'docker', status: 'PRESENT', verdict: 'FAIL' }
      if (/r1 consolidate/.test(L)) return Object.assign({}, CONS_CLEAN, { member_downgrades: [{ member: 'docker', reason: 'port clash, re-verified' }] })
    },
    expect: (r) => r.status === 'READY',
  },

  // ---- R4: P2 delta review ----
  p2DeltaIncompleteTwice: {
    override(L) {
      if (/r1 consolidate/.test(L)) return Object.assign({}, CONS_CLEAN, { fixes: [{ owner: 'T-A', item: 'rename', severity: 'P2', checks: [] }] })
      if (/delta review/.test(L)) return { verdict: 'FAIL', p1: [], notes: 'could not finish' }
    },
    expect: (r, c) => r.status === 'BLOCKED' && /incomplete twice/.test(r.stopped) && count(c, /r1-p2 delta review/) === 2 && !has(c, /^r2 /) && r.flow === 'FULL',
  },
  p2DeltaIncompleteOnce: {
    override(L, o, p, calls) {
      if (/r1 consolidate/.test(L)) return Object.assign({}, CONS_CLEAN, { fixes: [{ owner: 'T-A', item: 'rename', severity: 'P2', checks: [] }] })
      if (L === 'r1-p2 delta review') return { verdict: 'PASS', p1: [], reviewed_sha: SHA('9') } // wrong SHA => incomplete
    },
    expect: (r, c) => r.status === 'READY' && has(c, /r1-p2 delta review \(re-run\)/),
  },
  liteP2DeltaIncompleteNoUpgrade: {
    args: { flow: 'LITE', waves: [[{ id: 'T-A', impl: 'claude', model: 'haiku', tier: 'T1' }]] }, wt: [],
    override(L) {
      if (/r1 consolidate/.test(L)) return Object.assign({}, CONS_CLEAN, { fixes: [{ owner: 'T-A', item: 'rename', severity: 'P2', checks: [] }] })
      if (/delta review/.test(L)) return { verdict: 'FAIL', p1: [] }
    },
    expect: (r) => r.status === 'BLOCKED' && r.flow === 'LITE' && !r.flow_upgrades.length,
  },
  fixMissingNamedCheck: { // fix job named checks come from the finding: a Haiku fix omitting one escalates, then fails
    override(L) {
      if (/r1 consolidate/.test(L)) return Object.assign({}, CONS_CLEAN, { fixes: [{ owner: 'T-A', item: 'rename', severity: 'P2', checks: [{ name: 'rename-test', command: 'bun test rename' }] }] })
    },
    expect: (r, c) => r.status === 'STOPPED' && /not verified: missing named check\(s\): rename-test/.test(r.stopped) && has(c, /esc-Fix T-A/),
  },

  // ---- R4: ship ----
  shipDeltaIncomplete: { codeChanged: true, deltaFiles: ['src/merge.ts', 'VERSION'], override(L) { if (/ship delta review/.test(L)) return { verdict: 'FAIL', p1: [] } }, expect: (r, c) => r.status === 'BLOCKED' && /incomplete twice/.test(r.stopped) && !has(c, /publish/) },
  shipDeltaP2Hardening: { codeChanged: true, deltaFiles: ['src/merge.ts', 'VERSION'], override(L, o, p) { if (/ship delta review/.test(L)) return { verdict: 'PASS', p1: [], p2: ['nit'], reviewed_sha: rangeEnd(p) } }, expect: (r, c) => r.status === 'READY' && has(c, /ship delta hardening rows/) },
  shipDeltaP1: { codeChanged: true, deltaFiles: ['src/merge.ts', 'VERSION'], override(L) { if (/ship delta review/.test(L)) return { verdict: 'FAIL', p1: ['bad merge'] } }, expect: (r, c) => /ship-born \[P1\]/.test(r.stopped) && !has(c, /publish/) },
  shipNestedPkgIsCode: { deltaFiles: ['CHANGELOG.md', 'packages/api/package.json'], expect: (r, c) => r.status === 'READY' && has(c, /ship delta review/) },
  shipDeltaScopedToOwnChanges: { codeChanged: true, deltaFiles: ['src/conflict.ts', 'VERSION'], expect: (r, c) => r.status === 'READY' && /Review ONLY the changes to these paths: \["src\/conflict\.ts"\]/.test((c.find(x => /ship delta review/.test(x.label)) || {}).prompt || '') },
  reviewedTreeMissing: { override(L) { if (/\/ship prepare/.test(L)) return { status: 'COMMITTED', head: SHA('f'), code_changed: false } }, expect: (r, c) => r.status === 'BLOCKED' && /reviewed-tree snapshot/.test(r.stopped) && !has(c, /publish/) },
  publishBlockedPrExists: { override(L) { if (/\/ship publish/.test(L)) return { status: 'BLOCKED', pushed: false, head: SHA('f'), notes: 'git push failed' } }, expect: (r, c) => r.status === 'BLOCKED' && /publish not confirmed/.test(r.stopped) && !has(c, /find PR|wait CI/) },
  shipOpenAbsentSeat: {
    args: { maxRounds: 1, autoFourth: false, shipOpenP1: 'ship anyway' },
    override(L) {
      if (/seat X/.test(L)) return { member: 'seat_x', status: 'ABSENT', verdict: 'ABSENT', class: 'auth' }
      if (/consolidate/.test(L)) return CONS_P1
    },
    expect: (r, c) => r.status === 'STOPPED' && /acceptDegraded/.test(r.stopped) && !has(c, /ship prepare/),
  },
  ciPromptBounded: { args: PATCH, expect: (r, c) => { const p = (c.find(x => /wait CI/.test(x.label)) || {}).prompt || ''; const v = `O='/run/ci-12.out'; BF='/run/ci-12.sh'`; return /reason=ci:timeout/.test(p) && p.includes(`, to '/run/ci-12.sh'. `) && p.includes(`exactly: ${v}; rm -f "$O" "$O.pid"; N=12 X='github.com/acme/app' H=${SHA('2')} APPEAR=1200 TOTAL=7200 nohup perl -e '$f = shift; setpgrp(0, 0); open(my $h, ">", $f) or exit 126; print $h "$$\\n"; close $h; exec @ARGV or exit 127' "$O.pid" bash "$BF" > "$O" 2>/dev/null &\n`) && p.includes(`every call starts with ${v})`) && p.includes(`kills nothing unless "$O.pid" names the watcher):\n${v}; P=$(cat "$O.pid" 2>/dev/null); ME=$(ps -o pgid= -p $$`) && /''\|0\*\|\*\[!0-9\]\*\) echo "CI_STOP skip=no_pid"/.test(p) && /kill -TERM -- "-\$g"/.test(p) && /kill -KILL -- "-\$g"/.test(p) && !/kill -TERM -- -"\$\(cat/.test(p) && /timeout -k "\$G" "\$t"/.test(p) && /gtimeout -k "\$G" "\$t"/.test(p) && /tmo "\$LEFT" env -u GH_REPO -u GH_HOST gh pr view/.test(p) && /2>"\$E"/.test(p) && !/\.name|\.context/.test(p) } },
  shipRecordsPr: { expect: (r, c) => r.status === 'READY' && /"prs"|prs=/.test((c.find(x => /^state: Ship: PR #12/.test(x.label)) || {}).prompt || '') },
  shipPrRecordFail: { override(L) { if (/^state: Ship: PR #12/.test(L)) return null }, expect: (r, c) => r.status === 'BLOCKED' && /not recorded/.test(r.stopped) && !has(c, /wait CI/) },
  reviewedTreeMismatch: { override(L) { if (/\/ship prepare/.test(L)) return { status: 'COMMITTED', head: SHA('f'), code_changed: false, reviewed_tree: SHA('9') } }, expect: (r, c) => r.status === 'BLOCKED' && /not the merged gated tree/.test(r.stopped) && !has(c, /publish/) },
  treeDeltaCode: { override(L) { if (L === 'ship pre-push guard') return { exit_code: 0, lines: ['no_changes=true'], head: SHA('f'), files_since: [], tree_delta: ['VERSION', 'src/x.ts'] } }, expect: (r, c) => r.status === 'BLOCKED' && /differs from the reviewed tree/.test(r.stopped) && !has(c, /publish/) },
  treeDeltaMissing: { override(L) { if (L === 'ship pre-push guard') return { exit_code: 0, lines: ['no_changes=true'], head: SHA('f'), files_since: [] } }, expect: (r, c) => r.status === 'BLOCKED' && !has(c, /publish/) },
  shipCodeChangedEmptyScope: { codeChanged: true, deltaFiles: ['VERSION'], expect: (r, c) => r.status === 'BLOCKED' && /lists no code path/.test(r.stopped) && !has(c, /publish/) },
  pkgBumpDeltaReviewPublished: { // any package.json change is code: the version bump gets the cheap one-seat ship-delta review, then publishes
    deltaFiles: ['package.json', 'VERSION', 'CHANGELOG.md'],
    override(L) { if (L === 'ship pre-push guard') return { exit_code: 0, lines: ['no_changes=true'], head: SHA('f'), files_since: [], tree_delta: ['package.json', 'VERSION', 'CHANGELOG.md'] } },
    expect: (r, c) => r.status === 'READY' && count(c, /^ship delta review/) === 1 && /Review ONLY the changes to these paths: \["package\.json"\]/.test(c.find(x => /^ship delta review/.test(x.label)).prompt) && has(c, /\/ship publish/) && !r.rounds.some(x => x.round === 2) && !has(c, /^r2 /),
  },
  pkgBumpDeltaFailNotPublished: {
    deltaFiles: ['package.json', 'VERSION', 'CHANGELOG.md'],
    override(L) { if (/^ship delta review/.test(L)) return { verdict: 'FAIL', p1: ['postinstall script added in package.json'] } },
    expect: (r, c) => /ship-born \[P1\]/.test(r.stopped) && !has(c, /\/ship publish/) && !has(c, /wait CI/),
  },
  pkgTreeDeltaUnreviewed: { // package.json changed after the snapshot but no ship-delta review ran -> BLOCKED before publish
    override(L) { if (L === 'ship pre-push guard') return { exit_code: 0, lines: ['no_changes=true'], head: SHA('f'), files_since: [], tree_delta: ['package.json', 'VERSION'] } },
    expect: (r, c) => r.status === 'BLOCKED' && /beyond release bookkeeping: package\.json/.test(r.stopped) && !has(c, /\/ship publish/),
  },
  shipPkgJsonCode: { deltaFiles: ['CHANGELOG.md', 'package.json'], override(L) { if (L === 'ship delta files') return { head: SHA('f'), files: ['package.json'], snap_tree: SHA('e') } }, expect: (r, c) => r.status === 'READY' && has(c, /ship delta review/) },
  shipDocsJsIsCode: { deltaFiles: ['docs/example.js'], expect: (r, c) => r.status === 'READY' && has(c, /ship delta review/) },
  factCheckFail: { override(L) { if (/fact-check/.test(L)) return { verdict: 'FAIL', p1: [], doc_fixes: [], members: 'f' } }, expect: (r, c) => r.status === 'BLOCKED' && /fact-check not CLEAN/.test(r.stopped) && !has(c, /publish/) },
  inventoryFail: { override(L) { if (L === 'ship delta files') return null }, expect: (r, c) => r.status === 'BLOCKED' && /inventory unreadable/.test(r.stopped) && !has(c, /publish/) },
  shipGuardRefused: { override(L) { if (L === 'ship pre-push guard') return { exit_code: 1, lines: ['secret_path=.env commit=abc'], head: SHA('f'), files_since: [] } }, expect: (r, c) => r.status === 'BLOCKED' && /secret_path=\.env/.test(r.stopped) && !has(c, /publish/) },
  shipGuardNoEvidence: { override(L) { if (L === 'ship pre-push guard') return { exit_code: 0, lines: [], head: SHA('f'), files_since: [] } }, expect: (r, c) => r.status === 'BLOCKED' && !has(c, /publish/) },
  lateCodeAfterReview: { override(L) { if (L === 'ship pre-push guard') return { exit_code: 0, lines: ['no_changes=true'], head: SHA('f'), files_since: ['src/x.ts'], tree_delta: [] } }, expect: (r, c) => r.status === 'BLOCKED' && /unreviewed change/.test(r.stopped) && !has(c, /publish/) },
  prHeadMismatch: { override(L) { if (L === 'find PR') return PRL(Object.assign({}, PRV, { head: SHA('7') })) }, expect: (r, c) => r.status === 'BLOCKED' && /not the guarded head/.test(r.stopped) && !has(c, /wait CI/) && !has(c, /^state: Ship: PR/) },
  shipPrCrossRepo: { override(L) { if (L === 'find PR') return PRL(Object.assign({}, PRV, { cross_repo: true, head_repo: 'evil/app' })) }, expect: (r, c) => r.status === 'BLOCKED' && /evil\/app/.test(r.stopped) && !has(c, /wait CI/) && !has(c, /^state: Ship: PR/) },
  shipPrGhFail: { override(L) { if (L === 'find PR') return { line: 'PR exit=1 reason=api_error:network' } }, expect: (r, c) => r.status === 'BLOCKED' && /\(api_error:network\)/.test(r.stopped) && !has(c, /wait CI/) },
  shipPrAgentDead: { override(L) { if (L === 'find PR') return null }, expect: (r, c) => r.status === 'BLOCKED' && !has(c, /wait CI/) },
  shipPrClosed: { override(L) { if (L === 'find PR') return PRL(Object.assign({}, PRV, { state: 'CLOSED' })) }, expect: (r, c) => r.status === 'BLOCKED' && /not OPEN/.test(r.stopped) },
  shipPrWrongBranch: { override(L) { if (L === 'find PR') return PRL(Object.assign({}, PRV, { head_ref: 'other' })) }, expect: (r, c) => r.status === 'BLOCKED' && /head branch/.test(r.stopped) },
  shipPrLaneSlug: { override(L) { if (/^repo identity/.test(L)) return ID({ repo_url: 'git@github.com:acme/app.git', lane_url: 'git@github.com:fork/app.git', push_urls: ['git@github.com:fork/app.git'] }) }, expect: (r, c) => r.status === 'BLOCKED' && /lane fetches from github\.com\/fork\/app/.test(r.stopped) && !has(c, /\/ship publish|find PR|wait CI/) },
  shipUnparseableRemote: { override(L) { if (/^repo identity/.test(L)) return ID({ repo_url: 'git@github.com:acme/app.git', lane_url: '/srv/mirror/app', push_urls: ['/srv/mirror/app'] }) }, expect: (r, c) => r.status === 'BLOCKED' && /rejected/.test(r.stopped) && !has(c, /\/ship publish/) },
  shipRemoteForms: { override(L) { if (/^repo identity/.test(L)) return ID({ repo_url: 'ssh://git@github.com:22/acme/app.git', lane_url: 'https://github.com/acme/app', push_urls: ['https://github.com/acme/app'] }) }, expect: (r, c) => r.status === 'READY' && / X='github\.com\/acme\/app' bash/.test(c.find(x => x.label === 'find PR').prompt) },
  shipGheHost: { override(L) { if (/^repo identity/.test(L)) return ID({ repo_url: 'git@ghe.corp.example:acme/app.git', lane_url: 'https://ghe.corp.example/acme/app.git', push_urls: ['https://ghe.corp.example/acme/app.git'] }) }, expect: (r, c) => r.status === 'READY' && / X='ghe\.corp\.example\/acme\/app' bash/.test(c.find(x => x.label === 'find PR').prompt) && / X='ghe\.corp\.example\/acme\/app' H=/.test(c.find(x => /wait CI/.test(x.label)).prompt) && /--hostname 'ghe\.corp\.example' and repos\/acme\/app\//.test(c.find(x => /ship prepare/.test(x.label)).prompt) },
  prepRepoScoped: { // identity resolved BEFORE prepare; prepare gets the gh rule: --repo for pr/run, positional repo view, api --hostname
    expect: (r, c) => { const prep = c.find(x => /ship prepare/.test(x.label)).prompt; return r.status === 'READY' && idx(c, /^repo identity \(ship\)/) < idx(c, /ship prepare/) && /Repository: github\.com\/acme\/app\./.test(prep) && /--repo 'github\.com\/acme\/app'/.test(prep) && /gh repo view with the repository positional \('github\.com\/acme\/app', never --repo\)/.test(prep) && /gh api with --hostname 'github\.com' and repos\/acme\/app\/\.\.\. paths \(never --repo\)/.test(prep) }
  },
  shipInjectionRemote: { override(L) { if (/^repo identity/.test(L)) return ID({ repo_url: 'https://$(printf injected)/owner/repo.git', lane_url: 'https://$(printf injected)/owner/repo.git', push_urls: ['https://$(printf injected)/owner/repo.git'] }) }, expect: (r, c) => r.status === 'BLOCKED' && /rejected/.test(r.stopped) && !has(c, /ship prepare|\/ship publish/) && !c.some(x => /printf injected/.test(x.prompt)) },
  shipHttpsUserinfoRejected: { override(L) { if (/^repo identity/.test(L)) return ID({ repo_url: 'git@github.com:acme/app.git', lane_url: 'https://user@github.com/acme/app', push_urls: ['https://user@github.com/acme/app'] }) }, expect: (r, c) => r.status === 'BLOCKED' && /scheme https, host valid, reason userinfo/.test(r.stopped) && !has(c, /ship prepare/) },
  shipCredentialRemote: { override(L) { if (/^repo identity/.test(L)) return ID({ repo_url: fake.auth('https', 'user', fake.ghp('secret'), 'github.com/acme/app.git'), lane_url: fake.auth('https', 'user', fake.ghp('secret'), 'github.com/acme/app.git'), push_urls: [fake.auth('https', 'user', fake.ghp('secret'), 'github.com/acme/app.git')] }) }, expect: (r, c) => r.status === 'BLOCKED' && /rejected/.test(r.stopped) && !has(c, /ship prepare/) && !c.some(x => new RegExp(fake.ghp('secret')).test(x.prompt)) && !new RegExp(fake.ghp('secret')).test(r.stopped) },
  patchInjectionRemote: { args: PATCH, override(L) { if (/^repo identity/.test(L)) return ID({ repo_url: 'git@github.com:acme/app.git', lane_url: 'git@$(id):acme/app.git', push_urls: ['git@$(id):acme/app.git'] }) }, expect: (r, c) => r.status === 'BLOCKED' && !has(c, /setup|^fix/) },
  pushUrlOtherRepo: { override(L) { if (/^repo identity/.test(L)) return ID({ repo_url: 'git@github.com:acme/app.git', lane_url: 'https://github.com/acme/app.git', push_urls: ['https://github.com/attacker/app.git'] }) }, expect: (r, c) => r.status === 'BLOCKED' && /push URL #1 targets github\.com\/attacker\/app/.test(r.stopped) && !has(c, /ship prepare|\/ship publish/) },
  pushInsteadOfOtherHost: { args: PATCH, override(L) { if (/^repo identity/.test(L)) return ID({ repo_url: 'https://github.com/acme/app.git', lane_url: 'https://github.com/acme/app.git', push_urls: ['git@evil.host:acme/app.git'] }) }, expect: (r, c) => r.status === 'BLOCKED' && /targets evil\.host\/acme\/app/.test(r.stopped) && !has(c, /setup|^PATCH push/) },
  pushUrlSecondRedirect: { override(L) { if (/^repo identity/.test(L)) return ID({ repo_url: 'git@github.com:acme/app.git', lane_url: 'https://github.com/acme/app.git', push_urls: ['https://github.com/acme/app.git', 'https://github.com/other/app.git'] }) }, expect: (r, c) => r.status === 'BLOCKED' && /push URL #2/.test(r.stopped) },
  pushUrlMatchingSsh: { override(L) { if (/^repo identity/.test(L)) return ID({ repo_url: 'git@github.com:acme/app.git', lane_url: 'https://github.com/acme/app.git', push_urls: ['git@github.com:acme/app.git'] }) }, expect: (r, c) => r.status === 'READY' && !/git@github/.test(c.find(x => /^ship push$/.test(x.label)).prompt) },
  passwordWithAtNotLeaked: { override(L) { if (/^repo identity/.test(L)) return ID({ repo_url: fake.auth('https', 'u', 'p', 'ss@w0rd@github.com/acme/app.git'), lane_url: fake.auth('https', 'u', 'p', 'ss@w0rd@github.com/acme/app.git'), push_urls: [] }) }, expect: (r, c) => r.status === 'BLOCKED' && /scheme https, host valid, reason userinfo/.test(r.stopped) && !/ss@w0rd|p@ss|u:p/.test(r.stopped) && !c.some(x => !/^repo identity/.test(x.label) && /w0rd/.test(x.prompt)) },
  // ---- round 13: plain push + forge-API verification (same-user config/env out of the threat model) ----
  pushThenVerifyBeforePublish: { // fail-fast identity re-check -> plain push from the lane -> API check -> /ship publish (never pushes)
    expect: (r, c) => {
      const pp = c.find(x => /^ship push$/.test(x.label)).prompt, vp = c.find(x => /^ship verify push$/.test(x.label)).prompt, pub = c.find(x => /\/ship publish/.test(x.label)).prompt
      return r.status === 'READY' && idx(c, /^repo identity \(ship pre-push\)/) < idx(c, /^ship push$/) && idx(c, /^ship push$/) < idx(c, /^ship verify push$/) && idx(c, /^ship verify push$/) < idx(c, /\/ship publish/)
        && /L='\/lane' S=f{40} B='feat\/u1' bash/.test(pp) && /git -C "\$L" push --quiet origin "\$S:refs\/heads\/\$B"/.test(pp)
        && /H='github\.com' OW='acme' RP='app' B='feat\/u1' bash/.test(vp) && /env -u GH_REPO -u GH_HOST gh api --hostname "\$H" "repos\/\$OW\/\$RP\/git\/ref\/heads\/\$B"/.test(vp) && /2>"\$E"/.test(vp)
        && /ALREADY pushed exactly f{40}/.test(pub) && /never run git push yourself/.test(pub) && !/:\/\/|git@/.test(pp) && !/github\.com\/acme|git@github/.test(vp)
    },
  },
  redirectedPushApiMismatch: { // pushurl changed AFTER the check: git push "succeeds" elsewhere; the API still shows the old head
    override(L) { if (/^ship verify push$/.test(L)) return { line: `API exit=0 ref=ok sha=${SHA('9')} reason=ok` } },
    expect: (r, c) => r.status === 'BLOCKED' && /push not verified: github\.com\/acme\/app branch feat\/u1 is at 9{40}, not the pushed f{40}/.test(r.stopped) && !has(c, /\/ship publish|find PR|wait CI/),
  },
  redirectCaughtPrePush: { // a redirect configured between the first identity check and the push: the pre-push re-check BLOCKS
    override(L) { if (/^repo identity \(ship pre-push\)/.test(L)) return ID({ repo_url: 'git@github.com:acme/app.git', lane_url: 'https://github.com/acme/app', push_urls: ['https://github.com/attacker/app.git'] }) },
    expect: (r, c) => r.status === 'BLOCKED' && /pre-push identity check: the lane's push URL #1 targets github\.com\/attacker\/app/.test(r.stopped) && !has(c, /^ship push$/),
  },
  apiCheckFails: { override(L) { if (/^ship verify push$/.test(L)) return { line: 'API exit=1 ref=none sha=none reason=api_error:http_404' } }, expect: (r, c) => r.status === 'BLOCKED' && /API check failed \(exit 1, reason api_error:http_404\)/.test(r.stopped) && !has(c, /\/ship publish/) },
  apiCheckDead: { override(L) { if (/^ship verify push$/.test(L)) return null }, expect: (r, c) => r.status === 'BLOCKED' && /API check did not report an API line/.test(r.stopped) && !has(c, /\/ship publish/) },
  apiCheckRawStderr: { // an agent that relays raw stderr instead of the API line: rejected, and the URL never reaches the result
    override(L) { if (/^ship verify push$/.test(L)) return { line: 'error connecting to api.github.com: Get "' + fake.auth('https', 'x', 'tok', 'api.github.com/repos/acme/app') + '": dial tcp' } },
    expect: (r, c) => r.status === 'BLOCKED' && /did not report an API line/.test(r.stopped) && !/https?:\/\/|tok@/.test(JSON.stringify(r)),
  },
  apiCheckWrongRepo: { override(L) { if (/^ship verify push$/.test(L)) return { line: `API exit=0 ref=mismatch sha=${SHA('f')} reason=mismatch_url` } }, expect: (r, c) => r.status === 'BLOCKED' && /reason mismatch_url/.test(r.stopped) && !has(c, /\/ship publish/) },
  apiCheckGarbage: { override(L) { if (/^ship verify push$/.test(L)) return { line: 'API exit=0 ref=ok sha=main reason=ok' } }, expect: (r, c) => r.status === 'BLOCKED' && /did not report an API line/.test(r.stopped) },
  ciNotesUrlScrubbed: { // CI log excerpts and gh error text relayed into the result are scrubbed of URLs
    override(L) { if (/wait CI/.test(L)) return { line: 'fatal: unable to access ' + fake.auth('https', 'user', fake.ghp('x'), 'github.com/acme/app.git/') + ' and git@github.com:acme/app.git' } },
    secrets: [fake.ghp('x'), 'git@github.com:acme'], expect: (r) => r.status === 'BLOCKED' && /did not report a CI line/.test(r.stopped),
  },
  findPrRawStderr: { override(L) { if (L === 'find PR') return { line: 'Get "' + fake.auth('https', 'x-token', fake.ghp('abcdefghijkl'), 'api.github.com/graphql') + '": EOF' } }, secrets: [fake.ghp('abcdefghijkl'), 'x-token'], expect: (r) => r.status === 'BLOCKED' && /did not report a PR line/.test(r.stopped) },
  // ---- round 15: whole-result scrubbing, broader patterns, no echo of rejected values ----
  credUrlParenPassword: { // a ) inside the password must not end the redaction
    override(L) {
      if (/r1 consolidate/.test(L)) return Object.assign({}, CONS_CLEAN, { fixes: [{ owner: 'T-A', item: 'rename', severity: 'P2', checks: [] }] })
      if (/delta review/.test(L)) return { verdict: 'FAIL', p1: [], notes: 'fatal: could not read ' + fake.auth('https', 'user', 'pre)fix]sec"ret>', 'github.com/acme/app.git') + ' (exit 128)' }
    },
    secrets: ['pre)fix', 'fix]sec', 'sec"ret', 'ret>@github', '@github.com/acme/app.git'],
    expect: (r) => r.status === 'BLOCKED' && /incomplete twice \(fatal: could not read <url> \(exit 128\)\)/.test(r.stopped) && r.incidents.some(i => /<url>/.test(i.note || '')),
  },
  tokenInIncidentNote: {
    override(L) {
      if (/r1 consolidate/.test(L)) return Object.assign({}, CONS_CLEAN, { fixes: [{ owner: 'T-A', item: 'rename', severity: 'P2', checks: [] }] })
      if (/delta review/.test(L)) return { verdict: 'FAIL', p1: [], notes: 'env ' + fake.ghp('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789') + ' ' + fake.gho('ZYXWVUTSRQPONMLKJIHGFEDCBA98765') + ' ' + fake.pat('11AAAAAAA_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb') + ' ' + fake.sk('proj-abcdefghijklmnopqrstuvwx') + ' Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.x.y and bearer lowercaseTokenValue123 and u:hunter2@build.example.com and u:localSecret@localhost/repo and git@internal.example.com:org/secret-repo.git' }
    },
    secrets: [fake.ghp('ABCDEFGHIJKLMNOPQRST'), fake.gho('ZYXWVUTSRQPONMLK'), fake.pat('11AAAAAAA'), fake.sk('proj-abcdefghijklmnop'), 'eyJhbGciOiJIUzI1NiJ9', 'lowercaseTokenValue123', 'hunter2', 'localSecret', 'org/secret-repo'],
    expect: (r) => r.status === 'BLOCKED' && r.incidents.some(i => /<token>/.test(i.note || '') && /Authorization: <redacted>/.test(i.note || '')),
  },
  deepNestedSecret: { // strings at any depth are scrubbed (no depth cut-off)
    override(L) {
      if (/\/ship prepare/.test(L)) { let deep = { leaf: 'see ' + fake.auth('https', 'u', 'deepS3cret', 'host.example/x') }; for (let i = 0; i < 14; i++) deep = { ['l' + i]: deep }; return { status: 'COMMITTED', head: SHA('f'), code_changed: false, reviewed_tree: SHA('e'), decisions_auto_taken: [JSON.stringify({ a: 'x' })], deep } }
    },
    secrets: ['deepS3cret', 'u:deepS3cret'], expect: (r) => r.status === 'READY' && JSON.stringify(r.ship).includes('<url>'),
  },
  cyclicAgentResult: { // a cyclic result does not hang or crash the scrubber
    override(L) { if (/\/ship prepare/.test(L)) { const o = { status: 'COMMITTED', head: SHA('f'), code_changed: false, reviewed_tree: SHA('e'), note: fake.ghp('CYCLECYCLECYCLECYCLECYCLECYCLE1234') }; o.self = o; return o } },
    secrets: [fake.ghp('CYCLECYCLECYCLECYCLECYCLECYCLE1234')], expect: (r) => r.status === 'READY',
  },
  credentialAsBase: { args: { base: fake.auth('https', 'u', 'baseSecret99', 'github.com/acme/app.git') }, secrets: ['baseSecret99', 'u:baseSecret99'], expect: (r, c) => r.status === 'STOPPED' && r.stopped === 'invalid argument: base must be a full 40-hex commit SHA' && c.length === 0 },
  credentialAsLanePath: { args: { lane: '/x/' + fake.auth('https', 'u', 'laneSecret77', 'h.example/') }, secrets: ['laneSecret77'], expect: (r, c) => r.status === 'STOPPED' && /^lane must be an absolute path/.test(r.stopped) && c.length === 0 },
  credentialAsBranch: { args: { branch: 'u:branchSecret55@h.example' }, secrets: ['branchSecret55'], expect: (r, c) => r.status === 'STOPPED' && c.length === 0 },
  // ---- round 16: exact identity (reject, never rewrite), no CI free text, scrubbing never corrupts identifiers ----
  mixedCaseIdentityReady: { // uppercase host + mixed-case owner/repo in the remote vs GitHub's lowercase canonical -> READY
    override(L) {
      if (/^repo identity/.test(L)) return ID({ repo_url: 'git@GitHub.com:SneakyGriff/Repo.git', lane_url: 'https://GitHub.com/SneakyGriff/Repo', push_urls: [] })
      if (L === 'find PR') return PRL(Object.assign({}, PRV, { head_repo: 'sneakygriff/repo' }))
    },
    expect: (r, c) => r.status === 'READY' && / X='github\.com\/sneakygriff\/repo' bash/.test(c.find(x => x.label === 'find PR').prompt) && /H='github\.com' OW='sneakygriff' RP='repo'/.test(c.find(x => /^ship verify push$/.test(x.label)).prompt) && /--repo 'github\.com\/sneakygriff\/repo'/.test(c.find(x => /ship prepare/.test(x.label)).prompt),
  },
  branchCaseApiMismatch: { // branch Feat/X vs an API ref feat/x -> BLOCKED (git refs are case-sensitive)
    args: { branch: 'Feat/X' },
    override(L) { if (/^ship verify push$/.test(L)) return { line: `API exit=0 ref=mismatch sha=${SHA('f')} reason=mismatch_ref` } },
    expect: (r, c) => r.status === 'BLOCKED' && /reason mismatch_ref/.test(r.stopped) && !has(c, /\/ship publish/),
  },
  branchCasePrMismatch: { args: { branch: 'Feat/X' }, override(L) { if (L === 'find PR') return PRL(Object.assign({}, PRV, { head_ref: 'feat/x' })) }, expect: (r, c) => r.status === 'BLOCKED' && /head branch is feat\/x, not Feat\/X/.test(r.stopped) && !has(c, /wait CI/) },
  plusBranchStops: { args: { branch: 'feat/u+1' }, expect: (r, c) => r.status === 'STOPPED' && /^branch must be/.test(r.stopped) && c.length === 0 },
  prHeadRefOutsideAllowlist: { // gh reports the PR head as feat/u+1: the block rejects the field, the script never treats it as feat/u_1
    override(L) { if (L === 'find PR') return { line: 'PR exit=0 reason=invalid_field:head_ref' } },
    expect: (r, c) => r.status === 'BLOCKED' && /invalid_field:head_ref/.test(r.stopped) && !has(c, /wait CI/) && !has(c, /^state: Ship: PR/),
  },
  rewrittenHeadRefNeverMatches: { // even a (hypothetical) rewritten feat/u_1 is compared exactly against BR=feat/u1
    override(L) { if (L === 'find PR') return PRL(Object.assign({}, PRV, { head_ref: 'feat/u_1' })) },
    expect: (r, c) => r.status === 'BLOCKED' && /head branch is feat\/u_1, not feat\/u1/.test(r.stopped) && !has(c, /wait CI/),
  },
  patchSetupInvalidField: { args: PATCH, override(L) { if (/PATCH #12 setup/.test(L)) return { line: 'SETUP reason=invalid_field:recorded_branch' } }, expect: (r, c) => r.status === 'BLOCKED' && /recorded_branch has a character outside its allowlist/.test(r.stopped) && !has(c, /^fix/) },
  skBranchSurvivesAndVerifies: { // a real branch with an sk prefix (the fix/ name below) is never scrubbed into <token> on its way to the comparisons
    args: { branch: 'fix/' + fake.sk('validation-of-the-input-parser') },
    override(L) { if (L === 'find PR') return PRL(Object.assign({}, PRV, { head_ref: 'fix/' + fake.sk('validation-of-the-input-parser') })) },
    // ...and is never scrubbed on the way OUT either (field-exempt, by key): state.json prs[<unit>] and the result hold
    // the validated values exactly, while the same text under a free-text key is still scrubbed
    expect: (r, c) => {
      const BRX = 'fix/' + fake.sk('validation-of-the-input-parser')
      const sp = (c.find(x => /^state: Ship: PR #12$/.test(x.label)) || {}).prompt || ''
      const m = sp.match(/, prs=<the existing prs object \(or \{\}\) with these entries set: (\{.*?\})>/)
      const rec = m ? JSON.parse(m[1]).U1 : null
      return r.status === 'READY' && new RegExp("B='" + BRX.replace('/', '\\/') + "'").test(c.find(x => /^ship push$/.test(x.label)).prompt) && /git\/ref\/heads\/\$B/.test(c.find(x => /^ship verify push$/.test(x.label)).prompt)
        && !!rec && rec.branch === BRX && rec.repo === 'github.com/acme/app' && rec.pr === 12 && /^[0-9a-f]{40}$/.test(rec.head) && rec.head === r.pushed_head
        && r.pr.head_ref === BRX && r.branch === undefined && !/<token>/.test(sp) && !/<token>/.test(JSON.stringify(r))
    },
  },
  skTextStillScrubbedOut: { // the exemption is by FIELD: the same branch inside free text (stopped) is still scrubbed on the way out
    args: { branch: 'fix/' + fake.sk('validation-of-the-input-parser') },
    override(L) { if (L === 'find PR') return PRL(Object.assign({}, PRV, { head_ref: 'fix/other' })) },
    expect: (r) => r.status === 'BLOCKED' && /head branch is fix\/other, not fix\/<token>/.test(r.stopped),
  },
  ciNoFreeText: { // a CI line with a check name / free text is not accepted (only codes and counts)
    override(L) { if (/wait CI/.test(L)) return { line: `CI status=BLOCKED head=${SHA('f')} reason=check_failed failing=https___alice_privatePassword_ci.example_job` } },
    secrets: ['privatePassword', 'alice'], expect: (r) => r.status === 'BLOCKED' && /did not report a CI line/.test(r.stopped),
  },
  ciFailCounts: { override(L) { if (/wait CI/.test(L)) return CIL('BLOCKED', SHA('f'), 'ci:fail', 3, 1, 0) }, expect: (r) => r.status === 'BLOCKED' && r.stopped === 'CI: ci:fail (pass 3, fail 1, pending 0)' },
  ciReadyButNotPass: { override(L) { if (/wait CI/.test(L)) return CIL('READY', SHA('f'), 'ci:pending', 0, 0, 2) }, expect: (r) => r.status === 'BLOCKED' && /not a pass on the pushed/.test(r.stopped) },
  injectedBase: { args: { base: '$(printf INJECTED >&2)' }, expect: (r, c) => r.status === 'STOPPED' && /base must be a full 40-hex commit SHA/.test(r.stopped) && c.length === 0 },
  shortBase: { args: { base: 'abc123' }, expect: (r, c) => r.status === 'STOPPED' && c.length === 0 },
  injectedPrNumber: { args: Object.assign({}, PATCH, { prNumber: '12; touch /tmp/abu-pwned #' }), expect: (r, c) => r.status === 'STOPPED' && /prNumber must be a positive integer/.test(r.stopped) && c.length === 0 },
  injectedUnit: { args: { unit: 'U1"; $(id) "' }, expect: (r, c) => r.status === 'STOPPED' && /unit must be a plain id/.test(r.stopped) && c.length === 0 },
  injectedTaskModel: { args: { waves: [[{ id: 'T-A', impl: 'claude', model: 'haiku; id', tier: 'T1' }]] }, expect: (r, c) => r.status === 'STOPPED' && /model must be a plain model id/.test(r.stopped) && c.length === 0 },
  injectedTaskId: { args: { waves: [[{ id: 'T-A/../../x', impl: 'claude', tier: 'T1' }]] }, expect: (r, c) => r.status === 'STOPPED' && /id must be a plain id/.test(r.stopped) && c.length === 0 },
  injectedGateAttempt: { args: { gateAttempt: '2; id' }, expect: (r, c) => r.status === 'STOPPED' && c.length === 0 },
  injectedPrivtest: { args: { privtest: 'bin/x; id' }, expect: (r, c) => r.status === 'STOPPED' && /privtest/.test(r.stopped) && c.length === 0 },
  injectedExtraFixOwner: { args: Object.assign({}, PATCH, { extraFixes: [{ owner: 'core$(id)', item: 'x', tier: 'T1' }] }), expect: (r, c) => r.status === 'STOPPED' && c.length === 0 },
  shipPushFail: { override(L) { if (/^ship push$/.test(L)) return { line: `PUSH exit=1 local=${SHA('f')} reason=push_failed` } }, expect: (r, c) => r.status === 'BLOCKED' && /push failed \(exit 1, reason push_failed/.test(r.stopped) && !has(c, /verify push|\/ship publish|wait CI/) },
  shipPushLocalNotSha: { // local= is the one identity-keyed value from a strict line: only a 40-hex SHA or none is accepted
    override(L) { if (/^ship push$/.test(L)) return { line: 'PUSH exit=1 local=' + fake.ghp('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789') + ' reason=push_failed' } },
    secrets: [fake.ghp('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789')], expect: (r, c) => r.status === 'BLOCKED' && /did not report a PUSH line/.test(r.stopped) && !has(c, /\/ship publish/),
  },
  shipPushGarbage: { override(L) { if (/^ship push$/.test(L)) return { line: 'pushed it, all good' } }, expect: (r, c) => r.status === 'BLOCKED' && /did not report a PUSH line/.test(r.stopped) && !has(c, /\/ship publish/) },
  patchPushVerified: { args: PATCH, expect: (r, c) => r.status === 'READY' && /L='\/lane' S=2{40} B='feat\/u1' bash/.test(c.find(x => /^PATCH #12 push$/.test(x.label)).prompt) && /H='github\.com' OW='acme' RP='app' B='feat\/u1' bash/.test(c.find(x => /^PATCH #12 verify push$/.test(x.label)).prompt) && idx(c, /^PATCH #12 verify push$/) < idx(c, /wait CI/) },
  patchPushFail: { args: PATCH, override(L) { if (/^PATCH #12 push$/.test(L)) return { line: `PUSH exit=1 local=${SHA('2')} reason=push_failed` } }, expect: (r, c) => r.status === 'BLOCKED' && !has(c, /wait CI/) },
  patchPushHeadMoved: { args: PATCH, override(L) { if (/^PATCH #12 push$/.test(L)) return { line: 'PUSH exit=3 local=none reason=head_moved' } }, expect: (r, c) => r.status === 'BLOCKED' && /reason head_moved/.test(r.stopped) && !has(c, /wait CI/) },
  patchApiStale: { args: PATCH, override(L) { if (/^PATCH #12 verify push$/.test(L)) return { line: `API exit=0 ref=ok sha=${SHA('1')} reason=ok` } }, expect: (r, c) => r.status === 'BLOCKED' && /is at 1{40}, not the pushed 2{40}/.test(r.stopped) && !has(c, /wait CI/) },
  injectedLanePath: { args: { lane: '/tmp/my lane/$(touch /tmp/abu-pwned)' }, expect: (r, c) => r.status === 'STOPPED' && /lane must be an absolute path/.test(r.stopped) && c.length === 0 },
  injectedRepoPath: { args: Object.assign({}, PATCH, { repo: "/repo';id;'" }), expect: (r, c) => r.status === 'STOPPED' && /repo must be an absolute path/.test(r.stopped) && c.length === 0 },
  relativeRunDir: { args: { runDir: 'run' }, expect: (r, c) => r.status === 'STOPPED' && /runDir must be an absolute path/.test(r.stopped) },
  branchDotComponent: { args: { branch: 'feat/.hidden' }, expect: (r, c) => r.status === 'STOPPED' && c.length === 0 },
  branchHEAD: { args: { branch: 'HEAD' }, expect: (r, c) => r.status === 'STOPPED' && c.length === 0 },
  branchLockComponent: { args: { branch: 'feat.lock/child' }, expect: (r, c) => r.status === 'STOPPED' && c.length === 0 },
  pushHttpScheme: { override(L) { if (/^repo identity/.test(L)) return ID({ repo_url: 'git@github.com:acme/app.git', lane_url: 'https://github.com/acme/app', push_urls: ['http://github.com/acme/app.git'] }) }, expect: (r, c) => r.status === 'BLOCKED' && /push URL #1 uses http; pushes go over https or ssh only/.test(r.stopped) },
  sshDashUser: { override(L) { if (/^repo identity/.test(L)) return ID({ repo_url: 'git@github.com:acme/app.git', lane_url: 'https://github.com/acme/app', push_urls: ['ssh://-f@github.com/acme/app.git'] }) }, expect: (r, c) => r.status === 'BLOCKED' && /push URL #1 was rejected/.test(r.stopped) },
  // ---- Astra r12: in-shell identity, verbatim push-URL list ----
  publishWrongHead: { override(L) { if (/\/ship publish/.test(L)) return { status: 'PUBLISHED', pr_number: 12, head: SHA('7') } }, expect: (r, c) => r.status === 'BLOCKED' && /publish not confirmed/.test(r.stopped) && !has(c, /wait CI/) },
  noLaneOrigin: { override(L) { if (/^repo identity/.test(L)) return ID({ repo_url: 'git@github.com:acme/app.git', lane_url: null }) }, expect: (r, c) => r.status === 'BLOCKED' && /lane's origin remote was rejected \(scheme none, host invalid, reason git_error\)/.test(r.stopped) && !has(c, /ship prepare/) },
  pushInsteadOfRewrite: { override(L) { if (/^repo identity/.test(L)) return ID({ repo_url: 'git@github.com:acme/app.git', lane_url: 'https://github.com/acme/app.git', push_instead_of: ['https://github.com/', 'git@evil.host:'] }) }, expect: (r, c) => r.status === 'BLOCKED' && /push URL #1 targets evil\.host\/acme\/app/.test(r.stopped) && !has(c, /ship push$|ship prepare/) },
  pushUrlWhitespace: { override(L) { if (/^repo identity/.test(L)) return ID({ repo_url: 'git@github.com:acme/app.git', lane_url: 'https://github.com/acme/app.git', push_urls: ['   '] }) }, expect: (r, c) => r.status === 'BLOCKED' && /push URL #1 was rejected \(scheme none, host invalid, reason empty\)/.test(r.stopped) },
  pushUrlEmptyEntryKept: { // an empty entry is a fail line (never dropped): BLOCKED even though entry #1 is valid
    override(L) { if (/^repo identity/.test(L)) return { lines: ['ID repo ok github.com/acme/app scheme=scp user=git port=', 'ID lane ok github.com/acme/app scheme=https user= port=', 'ID push1 ok github.com/acme/app scheme=https user= port=', 'ID push2 fail scheme=none host_ok=0 reason=empty', 'PUSH_N 2'] } },
    expect: (r, c) => r.status === 'BLOCKED' && /push URL #2 was rejected \(scheme none, host invalid, reason empty\)/.test(r.stopped) && !has(c, /ship prepare|ship push$/),
  },
  pushUrlEntryMissing: { override(L) { if (/^repo identity/.test(L)) return { lines: ['ID repo ok github.com/acme/app scheme=scp user=git port=', 'ID lane ok github.com/acme/app scheme=https user= port=', 'ID push1 ok github.com/acme/app scheme=https user= port=', 'PUSH_N 2'] } }, expect: (r, c) => r.status === 'BLOCKED' && /push URL #2 was rejected \(no push2 identity line\)/.test(r.stopped) },
  pushUrlCountMissing: { override(L) { if (/^repo identity/.test(L)) return { lines: ['ID repo ok github.com/acme/app scheme=scp user=git port=', 'ID lane ok github.com/acme/app scheme=https user= port=', 'ID push1 ok github.com/acme/app scheme=https user= port='] } }, expect: (r, c) => r.status === 'BLOCKED' && /push URL count was not reported/.test(r.stopped) },
  identityLineForged: { // a relayed line that is not in the strict format is never trusted
    override(L) { if (/^repo identity/.test(L)) return { lines: ['ID repo ok github.com/acme/app scheme=scp user=git port=', 'ID lane ok github.com/acme/app scheme=https user=x:secret port=', 'ID push1 ok github.com/acme/app scheme=https user= port=', 'PUSH_N 1'] } },
    expect: (r, c) => r.status === 'BLOCKED' && /lane's origin remote was rejected \(unrecognized lane identity line\)/.test(r.stopped),
  },
  pushUrlTwoValid: { override(L) { if (/^repo identity/.test(L)) return ID({ repo_url: 'git@github.com:acme/app.git', lane_url: 'https://github.com/acme/app.git', push_urls: ['https://github.com/acme/app.git', 'git@github.com:acme/app.git'] }) }, expect: (r, c) => r.status === 'BLOCKED' && /2 effective push URLs; exactly one/.test(r.stopped) },
  identityPromptHasNoUrl: { expect: (r, c) => { const ip = c.find(x => /^repo identity/.test(x.label)); return r.status === 'READY' && !/github\.com|git@github/.test(ip.prompt) && /R='\/repo' L='\/lane' bash/.test(ip.prompt) && /^ID repo ok github\.com\/acme\/app /.test(ip.output) && !/:\/\/|@/.test(ip.output) } },
  badBranchName: { args: { branch: "feat/u1'; rm -rf ~; '" }, expect: (r, c) => r.status === 'STOPPED' && /plain, valid git branch name/.test(r.stopped) && c.length === 0 },
  ghRepoEnvNeutralized: { // GH_REPO / GH_HOST cannot redirect: every gh call is env -u GH_REPO -u GH_HOST gh ... --repo <origin slug>
    args: PATCH,
    expect: (r, c) => r.status === 'READY' && c.every(x => !/(^|[^-\w])gh (pr|run|repo) /.test(x.prompt.replace(/Run every gh command as .*?paths \(never --repo\)\./g, '').replace(/env -u GH_REPO -u GH_HOST gh /g, 'GHX '))) && c.filter(x => /GH_REPO/.test(x.prompt)).length >= 2,
  },
  ghRepoEnvNeutralizedShip: { expect: (r, c) => r.status === 'READY' && c.filter(x => !/^repo identity/.test(x.label)).every(x => !/(^|[^-\w])gh (pr|run|repo) /.test(x.prompt.replace(/Run every gh command as .*?paths \(never --repo\)\./g, '').replace(/env -u GH_REPO -u GH_HOST gh /g, 'GHX '))) && /Run every gh command as env -u GH_REPO -u GH_HOST gh \(never a bare gh\): gh pr \/ run \/ release \/ workflow subcommands with --repo 'github\.com\/acme\/app'/.test(c.find(x => /\/ship publish/.test(x.label)).prompt) },
  shipPrNoNumber: { override(L) { if (/^U1 \/ship publish/.test(L)) return { status: 'PUBLISHED', pushed: true, head: SHA('f') } }, expect: (r, c) => r.status === 'BLOCKED' && /no PR number/.test(r.stopped) && !has(c, /find PR/) },
  shipPrHappyScoped: { expect: (r, c) => r.status === 'READY' && /N=12 X='github\.com\/acme\/app' bash/.test(c.find(x => x.label === 'find PR').prompt) && /env -u GH_REPO -u GH_HOST gh pr view "\$N" --repo "\$X"/.test(c.find(x => x.label === 'find PR').prompt) && / X='github\.com\/acme\/app' H=/.test(c.find(x => /wait CI/.test(x.label)).prompt) && /"repo":"github\.com\/acme\/app"/.test(c.find(x => /^state: Ship: PR #12/.test(x.label)).prompt) },
  ciWrongHead: { override(L) { if (/wait CI/.test(L)) return CIL('READY', SHA('7')) }, expect: (r) => r.status === 'BLOCKED' && /on the pushed/.test(r.stopped) },
  stateWriteFailShip: { override(L) { if (/^state: Ship/.test(L)) return null }, expect: (r, c) => r.status === 'BLOCKED' && /state\.json write failed/.test(r.stopped) && !has(c, /ship prepare/) },
  gateStartGuardRefused: { override(L) { if (/r1 gate start/.test(L)) return { guard_exit: 1, guard_lines: ['filter_path=big.bin filter=lfs'], reviewed_sha: '', files_since_base: [], files_since_prev: [] } }, expect: (r, c) => r.status === 'BLOCKED' && /filter_path/.test(r.stopped) && !has(c, /seat/) },
  gatedHeadMoved: { override(L) { if (L === 'gated head') return SHA('6') }, expect: (r, c) => r.status === 'BLOCKED' && /not the gated head/.test(r.stopped) },
  shipMergeConflictOpus: {
    override(L, o) { if (L === 'U1 /ship prepare') return { status: 'BLOCKED', merge_conflict: true, notes: 'conflict' } },
    expect: (r, c) => r.status === 'READY' && c.some(x => /prepare \(merge conflict\)/.test(x.label) && x.model === 'claude-opus-5-5'),
  },

  // ---- R4: PATCH ----
  patchPrMerged: { args: PATCH, override(L) { if (/PATCH #12 setup/.test(L)) return SETL(Object.assign({}, PSET, { state: 'MERGED' })) }, expect: (r, c) => r.status === 'BLOCKED' && /new unit/.test(r.decision) && !has(c, /^fix/) },
  patchWrongBranch: { args: PATCH, override(L) { if (/PATCH #12 setup/.test(L)) return SETL(Object.assign({}, PSET, { head_ref: 'other' })) }, expect: (r, c) => r.status === 'BLOCKED' && !has(c, /^fix/) },
  patchDeltaIncomplete: { args: PATCH, override(L) { if (/patch delta review/.test(L)) return { verdict: 'FAIL', p1: [] } }, expect: (r, c) => r.status === 'BLOCKED' && /incomplete twice/.test(r.stopped) && !has(c, /^PATCH #12 push$/) },
  patchDeltaP2: { args: PATCH, override(L, o, p) { if (/patch delta review/.test(L)) return { verdict: 'PASS', p1: [], p2: ['nit'], reviewed_sha: rangeEnd(p) } }, expect: (r, c) => r.status === 'READY' && has(c, /PATCH #12 delta hardening rows/) },
  patchDocsJs: { args: PATCH, patchFiles: ['docs/example.js'], expect: (r, c) => r.status === 'READY' && has(c, /patch delta review/) && !has(c, /fact-check/) },
  patchFactCheckFail: { args: PATCH, patchFiles: ['README.md'], override(L) { if (/fact-check/.test(L)) return { verdict: 'FAIL', p1: [], doc_fixes: [], members: 'f' } }, expect: (r, c) => r.status === 'BLOCKED' && !has(c, /^PATCH #12 push$/) },
  patchRepoMismatch: { args: PATCH, override(L) { if (/^repo identity/.test(L)) return ID({ repo_url: 'git@github.com:acme/app.git', lane_url: 'git@github.com:fork/app.git', push_urls: ['git@github.com:fork/app.git'] }) }, expect: (r, c) => r.status === 'BLOCKED' && /repository identity unverified: the lane fetches from github\.com\/fork\/app/.test(r.stopped) && !has(c, /setup|^fix/) },
  patchUnparseableRemote: { args: PATCH, override(L) { if (/^repo identity/.test(L)) return ID({ repo_url: '', lane_url: 'https://github.com/acme/app.git', push_urls: ['https://github.com/acme/app.git'] }) }, expect: (r, c) => r.status === 'BLOCKED' && /rejected/.test(r.stopped) && !has(c, /setup|^fix/) },
  patchCrossRepo: { args: PATCH, override(L) { if (/PATCH #12 setup/.test(L)) return SETL(Object.assign({}, PSET, { cross_repo: true, head_repo: 'evil/app' })) }, expect: (r, c) => r.status === 'BLOCKED' && !has(c, /^fix/) },
  patchGhRepoScoped: { args: PATCH, expect: (r, c) => r.status === 'READY' && /N=12 X='github\.com\/acme\/app' L='\/lane' B='feat\/u1' bash/.test(c.find(x => /setup/.test(x.label)).prompt) && /env -u GH_REPO -u GH_HOST gh pr view "\$N" --repo "\$X"/.test(c.find(x => /setup/.test(x.label)).prompt) && /git -C "\$L" fetch --quiet origin "\$B" >\/dev\/null 2>"\$E"/.test(c.find(x => /setup/.test(x.label)).prompt) && !/gh repo view/.test(c.find(x => /setup/.test(x.label)).prompt) },
  patchUnknownOwnerNoTier: { args: Object.assign({}, PATCH, { waves: [], extraFixes: [{ owner: 'core', item: 'x' }] }), expect: (r, c) => r.status === 'BLOCKED' && /carries no tier/.test(r.stopped) && !has(c, /setup/) },
  patchOwnerTierT2: { args: Object.assign({}, PATCH, { waves: [], extraFixes: [{ owner: 'core', item: 'x', tier: 'T2', checks: [{ name: 'unit', command: 'bun test a' }] }] }), expect: (r, c) => r.status === 'READY' && has(c, /^fix-patch core \(l2 claude-opus-5-5\)/) && !has(c, /^fix-patch core \(haiku/) },
  patchMdxIsCode: { args: PATCH, patchFiles: ['docs/page.mdx'], expect: (r, c) => r.status === 'READY' && has(c, /patch delta review/) && !has(c, /fact-check/) },
  patchNotRecorded: { args: PATCH, override(L) { if (/PATCH #12 setup/.test(L)) return SETL(Object.assign({}, PSET, { recorded_pr: 0, recorded_branch: '' })) }, expect: (r, c) => r.status === 'BLOCKED' && /not recorded/.test(r.stopped) && !has(c, /^fix/) },
  patchOtherPrRecorded: { args: PATCH, override(L) { if (/PATCH #12 setup/.test(L)) return SETL(Object.assign({}, PSET, { recorded_pr: 13 })) }, expect: (r, c) => r.status === 'BLOCKED' && !has(c, /^fix/) },
  patchIntegrationNoTier: { args: Object.assign({}, PATCH, { waves: [], extraFixes: [{ owner: 'integration', item: 'x' }] }), expect: (r, c) => r.status === 'BLOCKED' && /carries no tier/.test(r.stopped) },
  patchIntegrationT3: { args: Object.assign({}, PATCH, { waves: [], extraFixes: [{ owner: 'integration', item: 'x', tier: 'T3', checks: [{ name: 'unit', command: 'bun test a' }] }] }), expect: (r, c) => r.status === 'READY' && has(c, /^fix-patch integration \(l2 claude-opus-5-5\)/) && !c.some(x => /^fix-patch/.test(x.label) && x.model === 'haiku') },
  patchStateWriteFail: { args: PATCH, override(L) { if (/^state: PATCH push/.test(L)) return null }, expect: (r, c) => r.status === 'BLOCKED' && !has(c, /^PATCH #12 push$/) },
  patchCiOldHead: { args: PATCH, override(L) { if (/wait CI/.test(L)) return CIL('READY', SHA('1')) }, expect: (r) => r.status === 'BLOCKED' },

  // ---- R6 sensitive globs ----
  liteAuthorNotSensitive: { args: { flow: 'LITE', waves: [[{ id: 'T-A', impl: 'claude', model: 'haiku', tier: 'T1' }]] }, wt: [], files: ['docs/author.md', 'src/authors/list.ts', 'src/coauthor.tsx'], expect: (r) => r.status === 'READY' && r.flow === 'LITE' },
  liteCriticalRunsDockerFull: { args: { flow: 'LITE', gateClass: 'critical', waves: [[{ id: 'T-A', impl: 'claude', model: 'haiku', tier: 'T1' }]] }, wt: [], files: ['src/a.ts'], expect: (r, c) => r.status === 'READY' && r.flow === 'FULL' && has(c, /^r1 docker/) },
  liteAuthSensitive: { args: { flow: 'LITE', waves: [[{ id: 'T-A', impl: 'claude', model: 'haiku', tier: 'T1' }]] }, wt: [], files: ['src/lib/auth.ts'], expect: (r) => r.flow === 'FULL' && /sensitive/.test(r.flow_upgrades[0].why) },
  sensitiveCamelCase: { args: { flow: 'LITE', waves: [[{ id: 'T-A', impl: 'claude', model: 'haiku', tier: 'T1' }]] }, wt: [], files: ['src/sessionStore.ts'], expect: (r) => r.flow === 'FULL' },
  sensitiveOAuthCamel: { args: { flow: 'LITE', waves: [[{ id: 'T-A', impl: 'claude', model: 'haiku', tier: 'T1' }]] }, wt: [], files: ['src/components/OAuthButton.tsx'], expect: (r) => r.flow === 'FULL' },
  sensitiveStripe: { args: PATCH, patchFiles: ['lib/stripeClient.ts'], expect: (r) => r.escalate === 'FULL' },
  sensitiveGlobsArg: { args: { flow: 'LITE', sensitiveGlobs: ['**/secret-sauce/**'], waves: [[{ id: 'T-A', impl: 'claude', model: 'haiku', tier: 'T1' }]] }, wt: [], files: ['src/secret-sauce/x.ts'], expect: (r) => r.flow === 'FULL' },

  // ---- routing (Astra U:723, U:165; Fable F15) ----
  routeT3Claude: {
    args: { waves: [[{ id: 'T-C', impl: 'claude', model: 'sonnet', tier: 'T3' }]] }, wt: [],
    expect: (r, c) => r.status === 'READY' && has(c, /^build T-C \(l2 claude-opus-5-5\)/) && !c.some(x => /^build T-C/.test(x.label) && x.model === 'sonnet' && !/l2|l3/.test(x.label)) && r.incidents.some(i => i.class === 'override_refused'),
  },
  routeT3L2Unavailable: {
    args: { waves: [[{ id: 'T-C', impl: 'claude', tier: 'T3' }]] }, wt: [],
    override(L) { if (/^build T-C \(l2/.test(L)) return { status: 'LANE_UNAVAILABLE', head: '', test_result: '', failure_class: 'quota' } },
    expect: (r, c) => r.status === 'READY' && idx(c, /^build T-C \(l3 gpt-6-astra\)/) > idx(c, /^build T-C \(l2/),
  },
  routeT2CodexUnavailable: {
    args: { waves: [[{ id: 'T-B', impl: 'codex', model: 'gpt-6-luna', tier: 'T2' }]] },
    override(L) { if (/^build T-B \(l3/.test(L)) return { status: 'LANE_UNAVAILABLE', head: '', test_result: '', failure_class: 'quota' } },
    expect: (r, c) => r.status === 'READY' && has(c, /^build T-B \(l3 gpt-6\.1-sol\)/) && has(c, /^build T-B \(l2 claude-opus-5-5\)/) && !has(c, /^build T-B \(L1/),
  },

  // ---- mid-milestone meter, resume base ----
  meterMidWave: {
    args: { waves: [[{ id: 'T-A', impl: 'claude', model: 'haiku', tier: 'T1' }], [{ id: 'T-D', impl: 'claude', model: 'haiku', tier: 'T1' }]] }, wt: [], waveProd: 2600, prod: 2600,
    expect: (r, c) => r.status === 'READY' && !has(c, /^build T-D/) && r.integ && r.integ.meter_stop && r.integ.meter_stop.after_wave === 1
      && has(c, /^state: Build: meter stop after wave 1/) && /deferred_tasks/.test(c.find(x => /^state: Build: meter stop/.test(x.label)).prompt)
      && !c.some(x => /^(integrate|r1 seat C|r1 seat X|r1 consolidate|r1 mutation|r1 docker)/.test(x.label) && /T-D/.test(x.prompt)),
  },
  meterMidWaveDeferStateFail: {
    args: { waves: [[{ id: 'T-A', impl: 'claude', model: 'haiku', tier: 'T1' }], [{ id: 'T-D', impl: 'claude', model: 'haiku', tier: 'T1' }]] }, wt: [], waveProd: 2600,
    override(L) { if (/^state: Build: meter stop/.test(L)) return null },
    expect: (r, c) => r.status === 'BLOCKED' && !has(c, /^integrate/),
  },
  meterGitErrorWave: {
    args: { waves: [[{ id: 'T-A', impl: 'claude', model: 'haiku', tier: 'T1' }], [{ id: 'T-D', impl: 'claude', model: 'haiku', tier: 'T1' }]] }, wt: [],
    override(L) { if (/wave 1 meter/.test(L)) return { prod_loc: -1, test_loc: -1, line: 'SHIP_METER FAIL: git error' } },
    expect: (r, c) => /meter failed/.test(r.stopped) && !has(c, /^build T-D/),
  },
  meterGitErrorIntegrate: { override(L) { if (/^integrate/.test(L)) return { status: 'GREEN', prod_loc: -1, test_loc: -1, linear: true, files: [] } }, expect: (r, c) => /SHIP_METER STOP/.test(r.stopped) && !has(c, /seat/) },
  routeT3CodexSol: { args: { waves: [[{ id: 'T-B', impl: 'codex', model: 'gpt-6.1-sol', tier: 'T3' }]] }, expect: (r, c) => r.status === 'READY' && has(c, /^build T-B \(l3 gpt-6-astra\)/) && !has(c, /^build T-B \(l3 gpt-6\.1-sol/) && r.incidents.some(i => i.class === 'override_refused') },
  routeT1CodexLuna: { args: { waves: [[{ id: 'T-B', impl: 'codex', model: 'gpt-6-luna', tier: 'T1' }]] }, expect: (r, c) => r.status === 'READY' && has(c, /^build T-B \(l3 gpt-6\.1-sol\)/) && !c.some(x => /luna/.test(x.label)) },
  meterBroken: {
    args: { waves: [[{ id: 'T-A', impl: 'claude', model: 'haiku', tier: 'T1' }], [{ id: 'T-D', impl: 'claude', model: 'haiku', tier: 'T1' }]] }, wt: [],
    override(L) { if (/wave 1 meter/.test(L)) return null },
    expect: (r, c) => /meter failed/.test(r.stopped) && !has(c, /^build T-D/),
  },
  meterLinearFalse: { prod: 2700, linear: false, expect: (r) => /not linear/.test(r.stopped) },
  waveBaseMismatch: {
    override(L) { if (/^wave 1 base/.test(L)) return { head: SHA('a'), worktrees: [{ task: 'u1-T-B', path: '/run/wt/u1-T-B', branch: 'b', base_sha: SHA('5') }] } },
    expect: (r, c) => r.status === 'BLOCKED' && /base mismatch/.test(r.stopped) && !has(c, /^build/),
  },
  waveBaseStateFail: { override(L) { if (/^state: Build wave 1/.test(L)) return null }, expect: (r, c) => r.status === 'BLOCKED' && !has(c, /^build/) },
}

// URLs configured by the identity specs must never reach a prompt, an agent output or the result (no exemption: the
// push goes to the remote name and the verification to the forge API, neither needs a URL).
function urlLeaks(ctx, calls, res) {
  const urls = ctx.specs.flatMap(s => [s.repo_url, s.lane_url, ...(s.push_urls || []), ...(s.push_instead_of || [])]).filter(u => u && u.trim().length >= 6)
  const out = []
  for (const u of urls) {
    for (const c of calls) {
      if (c.prompt.includes(u) || String(c.output || '').includes(u)) out.push(`${c.label}: ${u}`)
    }
    if (JSON.stringify(res || {}).includes(u)) out.push(`result: ${u}`)
  }
  return out
}

export { scenarios }
export async function runScenario(name, scriptPath = DEFAULT_SCRIPT) {
  const sc = scenarios[name]
  if (!sc) throw new Error(`unknown scenario ${name}`)
  const { src, body } = loadScript(scriptPath)
  const ctx = { idsh: shellBlock(src, 'ID_SH'), specs: [] }
  const calls = [], logs = []
  const fn = new AsyncFunction('args', 'agent', 'parallel', 'phase', 'log', body)
  const parallel = async thunks => Promise.all(thunks.map(t => t().catch(e => { logs.push('THUNK ERR ' + e.message); return null })))
  let res
  try { res = await fn(Object.assign({}, baseArgs, sc.args || {}), makeAgent(sc, calls, ctx), parallel, () => {}, m => logs.push(m)) } catch (e) { res = { CRASH: e.stack } }
  let ok = false
  const leaks = urlLeaks(ctx, calls, res)
  // scenario secrets (relayed by a mocked agent) must never reach the result, any later prompt (state writes included)
  // or a log line
  for (const sec of sc.secrets || []) {
    if (JSON.stringify(res || {}).includes(sec)) leaks.push(`result: ${sec}`)
    for (const c of calls) if (c.prompt.includes(sec)) leaks.push(`${c.label} prompt: ${sec}`)
    if (logs.some(l => l.includes(sec))) leaks.push(`log: ${sec}`)
  }
  try { ok = !res.CRASH && !logs.some(l => /THUNK ERR/.test(l)) && !leaks.length && !!sc.expect(res, calls) } catch (e) { ok = false; logs.push('EXPECT ERR ' + e.message) }
  const detail = `${name}: status=${res.status} stopped=${res.stopped || ''} flow=${res.flow} agents=${calls.length}` + (ok ? '' : `\n  crash: ${res.CRASH || ''}\n  url leaks: ${leaks.join(' | ')}\n  labels: ${calls.map(c => `${c.label} [${c.model}]`).join(' | ')}\n  logs: ${logs.join(' | ')}\n  rounds: ${JSON.stringify(res.rounds)}`)
  return { name, ok, detail, res, calls }
}
export async function runAll(scriptPath = DEFAULT_SCRIPT, only) {
  const results = []
  for (const name of Object.keys(scenarios)) if (!only || name === only) results.push(await runScenario(name, scriptPath))
  return results
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const results = await runAll(process.argv[2] || DEFAULT_SCRIPT, process.argv[3])
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.detail}`)
  const fail = results.filter(r => !r.ok).length
  console.log(`\n${results.length - fail} passed, ${fail} failed`)
  process.exitCode = fail ? 1 : 0
}
