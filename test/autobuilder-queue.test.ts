import { test, expect, afterEach } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { queueInit, queueNext, queueBind, queueComplete, queueStatus, queueCancel, captureExploration, validateExploration, validateContract, type Contract } from '../lib/autobuilder-queue';
const dirs: string[]=[];
function git(cwd:string,...args:string[]) {const r=spawnSync('git',['-C',cwd,...args],{encoding:'utf8',timeout:10_000});if(r.status!==0)throw Error(r.stderr);return r.stdout.trim();}
const check={name:'smoke',argv:['/usr/bin/true'],timeoutMs:1000};
function fixture() {
 const dir=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'abq-')));dirs.push(dir);
 const repo=path.join(dir,'repo'),lane=path.join(dir,'integration'),runDir=path.join(dir,'run');fs.mkdirSync(repo);fs.mkdirSync(runDir);
 git(repo,'init','-q');git(repo,'config','user.name','Queue Fixture');git(repo,'config','user.email','fixture@example.invalid');
 fs.writeFileSync(path.join(repo,'api.txt'),'version 1\n');git(repo,'add','api.txt');git(repo,'commit','-qm','base');const base=git(repo,'rev-parse','HEAD');
 git(repo,'worktree','add','-b','integration',lane,base);
 const tasks=['A','B','C'].map(id=>{const brief=path.join(dir,`${id}.md`);fs.writeFileSync(brief,`Task ${id}`);return {id,dependencies:id==='C'?['A']:[],writes:[`${id}.txt`],resources:[],brief,checks:[check],tier:'T1' as const,impl:'claude' as const};});
 const contract:Contract={version:1,unit:'u1',repo,lane,runDir,base,shipBase:base,branch:'integration',tasks,maxWorkers:2,mode:'continuous',integrationChecks:[check]};
 return {dir,contract};
}
afterEach(()=>{for(const d of dirs.splice(0))fs.rmSync(d,{recursive:true,force:true});});
async function finish(c:Contract,job:any) {queueBind(c.runDir,job.id,job.attempt,`host-${job.id}`);fs.writeFileSync(path.join(job.cwd,`${job.id}.txt`),`${job.id}\n`);git(job.cwd,'add',`${job.id}.txt`);git(job.cwd,'commit','-qm',job.id);return queueComplete(c.runDir,job.id,job.attempt,git(job.cwd,'rev-parse','HEAD'));}

test('continuous queue unlocks C after integrated A while B is still active; duplicate completion is inert',async()=>{
 const {contract:c}=fixture();queueInit(c);const first=queueNext(c.runDir).admitted;expect(first.map(j=>j.id)).toEqual(['A','B']);
 expect(first.every(j=>j.cwd!==c.lane&&j.base===c.base)).toBe(true);expect(queueNext(c.runDir).admitted).toEqual([]);
 const a=await finish(c,first[0]);expect(a.status).toBe('BUILDING');const next=queueNext(c.runDir).admitted;expect(next.map(j=>j.id)).toEqual(['C']);expect(next[0].base).toBe(a.head);
 const before=git(c.lane,'rev-parse','HEAD');const duplicate=await queueComplete(c.runDir,'A',first[0].attempt,git(first[0].cwd,'rev-parse','HEAD'));expect(duplicate.duplicate).toBe(true);expect(git(c.lane,'rev-parse','HEAD')).toBe(before);
 await finish(c,first[1]);expect((await finish(c,next[0])).status).toBe('BUILT');expect(queueStatus(c.runDir).review_required).toBe(true);
},30_000);

test('static wave fallback waits for every active task before admitting dependents',async()=>{
 const {contract:c}=fixture();c.mode='waves';queueInit(c);const jobs=queueNext(c.runDir).admitted;await finish(c,jobs[0]);expect(queueNext(c.runDir).admitted).toEqual([]);await finish(c,jobs[1]);expect(queueNext(c.runDir).admitted.map(j=>j.id)).toEqual(['C']);
},30_000);

for (const mode of ['continuous','waves'] as const) {
 test(`${mode} queue admits prototype-named tasks and unlocks their dependents after integration`,async()=>{
  const {contract:c}=fixture();c.mode=mode;
  c.tasks=c.tasks.slice(0,2).map((task,i)=>({...task,id:i===0?'constructor':'toString',dependencies:i===0?[]:['constructor'],writes:[i===0?'constructor.txt':'toString.txt']}));
  queueInit(c);
  const first=queueNext(c.runDir);expect(first.admitted.map(j=>j.id)).toEqual(['constructor']);expect(first.pending).toEqual(['toString']);
  expect(queueNext(c.runDir).admitted).toEqual([]);
  expect((await finish(c,first.admitted[0])).status).toBe('BUILDING');
  const next=queueNext(c.runDir);expect(next.admitted.map(j=>j.id)).toEqual(['toString']);expect(next.pending).toEqual([]);
  expect((await finish(c,next.admitted[0])).status).toBe('BUILT');
  const state=queueStatus(c.runDir);expect(Object.keys(state.jobs).sort()).toEqual(['constructor','toString']);expect(state.jobs.constructor.status).toBe('integrated');expect(state.jobs.toString.status).toBe('integrated');expect(state.review_required).toBe(true);
 },30_000);
}

test('declared write prefixes and shared resources serialize admission',async()=>{
 const {contract:c}=fixture();c.tasks[0].writes=['shared'];c.tasks[1].writes=['shared/child'];queueInit(c);expect(queueNext(c.runDir).admitted.map(j=>j.id)).toEqual(['A']);
 const f=fixture();f.contract.tasks[0].resources=['database'];f.contract.tasks[1].resources=['database'];queueInit(f.contract);expect(queueNext(f.contract.runDir).admitted.map(j=>j.id)).toEqual(['A']);
});

test('lost dispatch result leaves a durable reservation and cannot duplicate a live task after restart',async()=>{
 const {contract:c}=fixture();queueInit(c);const j=queueNext(c.runDir).admitted[0];const state=queueStatus(c.runDir);expect(state.jobs.A.attempt).toBe(j.attempt);expect(state.jobs.A.status).toBe('reserved');expect(queueNext(c.runDir).admitted).toEqual([]);
 queueBind(c.runDir,'A',j.attempt,'host-1');expect(()=>queueBind(c.runDir,'A',j.attempt,'host-2')).toThrow('attempt_already_bound');await expect(queueComplete(c.runDir,'A','wrong',c.base)).rejects.toThrow('invalid_completion');
 fs.mkdirSync(path.join(c.runDir,'.queue.lock'));expect(()=>queueNext(c.runDir)).toThrow('queue_busy_or_orphan_lock');expect(fs.existsSync(path.join(c.runDir,'.queue.lock'))).toBe(true);
});

test('failed integration checks never unlock dependencies and retain recovery evidence',async()=>{
 const {contract:c}=fixture();c.integrationChecks=[{...check,argv:['/usr/bin/false']}];queueInit(c);const j=queueNext(c.runDir).admitted[0];await expect(finish(c,j)).rejects.toThrow('check_failed');expect(queueStatus(c.runDir).status).toBe('BLOCKED');expect(queueNext(c.runDir).admitted).toEqual([]);expect(queueStatus(c.runDir).jobs.C).toBeUndefined();expect(fs.readdirSync(path.join(c.runDir,'receipts',j.attempt))).toContain('integration-0.log');
},15_000);

test('out-of-contract changes and changed integration HEAD are rejected before merging',async()=>{
 const {contract:c}=fixture();queueInit(c);const j=queueNext(c.runDir).admitted[0];queueBind(c.runDir,'A',j.attempt,'host-A');fs.writeFileSync(path.join(j.cwd,'unexpected.txt'),'x');git(j.cwd,'add','unexpected.txt');git(j.cwd,'commit','-qm','outside');await expect(queueComplete(c.runDir,'A',j.attempt,git(j.cwd,'rev-parse','HEAD'))).rejects.toThrow('write_set_exceeded');expect(git(c.lane,'rev-parse','HEAD')).toBe(c.base);
 git(c.lane,'commit','--allow-empty','-qm','external');expect(()=>queueNext(c.runDir)).toThrow('integration_head_changed');
});

test('exploration validates declared inputs per section and blocks admission after an input changes',async()=>{
 const {contract:c,dir}=fixture();const note=captureExploration(c.repo,c.base,[{id:'api',text:'Public API v1',inputs:['api.txt']}]);validateExploration(note,c.repo,c.base,['api']);
 const noteFile=path.join(dir,'exploration.json');fs.writeFileSync(noteFile,JSON.stringify(note));c.exploration=noteFile;c.tasks[0].noteSections=['api'];note.sections[0].inputs['api.txt']='0'.repeat(64);fs.writeFileSync(noteFile,JSON.stringify(note));queueInit(c);expect(()=>queueNext(c.runDir)).toThrow('stale_exploration');expect(Object.keys(queueStatus(c.runDir).jobs)).toEqual([]);
});

test('cycles, missing checks and cancellation fail closed without silently releasing active workers',async()=>{
 const {contract:c}=fixture();c.tasks[0].dependencies=['C'];expect(()=>validateContract(c)).toThrow('dependency_cycle');c.tasks[0].dependencies=[];c.tasks[0].checks=[];expect(()=>validateContract(c)).toThrow('invalid_task');c.tasks[0].checks=[check];queueInit(c);const j=queueNext(c.runDir).admitted[0];const cancelled=queueCancel(c.runDir);expect(cancelled.status).toBe('CANCELLING');expect(cancelled.jobs.A.status).toBe('cancel_requested');expect(queueNext(c.runDir).admitted).toEqual([]);expect(()=>queueBind(c.runDir,'A',j.attempt,'host')).toThrow('invalid_binding');
});

test('check timeout terminates its owned process group and blocks further admission',async()=>{
 const {contract:c,dir}=fixture();const marker=path.join(dir,'orphan-marker');
 c.integrationChecks=[{name:'timeout',argv:[process.execPath,'-e',`const {spawn}=require('child_process');spawn(process.execPath,['-e',${JSON.stringify(`setTimeout(()=>require('fs').writeFileSync(${JSON.stringify(marker)},'bad'),1200)`) }],{stdio:'ignore'});setInterval(()=>{},1000);`],timeoutMs:100}];
 queueInit(c);const j=queueNext(c.runDir).admitted[0];await expect(finish(c,j)).rejects.toThrow('check_timeout');await new Promise(r=>setTimeout(r,1400));expect(fs.existsSync(marker)).toBe(false);expect(queueStatus(c.runDir).status).toBe('BLOCKED');
},15_000);

test('verification that changes source cannot produce an integrated receipt',async()=>{
 const {contract:c}=fixture();c.integrationChecks=[{name:'mutating-check',argv:[process.execPath,'-e',"require('fs').writeFileSync('unexpected.txt','bad')"],timeoutMs:1000}];queueInit(c);const j=queueNext(c.runDir).admitted[0];await expect(finish(c,j)).rejects.toThrow('checks_modified_source');expect(queueStatus(c.runDir).jobs.A.status).toBe('integrating');expect(queueStatus(c.runDir).jobs.C).toBeUndefined();
},15_000);

test('conflicting completion is preserved for recovery, never resolved by the executor',async()=>{
 const {contract:c}=fixture();c.tasks[0].writes=['api.txt'];c.tasks[1].writes=['api.txt'];queueInit(c);const a=queueNext(c.runDir).admitted[0];queueBind(c.runDir,a.id,a.attempt,'host-A');
 fs.writeFileSync(path.join(a.cwd,'api.txt'),'worker\n');git(a.cwd,'add','api.txt');git(a.cwd,'commit','-qm','worker');
 // An external integration writer is rejected even when a textual merge might work.
 fs.writeFileSync(path.join(c.lane,'api.txt'),'external\n');git(c.lane,'add','api.txt');git(c.lane,'commit','-qm','external');
 await expect(queueComplete(c.runDir,a.id,a.attempt,git(a.cwd,'rev-parse','HEAD'))).rejects.toThrow('integration_head_changed');expect(fs.readFileSync(path.join(c.lane,'api.txt'),'utf8')).toBe('external\n');
});


test('a worker check cannot switch its branch while retaining the expected commit',async()=>{
 const {contract:c}=fixture();c.tasks[0].checks=[{name:'switch',argv:['git','switch','-c','wrong-worker'],timeoutMs:1000}];queueInit(c);const j=queueNext(c.runDir).admitted[0];await expect(finish(c,j)).rejects.toThrow('worker_identity_changed');expect(git(c.lane,'rev-parse','HEAD')).toBe(c.base);
},15000);

test('changed exploration inputs after an independent integration block dependent admission',async()=>{
 const {contract:c,dir}=fixture();c.tasks[0].writes=['api.txt'];const note=captureExploration(c.repo,c.base,[{id:'api',text:'version one',inputs:['api.txt']}]);c.exploration=path.join(dir,'note.json');fs.writeFileSync(c.exploration,JSON.stringify(note));c.tasks[2].noteSections=['api'];queueInit(c);const j=queueNext(c.runDir).admitted[0];queueBind(c.runDir,j.id,j.attempt,'host-A');fs.writeFileSync(path.join(j.cwd,'api.txt'),'version two\n');git(j.cwd,'add','api.txt');git(j.cwd,'commit','-qm','change API');await queueComplete(c.runDir,j.id,j.attempt,git(j.cwd,'rev-parse','HEAD'));expect(()=>queueNext(c.runDir)).toThrow('stale_exploration');expect(queueStatus(c.runDir).jobs.C).toBeUndefined();
},15000);

test('isolated executable supports the complete host protocol and fail-closed JSON errors',()=>{
 const {contract:c}=fixture();c.tasks=c.tasks.slice(0,1);const launcher=path.resolve(import.meta.dir,'../bin/gstack-autobuilder-ops');
 const call=(request:object)=>{const r=spawnSync(launcher,['queue',JSON.stringify(request)],{cwd:c.repo,env:{...process.env,PATH:path.dirname(process.execPath)+':'+process.env.PATH},encoding:'utf8',timeout:15000});return{exit:r.status,...JSON.parse(r.stdout)};};
 expect(call({action:'init',contract:c}).status).toBe('BUILDING');const j=call({action:'next',runDir:c.runDir}).admitted[0];expect(call({action:'bind',runDir:c.runDir,task:j.id,attempt:j.attempt,handle:'host-A'}).status).toBe('running');fs.writeFileSync(path.join(j.cwd,'A.txt'),'A\n');git(j.cwd,'add','A.txt');git(j.cwd,'commit','-qm','A');const done=call({action:'complete',runDir:c.runDir,task:j.id,attempt:j.attempt,head:git(j.cwd,'rev-parse','HEAD')});expect(done.exit).toBe(0);expect(done.status).toBe('BUILT');expect(done.review_required).toBe(true);expect(call({action:'unknown'})).toEqual({exit:1,status:'BLOCKED',reason:'usage'});
},30000);


test('production size cap stops admission without claiming a passed review',async()=>{
 const {contract:c}=fixture();queueInit(c);const j=queueNext(c.runDir).admitted[0];queueBind(c.runDir,j.id,j.attempt,'host-A');fs.writeFileSync(path.join(j.cwd,'A.txt'),'line\n'.repeat(2500));git(j.cwd,'add','A.txt');git(j.cwd,'commit','-qm','large task');const result=await queueComplete(c.runDir,j.id,j.attempt,git(j.cwd,'rev-parse','HEAD'));expect(result.status).toBe('BLOCKED');expect(queueStatus(c.runDir).reason).toBe('meter_admission_stop');expect(queueNext(c.runDir).admitted).toEqual([]);expect(result.review_required).toBe(true);expect(queueStatus(c.runDir).jobs.C).toBeUndefined();
},15000);


test('ship meter includes pre-unit unshipped work and refuses a new unit at the warning boundary',async()=>{
 const {contract:c}=fixture();fs.writeFileSync(path.join(c.lane,'prior.txt'),'prior\n'.repeat(1900));git(c.lane,'add','prior.txt');git(c.lane,'commit','-qm','prior unit');c.base=git(c.lane,'rev-parse','HEAD');queueInit(c);const j=queueNext(c.runDir).admitted[0];queueBind(c.runDir,j.id,j.attempt,'host-A');fs.writeFileSync(path.join(j.cwd,'A.txt'),'new\n'.repeat(600));git(j.cwd,'add','A.txt');git(j.cwd,'commit','-qm','new unit');const result=await queueComplete(c.runDir,j.id,j.attempt,git(j.cwd,'rev-parse','HEAD'));expect(result.meter.prod_loc).toBe(2500);expect(result.status).toBe('BLOCKED');
 const second=fixture();fs.writeFileSync(path.join(second.contract.lane,'prior.txt'),'prior\n'.repeat(2000));git(second.contract.lane,'add','prior.txt');git(second.contract.lane,'commit','-qm','prior unit');second.contract.base=git(second.contract.lane,'rev-parse','HEAD');expect(()=>queueInit(second.contract)).toThrow('ship_boundary_required');expect(fs.existsSync(path.join(second.contract.runDir,'queue.json'))).toBe(false);
},30000);

test('long checks expose a complete-operation deadline and cancellation preserves failed integration state',async()=>{
 const {contract:c}=fixture();c.integrationChecks=[{name:'red',argv:['/usr/bin/false'],timeoutMs:600000}];queueInit(c);const j=queueNext(c.runDir).admitted[0];expect(j.completionTimeoutMs).toBeGreaterThan(600000);await expect(finish(c,j)).rejects.toThrow('check_failed');const after=queueCancel(c.runDir);expect(after.status).toBe('CANCELLING');expect(after.jobs.A.status).toBe('integrating');expect(after.jobs.A.cancelRequested).toBe(true);expect(after.jobs.A.integrationBase).toBe(c.base);
},15000);
