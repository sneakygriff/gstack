import { test, expect } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import { runScenario } from './fixtures/autobuilder-unit/harness.mjs';
import { generateAutobuilderSeatC, SEAT_C_SOURCES } from '../scripts/resolvers/autobuilder';
import { usesLazySections } from '../scripts/resolvers/sections';
const root = path.resolve(import.meta.dir, '..');
const script = path.join(root, 'autobuilder-loop/autobuilder-unit.js');

test('measurement matches observed logical calls and prompt sizes, including final checkpoint; no fabricated billing', async () => {
  const r = await runScenario('cleanFull', script);
  expect(r.ok).toBe(true);
  expect(r.res.measurement.logical_dispatches).toBe(r.calls.length);
  expect(r.res.measurement.prompt_chars).toBe(r.calls.reduce((n: number, c: any) => n + c.prompt.length, 0));
  expect(r.res.measurement.actual_tokens).toBeNull(); expect(r.res.measurement.duration_ms).toBeNull();
  const sum = Object.values(r.res.measurement.by_model).reduce((n: number, b: any) => n + b.logical_dispatches, 0);
  expect(sum).toBe(r.calls.length);
  expect(Object.values(r.res.measurement.by_phase).reduce((n: number, b: any) => n + b.logical_dispatches, 0)).toBe(r.calls.length);
  expect(Object.keys(r.res.measurement.by_phase).every(k => ['refresh', 'build', 'integrate', 'gate', 'fix', 'ship', 'patch', 'other'].includes(k))).toBe(true);
  const stateCalls = r.calls.filter((c: any) => c.label.startsWith('state:'));
  expect(stateCalls.length).toBeGreaterThan(0);
  expect(stateCalls.every((c: any) => c.prompt.includes('gstack-autobuilder-ops state'))).toBe(true);
  const seats = r.calls.filter((c: any) => /seat C/.test(c.label));
  expect(seats.length).toBeGreaterThan(0);
  expect(seats.every((c: any) => c.prompt.includes('/sections/seat-c-review.md'))).toBe(true);
  expect(seats.every((c: any) => !c.prompt.includes('/plan-eng-review/SKILL.md'))).toBe(true);
}, 30_000);

test('review method extracts every canonical source block and retains canonical checklist obligation', () => {
  const ctx = { skillName: 'autobuilder-loop', host: 'claude' } as any;
  const result = generateAutobuilderSeatC(ctx);
  for (const [file, start, end] of SEAT_C_SOURCES) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    const block = source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start) + start.length)).trim();
    // Calibration is expanded with /review context; all other canonical clauses stay verbatim.
    for (const part of block.split('{{CONFIDENCE_CALIBRATION}}')) if (part.trim()) expect(result).toContain(part.trim());
  }
  expect(result).toContain('review/checklist.md');
  expect(result).toContain('If any failure mode has no test AND no error handling AND would be silent');
  expect(result).toContain('Apply both checklist passes in order: CRITICAL, then INFORMATIONAL. Respect its suppressions.');
  expect(result).not.toContain('{{SECTION_INDEX');
  const generated = fs.readFileSync(path.join(root, 'autobuilder-loop/sections/seat-c-review.md'), 'utf8');
  expect(generated).not.toMatch(/\{\{[A-Z_]+/);
});

test('manual recipes are conditional on every host; entrypoint retains gate policy', () => {
  for (const h of ['claude', 'codex', 'gemini', 'openclaw']) expect(usesLazySections(h as any, 'autobuilder-loop')).toBe(true);
  const entry = fs.readFileSync(path.join(root, 'autobuilder-loop/SKILL.md'), 'utf8');
  expect(entry).toContain('Before executing a gate manually without Workflow, or diagnosing gate evidence');
  expect(entry).toContain('INVALID never counts as ABSENT');
  expect(entry).toContain('a kept `[P1]` from EITHER model FAILs the gate');
  expect(entry).toContain('there is no Seat X waiver');
  expect(entry).not.toContain('_CODEX_STATUS=ABSENT; _V=');
});
