import { test, expect } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { generateAutobuilderSeatC, extractCanonicalBlock } from '../scripts/resolvers/autobuilder';
import { generateAskUserFormat } from '../scripts/resolvers/preamble/generate-ask-user-format';
const root=path.resolve(import.meta.dir,'../autobuilder-loop');
const read=(p:string)=>fs.readFileSync(path.join(root,p),'utf8');
const hash=(s:string)=>crypto.createHash('sha256').update(s).digest('hex');

test('every pre-carve source block retains its mapped bytes with only declared contract changes',()=>{
 const map=JSON.parse(read('sections/preservation.json'));expect(map.blocks).toHaveLength(12);
 expect(new Set(map.blocks.map((b:any)=>b.id)).size).toBe(12);
 for(const b of map.blocks){const text=read(b.target);const start=`<!-- PRESERVED:${b.id}:BEGIN -->\n`,end=`\n<!-- PRESERVED:${b.id}:END -->`;
  expect(text.split(start)).toHaveLength(2);expect(text.split(end)).toHaveLength(2);
  const body=text.split(start)[1].split(end)[0];expect(hash(body)).toBe(b.target_sha256);
  if(b.change==='verbatim')expect(b.target_sha256).toBe(b.source_sha256);
 }
});

test('router stays within 1500 words plus the unchanged mandatory question contract',()=>{
 const entry=read('SKILL.md');
 const format=generateAskUserFormat({skillName:'autobuilder-loop',paths:{skillRoot:'~/.claude/skills/gstack'}} as any);
 expect(entry.split(format)).toHaveLength(2);
 expect(read('sections/run-setup.md')).not.toContain('## AskUserQuestion Format');
 expect(entry.replace(format,'').trim().split(/\s+/).length).toBeLessThanOrEqual(1500);
 for(const id of ['run-setup','contracts','build','gate','release','workflow-reference','continuous-queue'])expect(entry).toContain(`sections/${id}.md`);
 for(const text of ['EITHER model FAILs','INVALID never counts as ABSENT','REVIEW_INCOMPLETE','there is no Seat X waiver','BUILT is not','2,500'])expect(entry).toContain(text);
 expect(read('sections/contracts.md.tmpl')).not.toContain('SHIP_METER measurement (`git rev-parse`');
});

test('generated references have no unresolved macros and all manifest targets exist',()=>{
 const manifest=JSON.parse(read('sections/manifest.json'));
 for(const entry of manifest.sections){expect(read(`sections/${entry.file}`)).not.toMatch(/\{\{[A-Z_]+/);expect(read(`sections/${entry.file}.tmpl`).length).toBeGreaterThan(0);}
 const rubric=generateAutobuilderSeatC({skillName:'autobuilder-loop',host:'claude'} as any);expect(rubric).toContain('Apply both checklist passes');
});


test('canonical extraction rejects missing and ambiguous source markers',()=>{
 expect(extractCanonicalBlock('before START policy END after','START','END','fixture')).toBe('START policy');
 for(const input of ['START policy','END policy','START START policy END','START policy END END'])
  expect(()=>extractCanonicalBlock(input,'START','END','fixture')).toThrow('missing or ambiguous');
});


test('host handoff preserves ship range, task ownership and serialized helper lifecycle',()=>{
 const reference=read('sections/continuous-queue.md.tmpl');
 for(const rule of ['base: shipBase','Pass `waves` metadata','gateClass: critical','Serialize helper commands','completionTimeoutMs','missing scope evidence is BLOCKED'])expect(reference).toContain(rule);
});
