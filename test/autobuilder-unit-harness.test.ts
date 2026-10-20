// autobuilder-loop/autobuilder-unit.js — the reference unit workflow of /autobuilder-loop.
// Runs the mock harness (one test per scenario), the sensitive-path classifier samples, the remote-URL samples
// against the script's real in-shell validator, the byte-stability check, the real push block check (plain push; non-fast-forward, moved HEAD and invalid branch refused), the
// runtime-equivalent parse and the forbidden-name check. Hermetic: no network and no real gh / codex / claude; the
// only subprocesses are bash and git on scratch repositories under os.tmpdir(), removed after each use.
// Fixtures: test/fixtures/autobuilder-unit/{lib,harness,classifier-samples,remote-samples,stable}.mjs
import { describe, test, expect, setDefaultTimeout } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const ROOT = path.join(import.meta.dir, '..')
const SCRIPT = path.join(ROOT, 'autobuilder-loop', 'autobuilder-unit.js')
const FIX = path.join(import.meta.dir, 'fixtures', 'autobuilder-unit')
const POSIX = process.platform !== 'win32' // bash + git scratch repositories
// every test here spawns bash / git / jq / perl subprocesses: under load the bun default (5 s) is a flake, not a signal;
// each test's own deadlines are asserted explicitly (BOUND) and every sync spawn is bounded by SUB_TIMEOUT_MS
setDefaultTimeout(120_000)

const { scenarios, runScenario } = await import(path.join(FIX, 'harness.mjs'))
const { runClassifierSamples } = await import(path.join(FIX, 'classifier-samples.mjs'))
const { runRemoteSamples } = await import(path.join(FIX, 'remote-samples.mjs'))
const { runStable } = await import(path.join(FIX, 'stable.mjs'))
const { loadScript, shellBlock, realPush, realApi, realIdTrap, realGhBlock, realCiCleanup, ciStopGuard, survivors, hasTimeout, hasZsh, hasJq, gitEnv, withTmp, SUB_TIMEOUT_MS, fake } = await import(path.join(FIX, 'lib.mjs'))

describe('autobuilder-unit.js static checks', () => {
  test('runtime-equivalent parse: the body after meta compiles as an async function body', () => {
    const { body } = loadScript(SCRIPT)
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
    expect(() => new AsyncFunction('args', 'agent', 'parallel', 'phase', 'log', body)).not.toThrow()
  })
  test('no project-specific names and no Grok', () => {
    const src = fs.readFileSync(SCRIPT, 'utf8')
    expect(src.match(/beneficii|bookingsystem|SU-[0-9]|grok/gi)).toBeNull()
  })
  test('no bare `git push origin`, no merges, no credit billing', () => {
    const src = fs.readFileSync(SCRIPT, 'utf8').split('\n').filter(l => !l.trim().startsWith('//')).join('\n') // code + prompts, not comments
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
// wall-clock bounds derive from the block's own deadlines (seconds) plus generous headroom, never a tight absolute time
const BOUND = (deadline: number, grace: number) => (deadline + grace + 12) * 1000
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
    expect(Date.now() - t0).toBeLessThan(BOUND(2, 5)) // far below the 30 s stall
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
      expect(r.ms).toBeLessThan(BOUND(2, 5)) // TOTAL + G + headroom (the TERM-resistant call would otherwise never end)
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
        expect(c.ms).toBeLessThan(BOUND(0, 8)) // the cleanup's own 8 s grace + headroom
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

describe.skipIf(!POSIX)('autobuilder-unit.js mock harness scenarios', () => {
  for (const name of Object.keys(scenarios)) {
    test(name, async () => {
      const r = await runScenario(name, SCRIPT)
      if (!r.ok) throw new Error(r.detail)
      expect(r.ok).toBe(true)
    })
  }
})
