/** Host-side admission and integration. Provider dispatch stays with the host's
 * existing agents/lane helper; this module never grants review or publish authority. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { measureSize } from './autobuilder-ops';

export type Check = { name: string; argv: string[]; timeoutMs: number };
export type Task = { id: string; dependencies: string[]; writes: string[]; resources: string[];
  brief: string; checks: Check[]; tier: 'T0'|'T1'|'T2'|'T3'; impl: 'claude'|'codex';
  estimate?: number; noteSections?: string[] };
export type Contract = { version: 1; unit: string; repo: string; lane: string; runDir: string;
  base: string; shipBase: string; branch: string; tasks: Task[]; maxWorkers: number; mode: 'continuous'|'waves';
  integrationChecks: Check[]; exploration?: string };
type Job = { status: 'reserved'|'running'|'integrating'|'integrated'|'cancel_requested'|'cancelled';
  attempt: string; base: string; cwd: string; branch: string; briefHash: string; noteHash?: string;
  cancelRequested?: boolean; handle?: string; head?: string; integrationBase?: string; integratedHead?: string };
type Journal = { version: 1; contract: Contract; contractHash: string; jobs: Record<string, Job>;
  status: 'BUILDING'|'BUILT'|'BLOCKED'|'CANCELLING'|'CANCELLED'; reason?: string; sequence: number;
  events: { seq: number; at: string; event: string; task?: string; attempt?: string }[] };
const id = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const sha = /^[a-f0-9]{40,64}$/;
const digest = (x: string | Buffer) => crypto.createHash('sha256').update(x).digest('hex');
const encode = (x: unknown) => JSON.stringify(x);
export class QueueError extends Error { constructor(readonly reason: string) { super(reason); } }
function fail(reason: string): never { throw new QueueError(reason); }
function regular(file: string) { if (!fs.lstatSync(file).isFile()) fail('unsafe_file'); return fs.readFileSync(file); }
function json(file: string) { try { return JSON.parse(regular(file).toString()); } catch { fail('invalid_file'); } }
function absolute(p: unknown): p is string { return typeof p === 'string' && path.isAbsolute(p) && !/[\x00-\x1f]/.test(p); }
function rel(p: unknown): p is string { return typeof p === 'string' && !!p && !path.isAbsolute(p) && !p.split('/').some(x => !x || x === '.' || x === '..') && !/[\\\x00-\x1f]/.test(p) && !p.split('/').some(x => x.toLowerCase() === '.git'); }
const inside = (a: string, b: string) => a === b || a.startsWith(b + path.sep);
const overlaps = (a: string, b: string) => a === b || a.startsWith(b + '/') || b.startsWith(a + '/');
function env() { const e = { ...process.env, LC_ALL: 'C', GIT_TERMINAL_PROMPT: '0' }; for (const k of Object.keys(e)) if (/^(BUN_|GIT_)|^NODE_(OPTIONS|PATH)$/.test(k) && !['GIT_TERMINAL_PROMPT'].includes(k)) delete e[k]; return e; }
function command(argv: string[], cwd: string, timeout = 30_000) {
  const r = spawnSync(argv[0], argv.slice(1), { cwd, env: env(), encoding: 'utf8', timeout, maxBuffer: 4 * 1024 * 1024 });
  if (r.error || r.status !== 0) fail('command_failed'); return r.stdout;
}
function git(cwd: string, ...args: string[]) { return command(['git', '-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', '-C', cwd, ...args], cwd).trim(); }
const head = (cwd: string) => git(cwd, 'rev-parse', '--verify', 'HEAD');
function clean(cwd: string) { if (git(cwd, 'status', '--porcelain')) fail('dirty_worktree'); }
function checksValid(checks: unknown): checks is Check[] {
  return Array.isArray(checks) && checks.length > 0 && checks.length <= 32 && checks.every(c => c && id.test(c.name) && Array.isArray(c.argv) && c.argv.length && c.argv.every((a: unknown) => typeof a === 'string' && !a.includes('\0')) && Number.isInteger(c.timeoutMs) && c.timeoutMs >= 1 && c.timeoutMs <= 600_000);
}
export function validateContract(c: Contract) {
  if (!c || c.version !== 1 || !id.test(c.unit) || ![c.repo,c.lane,c.runDir].every(absolute) || !sha.test(c.base) || !sha.test(c.shipBase) || typeof c.branch !== 'string' || !c.branch || c.branch.startsWith('-') || /[\s\x00-\x1f]/.test(c.branch)
    || !['continuous','waves'].includes(c.mode) || !Number.isInteger(c.maxWorkers) || c.maxWorkers < 1 || c.maxWorkers > 3 || !checksValid(c.integrationChecks)
    || !Array.isArray(c.tasks) || !c.tasks.length || c.tasks.length > 128) fail('invalid_contract');
  const names = new Set(c.tasks.map(t => t.id)); if (names.size !== c.tasks.length) fail('duplicate_task');
  for (const t of c.tasks) {
    if (!id.test(t.id) || !absolute(t.brief) || !Array.isArray(t.dependencies) || !t.dependencies.every(d => names.has(d) && d !== t.id)
      || !Array.isArray(t.writes) || !t.writes.length || !t.writes.every(rel) || !Array.isArray(t.resources) || !t.resources.every(r => id.test(r))
      || !checksValid(t.checks) || !['T0','T1','T2','T3'].includes(t.tier) || !['claude','codex'].includes(t.impl)
      || (t.estimate !== undefined && (!Number.isFinite(t.estimate) || t.estimate <= 0))
      || (t.noteSections !== undefined && (!Array.isArray(t.noteSections) || !t.noteSections.every(s => id.test(s))))) fail('invalid_task');
  }
  const seen = new Set<string>(), active = new Set<string>();
  function visit(n: string) { if (active.has(n)) fail('dependency_cycle'); if (seen.has(n)) return; active.add(n); c.tasks.find(t => t.id === n)!.dependencies.forEach(visit); active.delete(n); seen.add(n); }
  c.tasks.forEach(t => visit(t.id));
}
function atomic(file: string, value: unknown) {
  const tmp = file + '.' + crypto.randomUUID() + '.tmp'; const fd = fs.openSync(tmp, 'wx', 0o600);
  try { fs.writeFileSync(fd, encode(value) + '\n'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, file);
}
function lock<T>(dir: string, work: () => T): T {
  if (!absolute(dir) || fs.realpathSync(dir) !== dir) fail('invalid_run_directory');
  const p = path.join(dir,'.queue.lock'); try { fs.mkdirSync(p, { mode: 0o700 }); } catch { fail('queue_busy_or_orphan_lock'); }
  try { return work(); } finally { fs.rmdirSync(p); }
}
function read(dir: string): Journal {
  const s = json(path.join(dir,'queue.json')); validateContract(s.contract);
  if (s.version !== 1 || s.contractHash !== digest(encode(s.contract)) || s.contract.runDir !== dir) fail('contract_changed');
  return s;
}
function save(s: Journal, event: string, task?: string) {
  s.events.push({ seq: ++s.sequence, at: new Date().toISOString(), event, ...(task ? { task, attempt: s.jobs[task]?.attempt } : {}) });
  atomic(path.join(s.contract.runDir,'queue.json'), s);
}
function integrationIdentity(s: Journal) {
  if (git(s.contract.lane,'symbolic-ref','--short','HEAD') !== s.contract.branch) fail('integration_branch_changed');
  const last = [...s.events].reverse().find(e => e.event === 'integrated');
  const expected = last ? s.jobs[last.task!].integratedHead : s.contract.base;
  if (head(s.contract.lane) !== expected) fail('integration_head_changed');
  clean(s.contract.lane);
}
export function queueInit(input: Contract) {
  const c = structuredClone(input); validateContract(c);
  for (const k of ['repo','lane','runDir'] as const) c[k] = fs.realpathSync(c[k]);
  if (inside(c.runDir,c.lane) || inside(c.runDir,c.repo) || c.lane === c.repo) fail('isolated_directories_required');
  return lock(c.runDir, () => {
    const target = path.join(c.runDir,'queue.json'); if (fs.existsSync(target)) fail('queue_exists');
    if (head(c.lane) !== c.base || git(c.lane,'symbolic-ref','--short','HEAD') !== c.branch) fail('base_mismatch');
    if (fs.realpathSync(git(c.lane,'rev-parse','--path-format=absolute','--git-common-dir')) !== fs.realpathSync(git(c.repo,'rev-parse','--path-format=absolute','--git-common-dir'))) fail('repository_mismatch');
    clean(c.lane); git(c.lane,'merge-base','--is-ancestor',c.shipBase,c.base);
    if (measureSize(c.lane,c.shipBase).prod_loc >= 2000) fail('ship_boundary_required');
    c.tasks.forEach(t => regular(t.brief));
    const s: Journal = { version: 1, contract:c, contractHash:digest(encode(c)), jobs:{}, status:'BUILDING', sequence:0, events:[] };
    save(s,'initialized'); return { status:s.status, unit:c.unit };
  });
}

export type Note = { version: 1; base: string; sections: { id: string; text: string; inputs: Record<string,string> }[] };
export function captureExploration(repo: string, base: string, sections: { id: string; text: string; inputs: string[] }[]): Note {
  if (!absolute(repo) || !sha.test(base) || !Array.isArray(sections) || !sections.length || new Set(sections.map(s=>s.id)).size !== sections.length) fail('invalid_note');
  return { version:1, base, sections:sections.map(s => {
    if (!id.test(s.id) || typeof s.text !== 'string' || !s.text.trim() || !Array.isArray(s.inputs) || !s.inputs.length || !s.inputs.every(rel)) fail('invalid_note');
    return { id:s.id, text:s.text, inputs:Object.fromEntries(s.inputs.map(p => [p,git(repo,'rev-parse','--verify',`${base}:${p}`)])) };
  }) };
}
export function validateExploration(note: Note, repo: string, revision: string, sections: string[]) {
  if (!note || note.version !== 1 || !Array.isArray(note.sections)) fail('invalid_note');
  for (const id0 of sections) {
    const s = note.sections.find(s=>s.id === id0); if (!s || !s.inputs || !Object.keys(s.inputs).length) fail('missing_note_section');
    for (const [file, hash] of Object.entries(s.inputs)) {
      if (!rel(file) || git(repo,'rev-parse','--verify',`${revision}:${file}`) !== hash) fail('stale_exploration');
    }
  }
}
export function completionTimeoutMs(c: Contract, t: Task) { return [...t.checks,...c.integrationChecks].reduce((sum,check)=>sum+check.timeoutMs,1_800_000); }
function compatible(a: Task, b: Task) { return !a.resources.some(r => b.resources.includes(r)) && !a.writes.some(x => b.writes.some(y => overlaps(x,y))); }
export function queueNext(dir: string) {
  return lock(dir, () => {
    const s = read(dir), c = s.contract;
    if (s.status !== 'BUILDING') return { status:s.status, reason:s.reason, admitted:[] };
    integrationIdentity(s);
    const busy = c.tasks.filter(t=>s.jobs[t.id] && s.jobs[t.id].status !== 'integrated');
    if (busy.some(t=>s.jobs[t.id].status === 'integrating')) fail('integration_recovery_required');
    if (c.mode === 'waves' && busy.length) return { status:s.status, admitted:[] };
    const depths = new Map<string,number>();
    const depth = (t: Task): number => { if (!depths.has(t.id)) depths.set(t.id, (t.estimate || 1) + Math.max(0,...c.tasks.filter(x=>x.dependencies.includes(t.id)).map(depth))); return depths.get(t.id)!; };
    const ready = c.tasks.filter(t=>!s.jobs[t.id] && t.dependencies.every(d=>s.jobs[d]?.status==='integrated')).sort((a,b)=>depth(b)-depth(a) || a.id.localeCompare(b.id));
    const admitted: any[] = [];
    for (const t of ready) {
      if (busy.length >= c.maxWorkers) break;
      if (!busy.every(x=>compatible(t,x))) continue;
      const base = head(c.lane);
      if (t.noteSections?.length) {
        if (!c.exploration || !absolute(c.exploration)) fail('missing_exploration');
        validateExploration(json(c.exploration), c.repo, base, t.noteSections);
      }
      const attempt = crypto.randomUUID(), branch = `abq/${c.unit}/${t.id}-${attempt}`;
      const cwd = path.join(dir,'worktrees',`${t.id}-${attempt}`); fs.mkdirSync(path.dirname(cwd),{recursive:true,mode:0o700});
      // Persist the reservation before creating/dispatching anything. An interrupted
      // reservation is visible and is never automatically dispatched again.
      s.jobs[t.id] = { status:'reserved',attempt,base,cwd,branch,briefHash:digest(regular(t.brief)), ...(t.noteSections?.length ? {noteHash:digest(regular(c.exploration!))} : {}) };
      save(s,'reserved',t.id);
      try { git(c.repo,'worktree','add','-b',branch,cwd,base); }
      catch { s.status='BLOCKED';s.reason='worktree_setup_failed';save(s,'blocked',t.id);throw new QueueError(s.reason); }
      busy.push(t); admitted.push({ ...t, ...s.jobs[t.id], exploration:c.exploration || null, completionTimeoutMs: completionTimeoutMs(c,t) });
    }
    return { status:s.status, admitted, pending:c.tasks.filter(t=>!s.jobs[t.id]).map(t=>t.id) };
  });
}
export function queueBind(dir: string, task: string, attempt: string, handle: string) {
  return lock(dir,()=>{ const s=read(dir),j=s.jobs[task]; if(s.status!=='BUILDING'||!j||j.attempt!==attempt||!['reserved','running'].includes(j.status)||!handle||/[\x00-\x1f]/.test(handle))fail('invalid_binding');
    if(j.handle && j.handle!==handle)fail('attempt_already_bound'); j.handle=handle;j.status='running';save(s,'bound',task);return {status:j.status}; });
}
function withinWriteSet(cwd: string, base: string, commit: string, writes: string[]) {
  const files = command(['git','-C',cwd,'diff','--no-ext-diff','--no-renames','--name-only','-z',base,commit,'--'],cwd).split('\0').filter(Boolean);
  if (files.some(f=>!rel(f)||!writes.some(w=>f===w||f.startsWith(w+'/')))) fail('write_set_exceeded');
}
async function runChecks(checks: Check[], cwd: string, dir: string, label: string) {
  if (process.platform === 'win32') fail('unsupported_check_supervision');
  const receipts: object[] = [];
  for (const [i,c] of checks.entries()) {
    const log=path.join(dir,`${label}-${i}.log`),fd=fs.openSync(log,'wx',0o600);
    let bytes=0,reason='',exited=false;
    const child=spawn(c.argv[0],c.argv.slice(1),{cwd,env:env(),detached:true,stdio:['ignore','pipe','pipe']});
    const kill=(signal: NodeJS.Signals)=>{if(child.pid){try{process.kill(-child.pid,signal);}catch{}}};
    let force: ReturnType<typeof setTimeout> | undefined;
    const stop=(why:string)=>{if(reason)return;reason=why;kill('SIGTERM');force=setTimeout(()=>kill('SIGKILL'),500);};
    const cancel=()=>stop('check_cancelled');
    process.once('SIGTERM',cancel);process.once('SIGINT',cancel);
    const timer=setTimeout(()=>stop('check_timeout'),c.timeoutMs);
    const output=(data:Buffer)=>{bytes+=data.length;if(bytes<=4*1024*1024)fs.writeSync(fd,data);else stop('check_output_limit');};
    child.stdout.on('data',output);child.stderr.on('data',output);
    try {
      const code=await new Promise<number|null>((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});
      exited=true;
      // A check may exit while leaving descendants behind. They belong to this
      // detached group, never another task's group, and cannot outlive verification.
      kill('SIGKILL');
      if(reason || code!==0)fail(reason || 'check_failed');
      receipts.push({name:c.name,argv:c.argv,exit:0,log,bytes});
    } finally {
      if(!exited)kill('SIGKILL');clearTimeout(timer);if(force)clearTimeout(force);
      process.removeListener('SIGTERM',cancel);process.removeListener('SIGINT',cancel);fs.closeSync(fd);
    }
  }
  return receipts;
}
async function lockAsync<T>(dir: string, work:()=>Promise<T>): Promise<T> {
  if (!absolute(dir) || fs.realpathSync(dir)!==dir)fail('invalid_run_directory');
  const p=path.join(dir,'.queue.lock');try{fs.mkdirSync(p,{mode:0o700});}catch{fail('queue_busy_or_orphan_lock');}
  try{return await work();}finally{fs.rmdirSync(p);}
}
export async function queueComplete(dir: string, task: string, attempt: string, completedHead: string) {
  return lockAsync(dir,async()=>{
    const s=read(dir),c=s.contract,t=c.tasks.find(t=>t.id===task),j=s.jobs[task];
    if(!t||!j||j.attempt!==attempt||!sha.test(completedHead))fail('invalid_completion');
    if(j.status==='integrated') {if(j.head!==completedHead)fail('completion_changed');return {status:'integrated',head:j.integratedHead,duplicate:true};}
    if(s.status!=='BUILDING'||j.status!=='running')fail('attempt_not_running');
    integrationIdentity(s);clean(j.cwd);
    if(head(j.cwd)!==completedHead||git(j.cwd,'symbolic-ref','--short','HEAD')!==j.branch)fail('worker_identity_changed');
    git(j.cwd,'merge-base','--is-ancestor',j.base,completedHead);
    if(digest(regular(t.brief))!==j.briefHash)fail('brief_changed');
    if(j.noteHash){
      if(!c.exploration || digest(regular(c.exploration))!==j.noteHash)fail('exploration_changed');
      validateExploration(json(c.exploration),c.repo,head(c.lane),t.noteSections!);
    }
    withinWriteSet(j.cwd,j.base,completedHead,t.writes);
    const receiptDir=path.join(dir,'receipts',attempt);fs.mkdirSync(receiptDir,{recursive:true,mode:0o700});
    const start=head(c.lane);j.status='integrating';j.head=completedHead;j.integrationBase=start;save(s,'integration_started',task);
    try {
      const checks=await runChecks(t.checks,j.cwd,receiptDir,'worker');clean(j.cwd);
      if(head(j.cwd)!==completedHead || git(j.cwd,'symbolic-ref','--short','HEAD')!==j.branch)fail('worker_identity_changed');
      const guard=path.resolve(import.meta.dir,'../bin/gstack-lane');
      command([guard,'commit','--cwd',j.cwd,'--base',j.base,'-m',`verify ${c.unit}/${task}\n\nAutobuilder-Attempt: ${attempt}`],j.cwd,60_000);
      // Merge and checks are serialized by .queue.lock. On failure preserve the
      // index, worktrees and receipt; no reset, auto-conflict resolution or retry.
      git(c.lane,'merge','--no-ff','--no-commit',completedHead);
      const expectedTree=git(c.lane,'write-tree');
      const integrated=await runChecks(c.integrationChecks,c.lane,receiptDir,'integration');
      if(git(c.lane,'symbolic-ref','--short','HEAD')!==c.branch)fail('integration_branch_changed');
      if(head(c.lane)!==start || git(c.lane,'write-tree')!==expectedTree || git(c.lane,'diff','--no-ext-diff','--name-only') || git(c.lane,'ls-files','--others','--exclude-standard'))fail('checks_modified_source');
      command([guard,'commit','--cwd',c.lane,'--base',c.base,'-m',`integrate ${c.unit}/${task}\n\nAutobuilder-Attempt: ${attempt}`],c.lane,60_000);
      clean(c.lane);const result=head(c.lane);git(c.lane,'merge-base','--is-ancestor',completedHead,result);
      const meter=measureSize(c.lane,c.shipBase);
      atomic(path.join(receiptDir,'result.json'),{task,attempt,base:j.base,shipBase:c.shipBase,source:completedHead,integrationBase:start,head:result,checks,integrationChecks:integrated,meter});
      j.status='integrated';j.integratedHead=result;
      if(meter.prod_loc>=2500) {s.status='BLOCKED';s.reason='meter_admission_stop';}
      else if(c.tasks.every(t=>s.jobs[t.id]?.status==='integrated'))s.status='BUILT';
      save(s,'integrated',task);return {status:s.status,task,head:result,meter,review_required:true};
    } catch(e) {s.status='BLOCKED';s.reason=e instanceof QueueError?e.reason:'integration_failed';save(s,'blocked',task);throw new QueueError(s.reason);}
  });
}
export function queueStatus(dir: string) { const s=read(dir);return {status:s.status,reason:s.reason||null,unit:s.contract.unit,base:s.contract.base,jobs:s.jobs,sequence:s.sequence,review_required:true}; }
export function queueCancel(dir: string) {
  return lock(dir,()=>{
    const s=read(dir);if(s.status==='BUILT')return queueStatus(dir);
    for(const j of Object.values(s.jobs)) {
      if(['integrated','cancelled'].includes(j.status))continue;
      j.cancelRequested=true;
      // Preserve the integration marker and receipt identity for manual recovery.
      if(j.status!=='integrating')j.status='cancel_requested';
    }
    s.status=Object.values(s.jobs).some(j=>j.cancelRequested)?'CANCELLING':'CANCELLED';
    save(s,'cancel_requested');return queueStatus(dir);
  });
}
