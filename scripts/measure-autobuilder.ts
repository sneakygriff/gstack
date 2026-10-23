#!/usr/bin/env bun
/** Reproducible local comparison; fake agents, no provider calls or quota claims.
 * bun scripts/measure-autobuilder.ts [base-ref]
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { runScenario } from '../test/fixtures/autobuilder-unit/harness.mjs';
const root = path.resolve(import.meta.dir, '..');
const base = process.argv[2] || 'ba1a3153';
if (base.startsWith('-') || !/^[A-Za-z0-9_./-]+$/.test(base)) throw new Error('invalid base');
function prior(file: string) {
  const r = spawnSync('git', ['show', `${base}:${file}`], { cwd: root, encoding: 'utf8', timeout: 10_000, maxBuffer: 4 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`cannot read base artifact: ${file}`); return r.stdout;
}
const now = (f: string) => fs.readFileSync(path.join(root, f), 'utf8');
const count = (s: string) => ({ chars: s.length, words: s.trim().split(/\s+/).length });
const diff = (a: string, b: string) => ({ before: count(a), after: count(b), char_reduction_percent: Number(((1 - b.length / a.length) * 100).toFixed(1)) });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ab-measure-'));
try {
  const oldScript = path.join(tmp, 'baseline.js'); fs.writeFileSync(oldScript, prior('autobuilder-loop/autobuilder-unit.js'));
  const scenarios: any[] = [];
  for (const name of ['cleanFull', 'p1ThenP2', 'astraQuotaCritical', 'meterGitErrorIntegrate']) {
    const old = await runScenario(name, oldScript), current = await runScenario(name, path.join(root, 'autobuilder-loop/autobuilder-unit.js'));
    if (!old.ok || !current.ok) throw new Error(`scenario failed: ${name}`);
    const signature = (r: any) => JSON.stringify(r.calls.map((c: any) => [c.label, c.model]));
    if (signature(old) !== signature(current) || old.res.status !== current.res.status) throw new Error(`gate/dispatch behavior changed: ${name}`);
    const stats = (r: any) => ({ logical_dispatches: r.calls.length, explicit_prompt_chars: r.calls.reduce((s: number, c: any) => s + c.prompt.length, 0),
      state_prompt_chars: r.calls.filter((c: any) => c.label.startsWith('state:')).reduce((s: number, c: any) => s + c.prompt.length, 0) });
    scenarios.push({ name, outcome: current.res.status, dispatch_labels_and_models_unchanged: true, before: stats(old), after: stats(current) });
  }
  console.log(JSON.stringify({ base, disclaimer: 'Static text and mock-Workflow logical calls only. Excludes tool/schema/file-read tokens and nested CLI usage. No billed-token or latency savings measured.',
    entrypoint: diff(prior('autobuilder-loop/SKILL.md'), now('autobuilder-loop/SKILL.md')),
    seat_c_required_read: diff(prior('plan-eng-review/SKILL.md') + prior('review/SKILL.md') + prior('review/checklist.md'), now('autobuilder-loop/sections/seat-c-review.md') + now('review/checklist.md')),
    scenarios }, null, 2));
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }
