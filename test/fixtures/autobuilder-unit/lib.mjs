// Shared helpers for the autobuilder-unit.js mock harness and samples (test/autobuilder-unit-harness.test.ts).
// Hermetic: no network, no gh / codex / claude; scratch git repositories only, under os.tmpdir(), always removed.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync, spawnSync, spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// every synchronous subprocess is bounded (test/spawnsync-timeout-tripwire.test.ts)
export const SUB_TIMEOUT_MS = 30_000
export const HERE = path.dirname(fileURLToPath(import.meta.url))
export const DEFAULT_SCRIPT = path.resolve(HERE, '..', '..', '..', 'autobuilder-loop', 'autobuilder-unit.js')
// Synthetic credential-shaped test data, assembled at runtime from pieces: no source line holds a literal token or a
// URL with userinfo (a pre-push secret scanner reads source text). Each helper returns the exact string it stands for.
export const fake = {
  ghp: s => 'gh' + 'p_' + s,
  gho: s => 'gh' + 'o_' + s,
  pat: s => 'github' + '_pat_' + s,
  sk: s => 's' + 'k-' + s,
  auth: (scheme, user, pass, rest) => scheme + '://' + user + ':' + pass + '@' + rest,
}

// The Workflow runtime compiles the body after `export const meta = {...}` as an async function body.
export function loadScript(scriptPath = DEFAULT_SCRIPT) {
  const src = fs.readFileSync(scriptPath, 'utf8')
  const body = src.slice(src.indexOf('\n}\n', src.indexOf('export const meta')) + 3)
  return { src, body }
}

// A shell block embedded as `const NAME = String.raw\`...\`.split('@{').join('${')`
export function shellBlock(src, name) {
  const k = `const ${name} = String.raw\``
  const a = src.indexOf(k)
  if (a < 0) throw new Error(`shell block ${name} not found`)
  return src.slice(a + k.length, src.indexOf('`.split(', a)).split('@{').join('${')
}

// Hermetic git for scratch repositories: every GIT_* variable of the caller is dropped (GIT_DIR, GIT_WORK_TREE,
// GIT_COMMON_DIR, GIT_CONFIG_*, GIT_TEMPLATE_DIR, ...), system and global config are off, HOME is a scratch directory
// and the init template directory is empty, so nothing outside the scratch tree is read, written or executed.
export function gitEnv(dir, extra = {}) {
  const env = {}
  for (const [k, v] of Object.entries(process.env)) if (!k.startsWith('GIT_')) env[k] = v
  const home = path.join(dir, '.home'), tpl = path.join(dir, '.git-template')
  fs.mkdirSync(home, { recursive: true }); fs.mkdirSync(tpl, { recursive: true })
  return Object.assign(env, { HOME: home, XDG_CONFIG_HOME: home, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: os.devNull, GIT_TEMPLATE_DIR: tpl, GIT_TERMINAL_PROMPT: '0' }, extra)
}
const git = (dir, cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', env: gitEnv(dir), timeout: SUB_TIMEOUT_MS })

export function withTmp(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'abu-harness-'))
  try { return fn(dir) } finally { fs.rmSync(dir, { recursive: true, force: true }) }
}

// Run the script's real ID_SH against scratch repositories configured from `spec`:
// { repo_url, lane_url (null/'' = no origin), push_urls: [pushurl entries], push_instead_of: [base, value] }
const ID_CACHE = new Map()
export function realIdentity(idsh, spec) {
  const key = idsh + '\0' + JSON.stringify(spec)
  if (!ID_CACHE.has(key)) ID_CACHE.set(key, runIdentity(idsh, spec))
  return ID_CACHE.get(key).slice()
}
function runIdentity(idsh, spec) {
  return withTmp(dir => {
    const R = path.join(dir, 'repo'), L = path.join(dir, 'lane')
    for (const d of [R, L]) { fs.mkdirSync(d); git(dir, d, 'init', '-q') }
    if (spec.repo_url) git(dir, R, 'remote', 'add', 'origin', '--', spec.repo_url)
    if (spec.lane_url) {
      git(dir, L, 'remote', 'add', 'origin', '--', spec.lane_url)
      for (const p of spec.push_urls || []) git(dir, L, 'config', '--add', 'remote.origin.pushurl', p)
      if (spec.push_instead_of) git(dir, L, 'config', `url.${spec.push_instead_of[1]}.pushInsteadOf`, spec.push_instead_of[0])
    }
    const file = path.join(dir, 'id.sh')
    fs.writeFileSync(file, idsh + '\n')
    const r = spawnSync('bash', [file], { encoding: 'utf8', env: gitEnv(dir, { R, L }), timeout: SUB_TIMEOUT_MS })
    // what the identity agent would see is stdout AND stderr: neither may carry any configured URL
    const urls = [spec.repo_url, spec.lane_url, ...(spec.push_urls || []), ...(spec.push_instead_of || [])].filter(u => u && u.trim().length >= 6)
    const seen = String(r.stdout || '') + String(r.stderr || '')
    const leak = urls.find(u => seen.includes(u))
    if (leak) throw new Error(`ID_SH output leaked a remote URL: ${JSON.stringify(leak)}`)
    return String(r.stdout || '').split('\n').filter(l => l !== '')
  })
}

export const SHA = n => String(n).repeat(40).slice(0, 40)

// Run the script's REAL PUSH_SH against a scratch lane and a local bare origin: the happy push, a non-fast-forward
// (refused, never forced), a moved HEAD and an invalid branch (both refused before pushing). Outcome verification is the
// forge API's job (pushAndVerify), exercised by the harness scenarios.
export function realPush(pushsh) {
  return withTmp(dir => {
    const origin = path.join(dir, 'origin.git'), lane = path.join(dir, 'lane')
    execFileSync('git', ['init', '-q', '--bare', origin], { env: gitEnv(dir), timeout: SUB_TIMEOUT_MS })
    fs.mkdirSync(lane)
    git(dir, lane, 'init', '-q'); git(dir, lane, 'config', 'user.email', 't@t'); git(dir, lane, 'config', 'user.name', 't')
    fs.writeFileSync(path.join(lane, 'a'), 'a\n'); git(dir, lane, 'add', 'a'); git(dir, lane, 'commit', '-qm', 'a'); git(dir, lane, 'branch', '-M', 'feat')
    git(dir, lane, 'remote', 'add', 'origin', origin)
    const sha = git(dir, lane, 'rev-parse', 'HEAD').trim()
    const file = path.join(dir, 'push.sh')
    fs.writeFileSync(file, pushsh + '\n')
    const run = (S, B = 'feat/u1') => spawnSync('bash', [file], { encoding: 'utf8', env: gitEnv(dir, { L: lane, S, B }), timeout: SUB_TIMEOUT_MS })
    const ref = () => spawnSync('git', ['--git-dir', origin, 'rev-parse', '-q', '--verify', 'refs/heads/feat/u1'], { encoding: 'utf8', env: gitEnv(dir), timeout: SUB_TIMEOUT_MS }).stdout.trim() || 'none'
    const r1 = run(sha)
    const after1 = ref()
    git(dir, lane, 'checkout', '-q', '--orphan', 'other'); fs.writeFileSync(path.join(lane, 'b'), 'b\n'); git(dir, lane, 'add', 'b'); git(dir, lane, 'commit', '-qm', 'b')
    const sha2 = git(dir, lane, 'rev-parse', 'HEAD').trim()
    const r2 = run(sha2) // diverged: non-fast-forward
    const r3 = run(sha) // HEAD is no longer sha
    const r4 = run(sha2, 'feat/.hidden') // invalid branch
    return { sha, sha2, after1, afterAll: ref(), line1: r1.stdout.trim(), line2: r2.stdout.trim(), line3: r3.stdout.trim(), line4: r4.stdout.trim(), stderr: [r1, r2, r3, r4].map(r => r.stderr).join('') }
  })
}

// Run the script's REAL API_SH with a fake `gh` first on PATH (no network). Modes: ok, ghe, otherrepo, tag, empty,
// 404, network (the error modes write URLs, with a token, to stderr). Returns the block's stdout + stderr.
const FAKE_GH = `#!/bin/bash
case "$FAKE_GH_MODE" in
  ok) printf 'refs/heads/feat/u1\\tcommit\\t%s\\thttps://api.github.com/repos/acme/app/git/refs/heads/feat/u1\\n' "$FAKE_SHA" ;;
  ghe) printf 'refs/heads/feat/u1\\tcommit\\t%s\\thttps://ghe.corp.example/api/v3/repos/acme/app/git/refs/heads/feat/u1\\n' "$FAKE_SHA" ;;
  otherrepo) printf 'refs/heads/feat/u1\\tcommit\\t%s\\thttps://api.github.com/repos/evil/app/git/refs/heads/feat/u1\\n' "$FAKE_SHA" ;;
  tag) printf 'refs/heads/feat/u1\\ttag\\t%s\\thttps://api.github.com/repos/acme/app/git/refs/heads/feat/u1\\n' "$FAKE_SHA" ;;
  canonicalcase) printf 'refs/heads/feat/u1\\tcommit\\t%s\\thttps://api.github.com/repos/SneakyGriff/Repo/git/refs/heads/feat/u1\\n' "$FAKE_SHA" ;;
  lowerref) printf 'refs/heads/feat/x\\tcommit\\t%s\\thttps://api.github.com/repos/acme/app/git/refs/heads/feat/x\\n' "$FAKE_SHA" ;;
  empty) ;;
  404) echo 'gh: Not Found (HTTP 404) ${fake.auth('https', 'x-token', fake.ghp('secret'), 'api.github.com/repos/acme/app/git/ref/heads/feat/u1')}' >&2; exit 1 ;;
  network) echo 'error connecting to api.github.com: Get "${fake.auth('https', 'x-token', fake.ghp('secret'), 'api.github.com/')}": dial tcp: no such host' >&2; exit 1 ;;
esac
`
export function realApi(apish, mode, host = 'github.com', extra = {}) {
  return withTmp(dir => {
    const bin = path.join(dir, 'bin'); fs.mkdirSync(bin)
    fs.writeFileSync(path.join(bin, 'gh'), FAKE_GH, { mode: 0o755 })
    const file = path.join(dir, 'api.sh'); fs.writeFileSync(file, apish + '\n')
    const env = gitEnv(dir, Object.assign({ PATH: `${bin}${path.delimiter}${process.env.PATH}`, FAKE_GH_MODE: mode, FAKE_SHA: "f".repeat(40), H: host, OW: "acme", RP: "app", B: "feat/u1", TMPDIR: dir }, extra))
    const r = spawnSync('bash', [file], { encoding: 'utf8', env, timeout: SUB_TIMEOUT_MS })
    const left = fs.readdirSync(dir).filter(f => f.startsWith('abu-api.'))
    return { stdout: String(r.stdout || '').trim(), stderr: String(r.stderr || ''), left }
  })
}

// Signal the REAL ID_SH while it holds its URL temp file (a git shim stalls `get-url --push`), and report whether the
// temp file survived. TMPDIR is the scratch directory, so any leftover is visible.
export async function realIdTrap(idsh, signal) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'abu-harness-'))
  try {
    const realGit = path.join(execFileSync('git', ['--exec-path'], { encoding: 'utf8', timeout: SUB_TIMEOUT_MS }).trim(), 'git')
    const bin = path.join(dir, 'bin'), tmp = path.join(dir, 'tmp'), R = path.join(dir, 'repo')
    fs.mkdirSync(bin); fs.mkdirSync(tmp); fs.mkdirSync(R)
    git(dir, R, 'init', '-q'); git(dir, R, 'remote', 'add', 'origin', '--', 'https://github.com/acme/app.git')
    fs.writeFileSync(path.join(bin, 'git'), `#!/bin/bash\ncase " $* " in *" --push "*) sleep 20 ;; esac\nexec '${realGit}' "$@"\n`, { mode: 0o755 })
    const file = path.join(dir, 'id.sh'); fs.writeFileSync(file, idsh + '\n')
    const env = gitEnv(dir, { PATH: `${bin}${path.delimiter}${process.env.PATH}`, TMPDIR: tmp, R, L: R })
    const child = spawn('bash', [file], { env, stdio: ['ignore', 'pipe', 'pipe'], detached: true })
    const exited = new Promise(res => child.on('exit', (code, sig) => res({ code, sig })))
    const deadline = Date.now() + 10_000
    while (fs.readdirSync(tmp).length === 0 && Date.now() < deadline) await new Promise(r => setTimeout(r, 25))
    const held = fs.readdirSync(tmp).length
    await new Promise(r => setTimeout(r, 100)) // let the shim reach its sleep with the temp file in place
    process.kill(-child.pid, signal) // the whole process group, as a terminal or a timeout would
    const killer = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL') } catch {} }, 10_000)
    const ex = await exited
    clearTimeout(killer)
    return { held, left: fs.readdirSync(tmp).length, code: ex.code, sig: ex.sig }
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
}

// Run one of the script's URL-blind gh blocks (PRV_SH, PSETUP_SH, CI_SH) with a fake `gh` first on PATH: it answers
// `--jq EXPR` by running the REAL jq over `json`, or, when `fail` is set, exits 1 with a token-bearing URL on stderr.
// Returns stdout, stderr and leftover temp files. Optional `setup(dir)` prepares scratch repos and returns extra env.
const FAKE_GH_JQ = `#!/bin/bash
[ -n "$FAKE_SLEEP" ] && sleep "$FAKE_SLEEP"
# TERM-resistant: TERM is ignored (inherited by the child sleep, whose argument is a unique marker for pgrep)
[ -n "$FAKE_STUBBORN" ] && { trap '' TERM; sleep "$FAKE_STUBBORN" & wait; }
# gh honours TERM but leaves a TERM-ignoring grandchild behind in its process group
[ -n "$FAKE_ORPHAN" ] && { (trap '' TERM; exec sleep "$FAKE_ORPHAN") & wait; }
if [ -n "$FAKE_FAIL" ]; then echo "error: Get \\"${fake.auth('https', 'x-token', fake.ghp('fakesecret123'), 'api.github.com/graphql')}\\": $FAKE_FAIL" >&2; exit 1; fi
J=""; prev=""; for a in "$@"; do [ "$prev" = --jq ] && J="$a"; prev="$a"; done
printf '%s' "$FAKE_JSON" | jq -r "$J"
`
export const hasJq = () => spawnSync('jq', ['--version'], { timeout: SUB_TIMEOUT_MS }).status === 0
// noTimeout: PATH holds only the fake gh and links to the tools CI_SH needs, never timeout / gtimeout (the perl path)
const CI_TOOLS = ['bash', 'zsh', 'env', 'perl', 'jq', 'mktemp', 'rm', 'grep', 'date', 'sleep', 'cat', 'nohup', 'kill', 'ps', 'tr', 'awk', 'seq']
const which = t => String(spawnSync('bash', ['-c', `type -P ${t}`], { encoding: 'utf8', timeout: SUB_TIMEOUT_MS }).stdout || '').trim()
export const hasTimeout = () => !!(which('timeout') || which('gtimeout'))
export const hasZsh = () => !!which('zsh')
function ghPath(dir, bin, noTimeout) {
  if (!noTimeout) return `${bin}${path.delimiter}${process.env.PATH}`
  const shim = path.join(dir, 'shim'); fs.mkdirSync(shim)
  for (const t of CI_TOOLS) {
    const w = which(t)
    if (w) fs.symlinkSync(w, path.join(shim, t))
  }
  return `${bin}${path.delimiter}${shim}`
}
// processes whose command line holds the marker (a TERM-resistant fake gh's sleep); always reaped afterwards
export const survivors = marker => String(spawnSync('pgrep', ['-f', `sleep ${marker}`], { encoding: 'utf8', timeout: SUB_TIMEOUT_MS }).stdout || '').trim()
export const reap = marker => spawnSync('pkill', ['-KILL', '-f', `sleep ${marker}`], { timeout: SUB_TIMEOUT_MS })
export function realGhBlock(block, { json = '', fail = '', env = {}, setup, noTimeout = false } = {}) {
  return withTmp(dir => {
    const bin = path.join(dir, 'bin'), tmp = path.join(dir, 'tmp'); fs.mkdirSync(bin); fs.mkdirSync(tmp)
    fs.writeFileSync(path.join(bin, 'gh'), FAKE_GH_JQ, { mode: 0o755 })
    const extra = setup ? setup(dir, (cwd, ...a) => git(dir, cwd, ...a)) : {}
    const file = path.join(dir, 'block.sh'); fs.writeFileSync(file, block + '\n')
    const t0 = Date.now()
    const r = spawnSync('bash', [file], { encoding: 'utf8', timeout: SUB_TIMEOUT_MS, env: gitEnv(dir, Object.assign({ PATH: ghPath(dir, bin, noTimeout), TMPDIR: tmp, FAKE_JSON: json, FAKE_FAIL: fail }, env, extra)) })
    return { stdout: String(r.stdout || '').trim(), stderr: String(r.stderr || ''), left: fs.readdirSync(tmp), ms: Date.now() - t0 }
  })
}
// The ciWait launch (CI_RUN) and cleanup (CI_STOP) strings, run verbatim (O / BF absolute, re-stated per call, as the
// prompt says) around CI_SH with a TERM-resistant fake gh (marker) mid-call; the cleanup runs under `shell` (bash|zsh).
// Returns the cleanup's output and duration, whether the watcher is still alive, and the marker survivors.
export async function realCiCleanup(ciSh, run, stop, marker, { env = {}, noTimeout = false, shell = 'bash', psNoTree = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'abu-harness-'))
  try {
    const bin = path.join(dir, 'bin'), tmp = path.join(dir, 'tmp'); fs.mkdirSync(bin); fs.mkdirSync(tmp)
    fs.writeFileSync(path.join(bin, 'gh'), FAKE_GH_JQ, { mode: 0o755 })
    const BF = path.join(dir, 'ci-12.sh'), O = path.join(dir, 'ci-12.out'); fs.writeFileSync(BF, ciSh + '\n')
    const vars = `O='${O}'; BF='${BF}'`
    const e = gitEnv(dir, Object.assign({ PATH: ghPath(dir, bin, noTimeout), TMPDIR: tmp, FAKE_JSON: '', FAKE_FAIL: '', FAKE_STUBBORN: marker }, env))
    const sh = (sh0, cmd, e1 = e) => spawnSync(sh0, ['-c', cmd], { encoding: 'utf8', timeout: SUB_TIMEOUT_MS, env: e1 })
    sh(shell, `${vars}; rm -f "$O" "$O.pid"; ${run}`)
    // psNoTree: the cleanup's `ps -A` listing comes back empty (a minimal / failing ps); every other ps call is real
    let eStop = e
    if (psNoTree) {
      const pbin = path.join(dir, 'psbin'); fs.mkdirSync(pbin)
      fs.writeFileSync(path.join(pbin, 'ps'), `#!/bin/bash\ncase " $* " in *" -A "*) exit 0 ;; esac\nexec '${which('ps')}' "$@"\n`, { mode: 0o755 })
      eStop = Object.assign({}, e, { PATH: `${pbin}${path.delimiter}${e.PATH}` })
    }
    const deadline = Date.now() + 20_000
    while ((!survivors(marker) || !fs.existsSync(`${O}.pid`)) && Date.now() < deadline) await new Promise(r => setTimeout(r, 50))
    const started = !!survivors(marker)
    const pid = fs.readFileSync(`${O}.pid`, 'utf8').trim()
    const t0 = Date.now()
    const out = String(sh(shell, `${vars}; ${stop}`, eStop).stdout || '').trim()
    const ms = Date.now() - t0
    await new Promise(r => setTimeout(r, 300))
    const alive = spawnSync('kill', ['-0', pid], { timeout: SUB_TIMEOUT_MS }).status === 0
    return { started, out, ms, alive, left: survivors(marker) }
  } finally { reap(marker); fs.rmSync(dir, { recursive: true, force: true }) }
}
// CI_STOP's guard: run it under `shell` inside a probe that is its own process-group leader, with "$O.pid" prepared by
// `pidfile` (null = missing; 'SELF' = the probe's own pgid; 'DECOY' = a live process-group leader that is not the
// watcher, e.g. a reused pid; 'FOOL' = a live group leader whose argv CONTAINS the block path but is not the exact
// `bash <BF>` launch). The probe must survive (it prints SURVIVED) and the decoy too; returns the CI_STOP line.
export function ciStopGuard(stop, shell, pidfile) {
  return withTmp(dir => {
    const O = path.join(dir, 'ci-12.out'), BF = path.join(dir, 'ci-12.sh'), marker = String(4_700_000 + Math.floor(Math.random() * 90_000))
    let decoy = null
    if (pidfile === 'DECOY' || pidfile === 'FOOL') {
      const argv = pidfile === 'DECOY' ? ['sleep', marker] : ['sh', '-c', 'sleep "$1"; :', 'fool', marker, BF]
      decoy = spawn('perl', ['-e', 'setpgrp(0, 0); exec @ARGV', ...argv], { detached: true, stdio: 'ignore' })
      fs.writeFileSync(`${O}.pid`, `${decoy.pid}\n`)
      const until = Date.now() + 10_000
      while (!survivors(marker) && Date.now() < until) spawnSync('sleep', ['0.05'], { timeout: SUB_TIMEOUT_MS })
    } else if (pidfile !== null && pidfile !== 'SELF') fs.writeFileSync(`${O}.pid`, pidfile)
    const self = pidfile === 'SELF' ? `ps -o pgid= -p $$ | tr -d ' ' > "$O.pid"; ` : ''
    const r = spawnSync('perl', ['-e', 'setpgrp(0, 0); exec @ARGV', shell, '-c', `O='${O}'; BF='${BF}'; ${self}${stop}; echo SURVIVED`], { encoding: 'utf8', timeout: SUB_TIMEOUT_MS, env: gitEnv(dir, { PATH: process.env.PATH }) })
    const decoyAlive = decoy ? !!survivors(marker) : null
    if (decoy) reap(marker)
    return { stdout: String(r.stdout || '').trim(), status: r.status, signal: r.signal, decoyAlive }
  })
}
