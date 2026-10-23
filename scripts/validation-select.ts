#!/usr/bin/env bun
/** Dependent validation, JSON output, preview by default.
 *   bun scripts/validation-select.ts --plan -- autobuilder-loop/SKILL.md.tmpl
 *   bun scripts/validation-select.ts --plan --base main
 *   bun scripts/validation-select.ts --run-free -- scripts/test-focused.ts
 * Explicit-path preview starts no child processes; --base only reads Git.
 * Unknown dependencies exit 2 and block execution. Free results retain the
 * focused runner's receipt/exit code; this command never certifies full coverage
 * or launches any listed model evaluation. No EVALS_ALL/billing override applies.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { FREE_TOUCHFILES, E2E_TOUCHFILES, E2E_TIERS, LLM_JUDGE_TOUCHFILES, GLOBAL_TOUCHFILES, matchGlob, selectTests, getChangedFiles } from '../test/helpers/touchfiles';
import { CARVE_GUARDS } from '../test/helpers/carve-guards';
import { isPaidTestFile } from '../test/helpers/paid-test-set';

type Reason = { source: string; registry: string; pattern: string };
function reasons(files: string[], patterns: readonly string[], registry: string): Reason[] {
  return files.flatMap(source => patterns.filter(pattern => matchGlob(source, pattern)).map(pattern => ({ source, registry, pattern })));
}

async function main() {
  const args = process.argv.slice(2);
  let root = process.cwd();
  let inputs: string[] = [];
  let runFree = false;
  let planOnly = false;
  let base: string | undefined;
  let explicitFiles = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--') { explicitFiles = true; inputs.push(...args.slice(i + 1)); break; }
    if (args[i] === '--root' && args[i + 1]) root = args[++i];
    else if (args[i] === '--base' && args[i + 1]) base = args[++i];
    else if (args[i] === '--run-free') runFree = true;
    else if (args[i] === '--plan') planOnly = true;
    else if (!args[i].startsWith('-')) { explicitFiles = true; inputs.push(args[i]); }
    else throw new Error(`Unknown option: ${args[i]}`);
  }
  if (runFree && planOnly) throw new Error('cannot combine --plan and --run-free');
  if (base && explicitFiles) throw new Error('cannot combine --base and explicit changed paths');
  root = fs.realpathSync(root);
  if (base) inputs = getChangedFiles(base, root);
  const files = [...new Set(inputs.map(input => {
    const relative = path.relative(root, path.resolve(root, input)).split(path.sep).join('/');
    if (!relative || relative.startsWith('../') || path.isAbsolute(relative) || /[\n\r\0]/.test(relative)) throw new Error(`Invalid changed path: ${input}`);
    return relative;
  }))].sort();
  const free = Object.entries(FREE_TOUCHFILES).flatMap(([file, patterns]) => {
    const why = reasons(files, patterns, 'FREE_TOUCHFILES');
    return why.length ? [{ file, reasons: why }] : [];
  });
  for (const file of files) {
    if (/\.test\.(?:[cm]?[jt]s|tsx|jsx)$/.test(file) && !isPaidTestFile(file)) {
      const reason = { source: file, registry: 'exact changed free test', pattern: file };
      const selected = free.find(check => check.file === file);
      if (selected) selected.reasons.push(reason);
      else free.push({ file, reasons: [reason] });
    }
  }
  const model: Array<{ id: string; kind: string; file?: string; tier?: string; reasons: Reason[] }> = [];
  // A registry edit cannot be safely scoped without its previous data. Keep it
  // explicit, never invoke map-diff's fallback-to-all (or its subprocess) here.
  const mappedFiles = files.filter(file => file !== 'test/helpers/touchfiles-data.ts');
  for (const [kind, registry, table] of [['e2e', 'E2E_TOUCHFILES', E2E_TOUCHFILES], ['judge', 'LLM_JUDGE_TOUCHFILES', LLM_JUDGE_TOUCHFILES]] as const) {
    for (const id of selectTests(mappedFiles, table, GLOBAL_TOUCHFILES).selected) {
      model.push({ id, kind, ...(kind === 'e2e' ? { tier: E2E_TIERS[id] } : {}),
        reasons: [...reasons(mappedFiles, table[id], registry), ...reasons(mappedFiles, GLOBAL_TOUCHFILES, 'GLOBAL_TOUCHFILES')] });
    }
  }
  for (const guard of Object.values(CARVE_GUARDS)) {
    const why = reasons(files, [`${guard.skill}/**`, 'test/helpers/carve-guards.ts', 'scripts/resolvers/sections.ts'], 'CARVE_GUARDS');
    if (why.length && guard.behavioral !== 'none') model.push({ id: guard.skill, kind: 'section-read', tier: 'periodic',
      file: guard.externalTest ?? `test/carve-section-loading-${guard.skill}.test.ts`, reasons: why });
  }
  if (free.some(check => isPaidTestFile(check.file))) throw new Error('Free registry contains a paid evaluation');
  const covered = new Set([...free, ...model].flatMap(check => check.reasons.map(reason => reason.source)));
  // Paid-profile exemptions do not establish free coverage. Unmapped executable
  // helpers, fixtures and checkout instructions must remain explicitly unknown.
  const ignoredFiles = files.filter(file => !covered.has(file)
    && /^(?:docs\/|(?:README|CONTRIBUTING|ARCHITECTURE|CHANGELOG|TODOS)\.md$|VERSION$)/.test(file));
  const unknownFiles = files.filter(file => (!covered.has(file) && !ignoredFiles.includes(file)) || file === 'test/helpers/touchfiles-data.ts');
  const report = { version: 1, kind: 'dependent-check-plan', root, base: base ?? null, changedFiles: files,
    status: unknownFiles.length ? 'blocked' : free.length || model.length ? 'planned' : 'no-work', coverageCredit: false,
    free, model, ignoredFiles, unknownFiles,
    uncertainties: unknownFiles.map(file => ({ file, reason: file === 'test/helpers/touchfiles-data.ts'
      ? 'Dependency registry changed; prior-map review is required before execution.'
      : 'No registered dependency or non-behavior classification; coverage is unknown.' })) };
  if (unknownFiles.length || !runFree || !free.length) {
    console.log(JSON.stringify(report));
    if (unknownFiles.length) process.exitCode = 2;
    return;
  }
  const child = Bun.spawn([process.execPath, path.join(import.meta.dir, 'test-focused.ts'), '--root', root,
    '--', ...free.map(check => check.file)], { cwd: root, stdout: 'pipe', stderr: 'inherit' });
  const forwardInt = () => child.kill('SIGINT');
  const forwardTerm = () => child.kill('SIGTERM');
  process.on('SIGINT', forwardInt); process.on('SIGTERM', forwardTerm);
  try {
    const output = await new Response(child.stdout).text();
    const code = await child.exited;
    const freeResult = output.trim() ? JSON.parse(output) : null;
    console.log(JSON.stringify({ ...report, kind: 'dependent-check-result', scope: 'free-only', modelExecution: 'not-run',
      status: freeResult?.status ?? 'incomplete', freeResult }));
    process.exitCode = code || (freeResult ? 0 : 1);
  } finally {
    process.off('SIGINT', forwardInt); process.off('SIGTERM', forwardTerm);
  }
}
if (import.meta.main) {
  try { await main(); }
  catch (error) { console.error(`[validation:select] ${error instanceof Error ? error.message : String(error)}`); process.exitCode = 1; }
}
