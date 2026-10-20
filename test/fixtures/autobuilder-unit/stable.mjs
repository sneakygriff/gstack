// Byte-stability: every optional arg absent vs present-but-empty must produce identical prompt sequences (resume from
// cache depends on it); setting optional args must change them. Library: runStable(scriptPath). CLI: node stable.mjs [script]
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadScript, SHA, DEFAULT_SCRIPT } from './lib.mjs'
const AF = Object.getPrototypeOf(async function () {}).constructor
async function run(body, extra) {
  const prompts = []
  const agent = async (p, o) => {
    if (/undefined/.test(p)) throw new Error('undefined leak in ' + o.label)
    prompts.push(o.label + '\n' + p)
    if (/\[object Object\]/.test(p)) throw new Error('object leak in ' + o.label)
    const L = o.label
    if (L.startsWith('refresh')) return { status: 'READY', disjoint: true, baseline: 'GREEN', tasks: [] }
    if (L.startsWith('wave')) return { head: SHA('a'), worktrees: [] }
    if (L.startsWith('build') || L.startsWith('fix')) return { status: 'DONE', head: SHA('b'), test_result: 'ok', checks: [{ name: 'x', command: 'x', exit_code: 0 }] }
    if (L.startsWith('integrate')) return { status: 'GREEN', prod_loc: 10, test_loc: 1, linear: true, files: [] }
    if (/gate start/.test(L)) return { guard_exit: 0, guard_lines: ['no_changes=true'], reviewed_sha: SHA('c'), files_since_base: [], files_since_prev: [] }
    if (/seat C/.test(L)) return { member: 'm', status: 'PRESENT', verdict: 'PASS', final_line: 'REVIEW_COMPLETE: findings=0', actual_model: 'claude-fable-5-1' }
    if (/seat X/.test(L)) return { member: 'm', status: 'PRESENT', verdict: 'PASS', verdict_line: 'VERDICT=PRESENT_CLEAN' }
    if (/docker|mutation/.test(L)) return { member: 'm', status: 'PRESENT', verdict: 'PASS' }
    if (/consolidate/.test(L)) return { verdict: 'CLEAN', members_present: { seat_c: 'PRESENT', seat_x: 'PRESENT' }, p1: [], fixes: [], deferred_p2: [], members: 'x' }
    if (/\/ship prepare/.test(L)) return { status: 'COMMITTED', code_changed: false, reviewed_tree: SHA('e') }
    if (/\/ship publish/.test(L)) return { status: 'PUBLISHED', pr_number: 1, head: SHA('d') }
    if (/files/.test(L)) return { head: SHA('d'), files: ['CHANGELOG.md'], snap_tree: SHA('e') }
    if (/pre-push guard/.test(L)) return { exit_code: 0, lines: ['no_changes=true'], head: SHA('d'), files_since: [], tree_delta: [] }
    if (/fact-check/.test(L)) return { verdict: 'CLEAN', p1: [], doc_fixes: [], members: 'f' }
    if (/^repo identity/.test(L)) return { lines: ['ID repo ok github.com/a/b scheme=scp user=git port=', 'ID lane ok github.com/a/b scheme=scp user=git port=', 'ID push1 ok github.com/a/b scheme=scp user=git port=', 'PUSH_N 1'] }
    if (/ verify push$/.test(L)) return { line: `API exit=0 ref=ok sha=${SHA('d')} reason=ok` }
    if (/ push$/.test(L)) return { line: `PUSH exit=0 local=${SHA('d')} reason=ok` }
    if (L === 'find PR') return { line: `PR exit=0 number=1 state=OPEN cross=false head_repo=a/b head_ref=b head=${SHA('d')}` }
    if (/CI/.test(L)) return { line: `CI status=READY head=${SHA('d')} reason=ci:pass pass=1 fail=0 pending=0` }
    if (L === 'gated head') return SHA('c')
    return 'ok'
  }
  const args = Object.assign({ runDir: '/run', lane: '/lane', repo: '/repo', briefsDir: '/b', reportsDir: '/r', unit: 'U1', base: SHA('0'), branch: 'b', waves: [[{ id: 'T', impl: 'claude', model: 'haiku', tier: 'T1' }]] }, extra)
  const r = await new AF('args', 'agent', 'parallel', 'phase', 'log', body)(args, agent, async t => Promise.all(t.map(f => f())), () => {}, () => {})
  return { prompts, status: r.status }
}
export const OPTIONAL_ARGS = ['gateAttempt', 'context', 'gateFocus', 'dockerFocus', 'shipNotes', 'mergeNotes', 'shipExtra', 'shipAttempt', 'deltaKnown', 'privtest', 'synModel', 'deltaModel', 'shipModel']
export async function runStable(scriptPath = DEFAULT_SCRIPT) {
  const { body } = loadScript(scriptPath)
  const a = await run(body, {})
  const empty = Object.fromEntries(OPTIONAL_ARGS.map(k => [k, '']))
  const b = await run(body, Object.assign(empty, { extraFixes: [], dockerGlobs: [], shipOpenP1Markers: [], sensitiveGlobs: [], acceptDegraded: '' }))
  const c = await run(body, { context: 'CTX', gateFocus: 'GF', privtest: '/p.sh' })
  return { absentStatus: a.status, emptyStatus: b.status, prompts: a.prompts.length, identical: JSON.stringify(a.prompts) === JSON.stringify(b.prompts), changesWhenSet: JSON.stringify(a.prompts) !== JSON.stringify(c.prompts) }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const r = await runStable(process.argv[2] || DEFAULT_SCRIPT)
  console.log('absent:', r.absentStatus, r.prompts, 'empty:', r.emptyStatus, 'identical:', r.identical, '| with optional args differs (expected):', r.changesWhenSet)
  process.exitCode = r.identical && r.changesWhenSet && r.absentStatus === 'READY' ? 0 : 1
}
