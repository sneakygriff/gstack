// autobuilder-loop/autobuilder-unit.js — the reference unit workflow of /autobuilder-loop.
// Runs the mock harness (one test per scenario), the sensitive-path classifier samples, the remote-URL samples
// against the script's real in-shell validator, the byte-stability check, the real push block check (plain push; non-fast-forward, moved HEAD and invalid branch refused), the
// runtime-equivalent parse and the forbidden-name check. Hermetic: no network and no real gh / codex / claude; the
// only subprocesses are bash and git on scratch repositories under os.tmpdir(), removed after each use.
// Fixtures: test/fixtures/autobuilder-unit/{lib,harness,classifier-samples,remote-samples,stable}.mjs
import { describe, test, expect, setDefaultTimeout } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawnSync } from 'node:child_process'
// The Workflow runtime compiles this file's body rather than importing it as a JS module.
// Import its actual bytes for the source checks, and bind the harness loader to those same bytes below.
import workflowSource from '../autobuilder-loop/autobuilder-unit.js' with { type: 'text' }

const ROOT = path.join(import.meta.dir, '..')
const SCRIPT = path.join(ROOT, 'autobuilder-loop', 'autobuilder-unit.js')
const FIX = path.join(import.meta.dir, 'fixtures', 'autobuilder-unit')
const POSIX = process.platform !== 'win32' // bash + git scratch repositories
// every test here spawns bash / git / jq / perl subprocesses: under load the bun default (5 s) is a flake, not a signal;
// each test's own deadlines are asserted explicitly (within: lower and upper bound) and every sync spawn is bounded by SUB_TIMEOUT_MS
setDefaultTimeout(120_000)

const { scenarios, runScenario } = await import(path.join(FIX, 'harness.mjs'))
const { runClassifierSamples } = await import(path.join(FIX, 'classifier-samples.mjs'))
const { runRemoteSamples } = await import(path.join(FIX, 'remote-samples.mjs'))
const { runStable } = await import(path.join(FIX, 'stable.mjs'))
const { loadScript, shellBlock, realPush, realApi, realIdTrap, realGhBlock, realCiCleanup, ciStopGuard, survivors, hasTimeout, hasZsh, hasJq, gitEnv, withTmp, SUB_TIMEOUT_MS, fake } = await import(path.join(FIX, 'lib.mjs'))

describe('autobuilder-unit.js static checks', () => {
  test('harness executes the same production source imported by the static checks', () => {
    expect(loadScript(SCRIPT).src).toBe(workflowSource)
  })
  test('runtime-equivalent parse: the body after meta compiles as an async function body', () => {
    const { body } = loadScript(SCRIPT)
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
    expect(() => new AsyncFunction('args', 'agent', 'parallel', 'phase', 'log', body)).not.toThrow()
  })
  test('no project-specific names and no Grok', () => {
    expect(workflowSource.match(/beneficii|bookingsystem|SU-[0-9]|grok/gi)).toBeNull()
  })
  test('no bare `git push origin`, no merges, no credit billing', () => {
    const src = workflowSource.split('\n').filter(l => !l.trim().startsWith('//')).join('\n') // code + prompts, not comments
    expect(src).not.toContain('git push origin')
    expect(src).not.toMatch(/push --force|push -f\b/)
    expect(src).not.toContain('gh pr merge')
    expect(src.replace(/never --allow-credit-billing/g, '')).not.toContain('--allow-credit-billing')
  })
  test('sensitive-path classifier samples', () => {
    const r = runClassifierSamples(SCRIPT)
    expect(r.lines.filter((l: string) => l.startsWith('FAIL'))).toEqual([])
    expect(r.total).toBeGreaterThanOrEqual(50)
  })
  test('prompts are byte-stable when optional args are absent', async () => {
    const r = await runStable(SCRIPT)
    expect(r.absentStatus).toBe('READY')
    expect(r.identical).toBe(true)
    expect(r.changesWhenSet).toBe(true)
  })
})

describe.skipIf(!POSIX)('autobuilder-unit.js shell blocks (bash + scratch git repos)', () => {
  test('remote samples through the real in-shell validator (no URL ever printed)', () => {
    const r = runRemoteSamples(SCRIPT)
    expect(r.lines.filter((l: string) => l.startsWith('FAIL'))).toEqual([])
   }, 60_000)
  test('push block: plain push of exactly the SHA; non-fast-forward, moved HEAD and invalid branch refused; no git output relayed', () => {
    const r = realPush(shellBlock(loadScript(SCRIPT).src, 'PUSH_SH'))
    expect(r.line1).toBe(`PUSH exit=0 local=${r.sha} reason=ok`)
    expect(r.after1).toBe(r.sha)
    expect(r.line2).toMatch(new RegExp(`^PUSH exit=[1-9]\\d* local=${r.sha2} reason=push_failed$`)) // never forced
    expect(r.line3).toBe('PUSH exit=3 local=none reason=head_moved')
    expect(r.line4).toBe('PUSH exit=6 local=none reason=bad_branch')
    expect(r.afterAll).toBe(r.sha)
    expect(r.stderr).toBe('')
  })
  test('branch validation mirrors git check-ref-format --branch (and is never looser)', () => {
    const { src } = loadScript(SCRIPT)
    const branchOk = eval(src.match(/const branchOk = (b => .*)\n/)![1])
    const names = ['feat/u1', 'feat_1.2', 'head', 'x/HEAD', 'a-b/c.d', '.hidden', 'feat/.hidden', 'feat.lock/child', 'HEAD', '-x', 'a..b', 'a/', 'a//b', 'a.', 'feat/x.lock', 'a@{b', 'a b', 'a.lock', "x';id;'", 'a~b', 'a^b', 'a:b', 'a?b', 'a*b', 'a[b', 'a\\b']
    withTmp((dir: string) => {
      for (const n of names) {
        const gitOk = spawnSync('git', ['check-ref-format', '--branch', n], { env: gitEnv(dir), timeout: SUB_TIMEOUT_MS }).status === 0
        if (branchOk(n)) expect([n, gitOk]).toEqual([n, true]) // accepted only if git accepts it
        if (!gitOk) expect([n, branchOk(n)]).toEqual([n, false])
      }
    })
    for (const n of ['feat/u1', 'feat_1.2', 'a-b/c.d']) expect(branchOk(n)).toBe(true)
  })
  test('identity block removes its URL temp file when signalled (TERM, HUP, INT)', async () => {
    const idsh = shellBlock(loadScript(SCRIPT).src, 'ID_SH')
    for (const sig of ['SIGTERM', 'SIGHUP', 'SIGINT']) {
      const r = await realIdTrap(idsh, sig)
      expect([sig, r.held, r.left, r.code]).toEqual([sig, 1, 0, 1]) // the file existed, is gone, and the trap exited 1
    }
  }, 60_000)
  test('API block: self-describing answer, allowlisted reason codes, never a URL or raw stderr', () => {
    const api = shellBlock(loadScript(SCRIPT).src, 'API_SH')
    const sha = 'f'.repeat(40)
    const want: Record<string, [string, string?]> = {
      ok: [`API exit=0 ref=ok sha=${sha} reason=ok`], ghe: [`API exit=0 ref=ok sha=${sha} reason=ok`, 'ghe.corp.example'],
      otherrepo: [`API exit=0 ref=mismatch sha=${sha} reason=mismatch_url`], tag: [`API exit=0 ref=mismatch sha=${sha} reason=mismatch_ref`],
      empty: ['API exit=0 ref=none sha=none reason=empty'], '404': ['API exit=1 ref=none sha=none reason=api_error:http_404'],
      network: ['API exit=1 ref=none sha=none reason=api_error:network'],
    }
    for (const [mode, [line, host]] of Object.entries(want)) {
      const r = realApi(api, mode, host)
      expect([mode, r.stdout, r.stderr, r.left]).toEqual([mode, line, '', []])
      expect(r.stdout).not.toMatch(/:\/\/|ghp_|@/)
    }
    // host / owner / repo case-insensitive (GitHub's canonical SneakyGriff/Repo vs the lowercased argument) ...
    expect(realApi(api, 'canonicalcase', 'github.com', { OW: 'sneakygriff', RP: 'repo' }).stdout).toBe(`API exit=0 ref=ok sha=${sha} reason=ok`)
    // ... but the branch EXACT: an API ref feat/x never confirms a push of Feat/X
    expect(realApi(api, 'lowerref', 'github.com', { B: 'Feat/X' }).stdout).toBe(`API exit=0 ref=mismatch sha=${sha} reason=mismatch_ref`)
  }, 60_000)
})

const F40 = 'f'.repeat(40)
const SK_BRANCH = 'fix/' + fake.sk('validation-of-the-input-parser')
// Wall-clock bounds are derived from the block's own deadline + grace (seconds), with BOTH ends asserted:
// - lower: deadline + grace - 1.5 s. The block measures its deadline with `date +%s` (1 s granularity, so it can fire up
//   to 1 s early) and 0.5 s is jitter; anything above deadline + 0.5 s still proves the call was NOT killed at the
//   deadline but only after the grace (TERM ignored -> KILL G s later).
// - upper: deadline + grace + 4 s. Measured on this host: the stubborn call ends at 7.0-7.3 s (2 + 5 + ~0.2 s of bash,
//   timeout|perl and fake-gh start-up) and the cleanup at 8.0-8.1 s; 4 s is >10x that start-up overhead under a loaded
//   full-suite run, while a missing KILL would never end (the stubborn sleep runs for days).
const MARGIN_S = 4
const within = (ms: number, deadline: number, grace: number) => {
  expect(ms).toBeGreaterThanOrEqual((deadline + grace - 1.5) * 1000)
  expect(ms).toBeLessThan((deadline + grace + MARGIN_S) * 1000)
}
const noLeak = (r: { stdout: string, stderr: string, left: string[] }) => {
  expect(r.stderr).toBe('')
  expect(r.left).toEqual([])
  expect(r.stdout).not.toMatch(/:\/\/|ghp_|x-token|@/)
}
describe.skipIf(!POSIX || !hasJq())('autobuilder-unit.js URL-blind gh blocks (fake gh + real jq)', () => {
  const src = loadScript(SCRIPT).src
  test('PR identity block: exact fields only; gh errors become a code; a value outside its allowlist is rejected, never rewritten', () => {
    const prv = shellBlock(src, 'PRV_SH')
    const pr = (o: Record<string, unknown>) => JSON.stringify(Object.assign({ number: 12, state: 'OPEN', isCrossRepository: false, headRepository: { name: 'app' }, headRepositoryOwner: { login: 'acme' }, headRefName: 'feat/u1', headRefOid: F40 }, o))
    const env = { N: '12', X: 'github.com/acme/app' }
    let r = realGhBlock(prv, { json: pr({}), env }); noLeak(r)
    expect(r.stdout).toBe(`PR exit=0 number=12 state=OPEN cross=false head_repo=acme/app head_ref=feat/u1 head=${F40}`)
    r = realGhBlock(prv, { fail: 'dial tcp: no such host', env }); noLeak(r)
    expect(r.stdout).toBe('PR exit=1 reason=api_error:network')
    for (const [field, o] of [['head_ref', { headRefName: 'feat/u+1' }], ['head_ref', { headRefName: 'x $(id)\ty' }], ['head_repo', { headRepositoryOwner: { login: 'a b' } }], ['head', { headRefOid: 'F'.repeat(40) }]] as [string, Record<string, unknown>][]) {
      r = realGhBlock(prv, { json: pr(o), env }); noLeak(r)
      expect([field, r.stdout]).toEqual([field, `PR exit=0 reason=invalid_field:${field}`])
    }
    r = realGhBlock(prv, { json: pr({ headRefName: SK_BRANCH }), env }); noLeak(r)
    expect(r.stdout).toBe(`PR exit=0 number=12 state=OPEN cross=false head_repo=acme/app head_ref=${SK_BRANCH} head=${F40}`)
  })
  test('PATCH setup block: recorded PR from state.json or the archive; fetch errors become a code (no URL)', () => {
    const ps = shellBlock(src, 'PSETUP_SH')
    const json = JSON.stringify({ state: 'OPEN', isCrossRepository: false, headRepository: { name: 'app' }, headRepositoryOwner: { login: 'acme' }, headRefName: 'feat/u1' })
    const setup = (archive: boolean, badRemote: boolean) => (dir: string, g: (cwd: string, ...a: string[]) => string) => {
      const run = path.join(dir, 'run'), origin = path.join(dir, 'origin.git'), lane = path.join(dir, 'lane')
      fs.mkdirSync(run); fs.mkdirSync(lane)
      fs.writeFileSync(path.join(run, archive ? 'state.final.json' : 'state.json'), JSON.stringify({ prs: { U1: { pr: 12, branch: 'feat/u1' } } }))
      g(dir, 'init', '-q', '--bare', origin)
      g(lane, 'init', '-q'); g(lane, 'config', 'user.email', 't@t'); g(lane, 'config', 'user.name', 't')
      fs.writeFileSync(path.join(lane, 'a'), 'a\n'); g(lane, 'add', 'a'); g(lane, 'commit', '-qm', 'a'); g(lane, 'branch', '-M', 'feat/u1')
      g(lane, 'remote', 'add', 'origin', '--', origin); g(lane, 'push', '-q', 'origin', 'feat/u1')
      if (badRemote) g(lane, 'remote', 'set-url', 'origin', '--', fake.auth('https', 'x-token', fake.ghp('fakesecret123'), 'nonexistent.invalid/acme/app.git'))
      return { RUN: run, K: 'U1', N: '12', X: 'github.com/acme/app', L: lane, B: 'feat/u1' }
    }
    for (const archive of [false, true]) {
      const r = realGhBlock(ps, { json, setup: setup(archive, false) }); noLeak(r)
      expect(r.stdout).toMatch(new RegExp(`^SETUP recorded_pr=12 recorded_branch=feat/u1 state=OPEN cross=false head_repo=acme/app head_ref=feat/u1 head=([0-9a-f]{40}) remote_head=\\1 reason=ok$`))
    }
    const bad = realGhBlock(ps, { json, setup: setup(false, true) }); noLeak(bad)
    expect(bad.stdout).toMatch(/ head=none remote_head=none reason=fetch_error:(network|other|auth)$/)
    const plus = realGhBlock(ps, { json, setup: (dir: string, g: (cwd: string, ...a: string[]) => string) => { const e = setup(false, false)(dir, g); fs.writeFileSync(path.join(e.RUN, 'state.json'), JSON.stringify({ prs: { U1: { pr: 12, branch: 'feat/u+1' } } })); return e } }); noLeak(plus)
    expect(plus.stdout).toBe('SETUP reason=invalid_field:recorded_branch') // rejected, never rewritten to feat/u_1
    const ghFail = realGhBlock(ps, { fail: 'HTTP 404', setup: setup(false, false) }); noLeak(ghFail)
    expect(ghFail.stdout).toBe('SETUP recorded_pr=12 recorded_branch=feat/u1 reason=api_error:http_404')
  }, 60_000)
  test('CI block: bounded, exact-head, codes and counts only (no check names, no free text)', () => {
    const ci = shellBlock(src, 'CI_SH')
    const st = (head: string, mg: string, ms: string, checks: unknown[]) => JSON.stringify({ headRefOid: head, mergeable: mg, mergeStateStatus: ms, statusCheckRollup: checks })
    // TOTAL is generous (the answering cases return on the first poll, so it never costs time): a slow fake-gh start must
    // not turn ci:none / ci:pass into ci:timeout. Only the cases that EXPECT a timeout use a short TOTAL.
    const env = { N: '12', X: 'github.com/acme/app', H: F40, APPEAR: '0', TOTAL: '60', POLL: '1' }
    const ok = [{ __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'SUCCESS', name: 'test (ubuntu)' }]
    const cases: [string, string, RegExp][] = [
      ['ready', st(F40, 'MERGEABLE', 'CLEAN', ok), new RegExp(`^CI status=READY head=${F40} reason=ci:pass pass=1 fail=0 pending=0$`)],
      ['failing', st(F40, 'MERGEABLE', 'CLEAN', [{ __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'FAILURE', name: fake.auth('https', 'alice', 'privatePassword', 'ci.example/job') }, { __typename: 'StatusContext', state: 'SUCCESS', context: 'ci/x' }]), new RegExp(`^CI status=BLOCKED head=${F40} reason=ci:fail pass=1 fail=1 pending=0$`)],
      ['moved', st('1'.repeat(40), 'MERGEABLE', 'CLEAN', ok), new RegExp(`^CI status=BLOCKED head=${'1'.repeat(40)} reason=head_moved pass=1 fail=0 pending=0$`)],
      ['pending', st(F40, 'MERGEABLE', 'CLEAN', [{ __typename: 'CheckRun', status: 'IN_PROGRESS', conclusion: null, name: 't' }]), new RegExp(`^CI status=BLOCKED head=(none|${F40}) reason=ci:timeout pass=0 fail=0 pending=[01]$`)],
      ['nochecks', st(F40, 'MERGEABLE', 'CLEAN', []), new RegExp(`^CI status=READY head=${F40} reason=ci:none pass=0 fail=0 pending=0$`)],
      ['conflict', st(F40, 'CONFLICTING', 'DIRTY', ok), new RegExp(`^CI status=BLOCKED head=${F40} reason=not_mergeable pass=1 fail=0 pending=0$`)],
    ]
    for (const [name, json, line] of cases) { const r = realGhBlock(ci, { json, env: name === 'pending' ? Object.assign({}, env, { TOTAL: '2' }) : env }); noLeak(r); expect([name, line.test(r.stdout)]).toEqual([name, true]); expect(r.stdout).not.toMatch(/alice|privatePassword|ci\/x|ubuntu/) }
    const f = realGhBlock(ci, { fail: 'HTTP 502', env }); noLeak(f)
    expect(f.stdout).toBe('CI status=BLOCKED head=none reason=api_error:http_5xx pass=0 fail=0 pending=0')
    // a stalled gh call cannot outlive TOTAL: it is killed with its whole process group at the remaining deadline
    const t0 = Date.now()
    const stall = realGhBlock(ci, { json: st(F40, 'MERGEABLE', 'CLEAN', []), env: Object.assign({}, env, { TOTAL: '2', FAKE_SLEEP: '30' }) }); noLeak(stall)
    expect(stall.stdout).toBe('CI status=BLOCKED head=none reason=ci:timeout pass=0 fail=0 pending=0')
    within(Date.now() - t0, 2, 0) // gh honours TERM: it ends AT the 2 s deadline (no grace needed), far below the 30 s stall
  }, 60_000)
  // kill escalation: a TERM-resistant gh (and its child) is TERMed at the deadline and KILLed G=5 s later, with its
  // whole process group, on the timeout/gtimeout path and on the perl-watchdog path (PATH without timeout/gtimeout)
  const env = { N: '12', X: 'github.com/acme/app', H: F40, APPEAR: '0', POLL: '1' }
  const mark = (base: number) => String(base + Math.floor(Math.random() * 90_000))
  for (const noTimeout of [false, true]) {
    const where = noTimeout ? 'perl watchdog' : 'timeout -k'
    const t = noTimeout ? test : test.skipIf(!hasTimeout()) // the timeout -k variant must really run timeout / gtimeout
    t(`CI block: a TERM-resistant gh ends within deadline + grace, no descendants survive (${where})`, () => {
      const ci = shellBlock(src, 'CI_SH'), m = mark(noTimeout ? 4_300_000 : 4_400_000)
      const r = realGhBlock(ci, { env: Object.assign({}, env, { TOTAL: '2', FAKE_STUBBORN: m }), noTimeout }); noLeak(r)
      const left = survivors(m)
      expect(r.stdout).toBe('CI status=BLOCKED head=none reason=ci:timeout pass=0 fail=0 pending=0')
      within(r.ms, 2, 5) // TERM ignored: KILLed G=5 s after the 2 s deadline, never before, never much later
      expect(left).toBe('')
    }, 60_000)
    t(`CI block: gh honours TERM but its TERM-ignoring grandchild is KILLed with the group (${where})`, () => {
      const m = mark(noTimeout ? 5_100_000 : 5_200_000)
      const r = realGhBlock(shellBlock(src, 'CI_SH'), { env: Object.assign({}, env, { TOTAL: '2', FAKE_ORPHAN: m }), noTimeout }); noLeak(r)
      const left = survivors(m)
      expect(r.stdout).toBe('CI status=BLOCKED head=none reason=ci:timeout pass=0 fail=0 pending=0')
      expect(left).toBe('')
    }, 60_000)
    for (const shell of ['bash', 'zsh']) {
      t.skipIf(shell === 'zsh' && !hasZsh())(`ciWait cleanup (${shell}) kills the watcher's group and its descendants' groups: TERM-resistant gh mid-call, nothing survives (${where})`, async () => {
        const m = mark(noTimeout ? 4_500_000 : 4_600_000)
        const c = await realCiCleanup(shellBlock(src, 'CI_SH'), shellBlock(src, 'CI_RUN'), shellBlock(src, 'CI_STOP'), m, { env: Object.assign({}, env, { TOTAL: '600' }), noTimeout, shell })
        expect(c.started).toBe(true)
        expect(c.out).toBe('CI_STOP ok')
        within(c.ms, 0, 8) // CI_STOP's own TERM -> 8 s -> KILL
        expect(c.alive).toBe(false)
        expect(c.left).toBe('')
      }, 60_000)
    }
  }
  test('ciWait cleanup with an empty ps -A listing still signals the validated watcher group (seeded) and reports ok only then', async () => {
    const m = mark(5_300_000)
    const c = await realCiCleanup(shellBlock(src, 'CI_SH'), shellBlock(src, 'CI_RUN'), shellBlock(src, 'CI_STOP'), m, { env: Object.assign({}, env, { TOTAL: '600' }), psNoTree: true })
    expect([c.started, c.out, c.alive, c.left]).toEqual([true, 'CI_STOP ok', false, ''])
  }, 60_000)
  // P1 (fe287c15 review): an empty / missing / 0 / 1 / own-pgid / foreign pid file must never become a group kill
  // (`kill -- -0` under zsh is the caller's own group): CI_STOP prints a skip reason, the caller and the decoy survive
  for (const shell of ['bash', 'zsh']) {
    test.skipIf(shell === 'zsh' && !hasZsh())(`CI_STOP guard under ${shell}: no pid / 0 / 1 / own pgid / not the watcher -> no kill`, () => {
      const stop = shellBlock(src, 'CI_STOP')
      const cases: [string | null, string][] = [[null, 'no_pid'], ['', 'no_pid'], ['\n', 'no_pid'], ['0', 'no_pid'], ['00', 'no_pid'], ['1', 'own_group'], ['-1', 'no_pid'], ['12 34', 'no_pid'], ['SELF', 'own_group'], ['DECOY', 'not_watcher'], ['FOOL', 'not_watcher']]
      for (const [pf, why] of cases) {
        const r = ciStopGuard(stop, shell, pf)
        expect([pf, r.stdout, r.status, r.signal]).toEqual([pf, `CI_STOP skip=${why}\nSURVIVED`, 0, null])
        if (pf === 'DECOY' || pf === 'FOOL') expect([pf, r.decoyAlive]).toEqual([pf, true])
      }
    }, 60_000)
  }
})

describe.skipIf(!POSIX)('autobuilder-unit.js literal pathspecs (real git)', () => {
  // round 21: [locale] is a ONE-character glob in a git pathspec. The delta-review command the script writes must be
  // literal: run verbatim (with --name-only) against a scratch repo it names exactly src/app/[locale]/page.tsx and never
  // the sibling src/app/l/page.tsx; the same command without --literal-pathspecs DOES sweep the sibling in (control).
  test('the delta-review diff command scopes [locale] literally, never its one-character-glob sibling', async () => {
    const sc = await runScenario('nextLocaleScopeLiteral', SCRIPT)
    expect(sc.ok).toBe(true)
    const dp = (sc.calls.find((x: { label: string }) => /^ship delta review/.test(x.label)) || { prompt: '' }).prompt
    const m = dp.match(/(git -C \/lane --literal-pathspecs diff [0-9a-f]{40}\.\.[0-9a-f]{40} -- '[^']+')\./)
    expect(m).not.toBeNull()
    withTmp((dir: string) => {
      const R = path.join(dir, 'repo'); fs.mkdirSync(R)
      const env = gitEnv(dir, {})
      const g = (...a: string[]) => { const r = spawnSync('git', ['-C', R, ...a], { encoding: 'utf8', timeout: SUB_TIMEOUT_MS, env }); if (r.status !== 0) throw new Error(r.stderr); return r.stdout.trim() }
      g('init', '-q'); g('config', 'user.email', 't@example.invalid'); g('config', 'user.name', 't')
      for (const f of ['src/app/[locale]/page.tsx', 'src/app/l/page.tsx']) { fs.mkdirSync(path.join(R, path.dirname(f)), { recursive: true }); fs.writeFileSync(path.join(R, f), 'a\n') }
      g('add', '-A'); g('commit', '-q', '-m', 'a'); const A = g('rev-parse', 'HEAD')
      for (const f of ['src/app/[locale]/page.tsx', 'src/app/l/page.tsx']) fs.writeFileSync(path.join(R, f), 'b\n')
      g('commit', '-q', '-am', 'b'); const B = g('rev-parse', 'HEAD')
      const cmd = m![1].replace('git -C /lane ', `git -C '${R}' `).replace(/[0-9a-f]{40}\.\.[0-9a-f]{40}/, `${A}..${B}`).replace(' diff ', ' diff --name-only ')
      for (const sh of hasZsh() ? ['bash', 'zsh'] : ['bash']) { // the agent's shell may be zsh: same result
        const run = (c: string) => spawnSync(sh, ['-c', c], { encoding: 'utf8', timeout: SUB_TIMEOUT_MS, env }).stdout.trim()
        expect([sh, run(cmd)]).toEqual([sh, 'src/app/[locale]/page.tsx'])
        expect(run(cmd.replace(' --literal-pathspecs', '')).split('\n')).toContain('src/app/l/page.tsx') // the hazard is real
      }
    })
  }, 60_000)
  // round 22: a withheld credential-shaped path is resolvable by the agent: the resolver command the r2 mutation prompt
  // carries, run verbatim (bash and zsh) in a scratch repo where that path changed, prints "<id> <path>" with the id the
  // prompt names (the pure-JS SHA-1 over a > 60-char path agrees with git hash-object)
  test('the resolve-by-id command in a prompt maps <path:ID> back to the exact token-shaped path (pinned to the lane)', async () => {
    const sc = await runScenario('r2TokenPathMutationScoped', SCRIPT)
    expect(sc.ok).toBe(true)
    const mp = (sc.calls.find((x: { label: string }) => x.label === 'r2 mutation') || { prompt: '' }).prompt
    const id = (mp.match(/<path:([0-9a-f]{12})>/) || [])[1]
    const m = mp.match(/resolve ids locally with (git -C '\/lane' diff --name-only [0-9a-f]{40}\.\.[0-9a-f]{40} \| while .*? \| awk '.*?'); refer/)
    expect(id).toBeTruthy()
    expect(m).not.toBeNull()
    expect(m![1]).not.toContain('\n') // one line: printf's \n is the two characters, not a line break
    expect(m![1].match(/git -C '\/lane' /g)!.length).toBe(2) // both git calls pinned to the lane
    const P = `config/secrets/${fake.sk('longPathToken' + 'Q'.repeat(40))}/settings.ts`
    withTmp((dir: string) => {
      const R = path.join(dir, 'repo'), OUT = path.join(dir, 'elsewhere'), S256 = path.join(dir, 'sha256repo')
      fs.mkdirSync(R); fs.mkdirSync(OUT); fs.mkdirSync(S256)
      const env = gitEnv(dir, {})
      const g = (cwd: string, ...a: string[]) => { const r = spawnSync('git', ['-C', cwd, ...a], { encoding: 'utf8', timeout: SUB_TIMEOUT_MS, env }); if (r.status !== 0) throw new Error(r.stderr); return r.stdout.trim() }
      g(R, 'init', '-q'); g(R, 'config', 'user.email', 't@example.invalid'); g(R, 'config', 'user.name', 't')
      fs.writeFileSync(path.join(R, 'a.ts'), 'a\n'); g(R, 'add', '-A'); g(R, 'commit', '-q', '-m', 'a'); const A = g(R, 'rev-parse', 'HEAD')
      fs.mkdirSync(path.join(R, path.dirname(P)), { recursive: true }); fs.writeFileSync(path.join(R, P), 'x\n'); g(R, 'add', '-A'); g(R, 'commit', '-q', '-m', 'b'); const B = g(R, 'rev-parse', 'HEAD')
      const s256 = spawnSync('git', ['init', '-q', '--object-format=sha256', S256], { encoding: 'utf8', timeout: SUB_TIMEOUT_MS, env }).status === 0
      const cmd = m![1].split("git -C '/lane' ").join(`git -C '${R}' `).replace(/[0-9a-f]{40}\.\.[0-9a-f]{40}/, `${A}..${B}`)
      // run from a NON-repo cwd and from inside a sha256 repository: the ids are the lane's, never the cwd's
      for (const cwd of s256 ? [OUT, S256] : [OUT]) for (const sh of hasZsh() ? ['bash', 'zsh'] : ['bash']) {
        const out = spawnSync(sh, ['-c', cmd], { cwd, encoding: 'utf8', timeout: SUB_TIMEOUT_MS, env }).stdout.trim()
        expect([cwd === OUT ? 'non-repo' : 'sha256', sh, out]).toEqual([cwd === OUT ? 'non-repo' : 'sha256', sh, `${id} ${P}`])
      }
      // forced duplicate prefix: cut the ids to 1 hex char over 17 changed paths (pigeonhole: two must share it); the
      // resolver prints ONLY "AMBIGUOUS <id>" and fails, never two mappings for one id
      for (let i = 0; i < 17; i++) fs.writeFileSync(path.join(R, `f${i}.ts`), `${i}\n`)
      g(R, 'add', '-A'); g(R, 'commit', '-q', '-m', 'c'); const C = g(R, 'rev-parse', 'HEAD')
      const dup = cmd.replace(`${A}..${B}`, `${B}..${C}`).replace('cut -c1-12', 'cut -c1-1')
      for (const sh of hasZsh() ? ['bash', 'zsh'] : ['bash']) {
        const r = spawnSync(sh, ['-c', dup], { cwd: OUT, encoding: 'utf8', timeout: SUB_TIMEOUT_MS, env })
        expect([sh, r.status !== 0, /^AMBIGUOUS [0-9a-f]$/.test(r.stdout.trim())]).toEqual([sh, true, true])
      }
    })
  }, 60_000)
  // round 23: ids are lengthened per rendered list until distinct paths differ (forced duplicate 12-hex prefix)
  test('assignIds lengthens colliding ids (forced duplicate prefix) and keeps 12 hex otherwise', () => {
    const src = loadScript(SCRIPT).src
    const a = src.indexOf('function assignIds('), b = src.indexOf('\n}\n', a) + 2
    const assignIds = new Function('arr', `${src.slice(a, b)}; return assignIds`)((x: unknown) => Array.isArray(x) ? x : [])
    const pre = 'abcdef012345'
    const forced = (f: string) => f === 'x' ? pre + '0' + 'a'.repeat(27) : f === 'y' ? pre + '1' + 'b'.repeat(27) : pre + '1' + 'c'.repeat(27)
    const two = assignIds(['x', 'y', 'x'], forced)
    expect([two.n, two.id('x'), two.id('y')]).toEqual([13, pre + '0', pre + '1'])
    const three = assignIds(['x', 'y', 'z'], forced) // y and z share 13 hex: 14
    expect([three.n, new Set(['x', 'y', 'z'].map(three.id)).size]).toEqual([14, 3])
    const none = assignIds(['x'], forced)
    expect(none.n).toBe(12)
  })
  // round 23 negative controls: mutated copies of the script that leak a credential component the generic assertion
  // must catch WITHOUT any per-scenario secret (genericOnly): the userinfo password alone, the scrubbed
  // config/<token>.ts form, a lowercased token path, a truncated token; the unmutated script passes the same runs
  test('generic leak assertion: negative controls (password alone, config/<token>.ts, case-folded, truncated)', async () => {
    const src = fs.readFileSync(SCRIPT, 'utf8')
    const site = 'upgrade(`sensitive path(s) ${showPaths(sens.slice(0, 5))}`, 0)'
    expect(src.includes(site)).toBe(true)
    const mutants: [string, string, string][] = [
      ['password alone', 'userinfoPathSensitiveFull', 'upgrade(`sensitive path(s) ${sens.map(f => String(f).replace(/^.*:([^@]*)@.*$/, "$1")).join(", ")}`, 0)'],
      ['scrubbed form', 'tokenPathSensitiveFull', 'upgrade(`sensitive path(s) ${sens.map(scrubText).join(", ")}`, 0)'],
      ['case-folded', 'tokenPathSensitiveFull', 'upgrade(`sensitive path(s) ${sens.map(f => String(f).toLowerCase()).join(", ")}`, 0)'],
      ['truncated token', 'tokenPathSensitiveFull', 'upgrade(`sensitive path(s) ${sens.map(f => String(f).slice(0, 29)).join(", ")}`, 0)'],
    ]
    for (const name of ['userinfoPathSensitiveFull', 'tokenPathSensitiveFull']) expect([name, (await runScenario(name, SCRIPT, { genericOnly: true })).ok]).toEqual([name, true])
    await (async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'abu-mut-'))
      try {
        for (const [what, scen, repl] of mutants) {
          const f = path.join(dir, 'm.js'); fs.writeFileSync(f, src.replace(site, repl))
          const r = await runScenario(scen, f, { genericOnly: true })
          expect([what, r.ok, r.leaks.length > 0]).toEqual([what, false, true])
        }
      } finally { fs.rmSync(dir, { recursive: true, force: true }) }
    })()
  }, 60_000)
  // rounds 22-23 (structural): no raw repo-path list reaches a prompt, message or JSON. Every J(...) argument and every
  // template ${...} is reduced to its CODE (string literals and template text removed, renderer calls removed:
  // renderPaths / showPaths / showPath / pathIdList / shellPaths / scopeText); what remains must not name a path list or
  // path field, wrapped or not (J(delta.map(...)), J(r.files), J(touches(delta, X)), ${integ}...). Allowed: X.length and
  // a bare truthiness test (X ? ...). It CANNOT see: an alias (const x = delta; J(x)), a list passed into a helper that
  // interpolates it under another name, or concatenation outside J()/templates; the runtime generic assertion covers
  // those for every scenario that feeds a credential-shaped path.
  test('static: path lists are interpolated only through the renderers (wrapped forms too)', () => {
    const src = loadScript(SCRIPT).src
    const NAMES = /\b(delta|sinceBase|scope|files|sens|late|lateCode|treeLate|plain|held|files_since_base|files_since_prev|files_since|tree_delta)\b|\b(integ|gs|fl|hf|gd)\b(?!\.)/
    const RENDER = /\b(renderPaths|showPaths|showPath|pathIdList|shellPaths|scopeText)\(/
    const bal = (t: string, i: number, o: string, c: string) => { let d = 0; for (let j = i; j < t.length; j++) { if (t[j] === o) d++; else if (t[j] === c && --d === 0) return j } return -1 }
    const code = (t: string): string => { // drop quoted text, keep ${...} code of templates (recursively)
      let out = ''
      for (let i = 0; i < t.length; i++) {
        const ch = t[i]
        if (ch === "'" || ch === '"') { const q = ch; i++; while (i < t.length && t[i] !== q) { if (t[i] === '\\') i++; i++ } continue }
        if (ch === '`') { i++; while (i < t.length && t[i] !== '`') { if (t[i] === '\\') { i += 2; continue } if (t[i] === '$' && t[i + 1] === '{') { const e = bal(t, i + 1, '{', '}'); out += ' (' + code(t.slice(i + 2, e)) + ') '; i = e + 1; continue } i++ } continue }
        out += ch
      }
      return out
    }
    const strip = (t: string) => { let m; while ((m = RENDER.exec(t))) { const e = bal(t, m.index + m[0].length - 1, '(', ')'); t = t.slice(0, m.index) + 'R' + t.slice(e + 1) } return t }
    const bad: string[] = []
    for (const [re, o, c] of [[/\bJ\(/g, '(', ')'], [/\$\{/g, '{', '}']] as [RegExp, string, string][]) {
      let m: RegExpExecArray | null
      while ((m = re.exec(src))) {
        const s0 = m.index + m[0].length - 1, e = bal(src, s0, o, c)
        if (e < 0) continue
        const rest = strip(code(src.slice(s0 + 1, e))).replace(/\b\w+\.length\b/g, 'N').replace(/\b(\w+)\s*\?/g, 'C ?')
        if (NAMES.test(rest)) bad.push(`${src.slice(0, m.index).split('\n').length}: ${m[0]}${src.slice(s0 + 1, Math.min(e, s0 + 100))}`)
      }
    }
    expect(bad).toEqual([])
    // the checker itself sees the wrapped regressions it exists for
    for (const probe of ['J(delta.map(f => f))', 'J(r.files)', 'J(touches(delta, X))', '${J(delta.slice(0, 5))}', '${integ}', '${gd.g.tree_delta.join(", ")}']) {
      const isJ = probe.startsWith('J(')
      const inner = isJ ? probe.slice(2, -1) : probe.slice(2, -1)
      expect([probe, NAMES.test(strip(code(inner)).replace(/\b\w+\.length\b/g, 'N').replace(/\b(\w+)\s*\?/g, 'C ?'))]).toEqual([probe, true])
    }
  })
})

describe.skipIf(!POSIX)('autobuilder-unit.js mock harness scenarios', () => {
  for (const name of Object.keys(scenarios)) {
    test(name, async () => {
      const r = await runScenario(name, SCRIPT)
      if (!r.ok) throw new Error(r.detail)
      expect(r.ok).toBe(true)
    })
  }
})

// Scripted reviewer responses exercise the real L2 decoder and the workflow's gate transitions.
// This is a free policy/transport regression, not evidence of live model instruction compliance.
describe.skipIf(!POSIX || !hasJq())('Seat C L2 required-reference failures', () => {
  for (const input of [
    { name: 'missing rubric blocks after retry', broken: 'rubric', unreadable: false, recover: false, critical: false },
    { name: 'unreadable checklist blocks after retry', broken: 'checklist', unreadable: true, recover: false, critical: false },
    { name: 'restored rubric permits a completed retry', broken: 'rubric', unreadable: false, recover: true, critical: false },
    { name: 'missing checklist blocks a critical gate immediately', broken: 'checklist', unreadable: false, recover: false, critical: true },
  ]) {
    test(input.name, async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'abu-l2-ref-'))
      const scenarioName = `l2-reference-${input.name}`
      let attempts = 0
      try {
        for (const ref of ['rubric', 'checklist']) {
          const file = path.join(dir, ref)
          if (ref !== input.broken) fs.writeFileSync(file, 'Required review criteria.\n')
          // A directory fails readFileSync deterministically even when tests run as root.
          else if (input.unreadable) fs.mkdirSync(file)
        }
        scenarios[scenarioName] = {
          args: { maxRounds: 1, autoFourth: false, acceptDegraded: 'operator accepts absent seats', shipOpenP1: 'operator accepts open findings', gateClass: input.critical ? 'critical' : 'ordinary' },
          override(label: string, opts: { model: string }, prompt: string) {
            if (/seat C \(L2/.test(label)) {
              attempts++
              expect(prompt).toContain('If the rubric or checklist is missing or unreadable, return REVIEW_INCOMPLETE, never clean.')
              expect(prompt).toContain('If the required rubric or checklist is missing or unreadable, end with REVIEW_INCOMPLETE: <reason>')
              expect(prompt).toContain('never substitute remembered methodology or emit REVIEW_COMPLETE')
              expect(prompt).not.toContain('apply the methodology named here from your own knowledge')
              if (input.recover && attempts === 2) fs.writeFileSync(path.join(dir, input.broken), 'Restored review criteria.\n')
              let review = 'No findings.\nREVIEW_COMPLETE: findings=0\n'
              for (const ref of ['rubric', 'checklist']) {
                try { fs.readFileSync(path.join(dir, ref), 'utf8') }
                catch { review = `REVIEW_INCOMPLETE: ${ref} missing or unreadable\n`; break }
              }
              const out = path.join(dir, 'review.json')
              fs.writeFileSync(out, JSON.stringify({ result: review }))
              fs.writeFileSync(`${out}.status.json`, JSON.stringify({ class: 'ok', exit: 0, exit_code: 0, runtime_model: 'claude-opus-5-5', tainted: false }))
              // Execute the adjudication block actually supplied to the L2 relay, not a copied validator.
              const block = prompt.match(/\n(S="\$OUT\.status\.json"; TXT="\$ADIR\/review\.txt"[\s\S]*?)\n6\. cp/)
              expect(block).not.toBeNull()
              const adjudicated = spawnSync('bash', ['-c', block![1]], { encoding: 'utf8', env: { ...process.env, OUT: out, ADIR: dir }, timeout: SUB_TIMEOUT_MS })
              expect(adjudicated.status).toBe(0)
              expect(adjudicated.stderr).toBe('')
              const verdictLine = adjudicated.stdout.trim()
              expect(verdictLine).toContain(review.startsWith('REVIEW_INCOMPLETE') ? 'status=INVALID class=ok reason=no-completion-marker' : 'status=PRESENT class=ok reason=complete')
              // Even an optimistic relay cannot turn the real INVALID line into a PASS.
              return { member: 'seat_c', status: 'PRESENT', verdict: 'PASS', class: 'ok', verdict_line: verdictLine }
            }
            if (/seat C/.test(label) && opts.model !== 'haiku') return null // both L1 accounts unavailable
          },
          expect: () => true,
        }
        const run = await runScenario(scenarioName, SCRIPT)
        if (!run.ok) throw new Error(run.detail)
        const rounds = run.res.rounds.filter((round: { round?: number }) => round.round)
        expect(rounds[0].members_present.seat_c).toBe('INVALID')
        expect(attempts).toBe(input.critical ? 1 : 2)
        expect(rounds[0].verdict).toBe(input.critical ? 'BLOCKED' : 'RERUN_INVALID')
        if (input.recover) {
          expect(run.res.status).toBe('READY')
          expect(rounds[1].members_present.seat_c).toBe('PRESENT')
          expect(rounds[1].verdict).toBe('CLEAN')
        } else {
          expect(run.res.status).toBe('BLOCKED')
          expect(run.res.stopped).toContain(input.critical ? 'INVALID on a critical gate' : 'INVALID again')
          expect(run.calls.some((call: { label: string }) => /\/ship| push$/.test(call.label))).toBe(false)
        }
      } finally {
        delete scenarios[scenarioName]
        fs.rmSync(dir, { recursive: true, force: true })
      }
    })
  }
})
