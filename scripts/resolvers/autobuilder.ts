/** Seat C consumes canonical review methods without the interactive skill lifecycle. */
import fs from 'node:fs';
import path from 'node:path';
import type { TemplateContext } from './types';
import { generateConfidenceCalibration } from './confidence';

export const SEAT_C_SOURCES = [
  ['plan-eng-review/SKILL.md.tmpl', '## My engineering preferences', '{{BRAIN_PREFLIGHT}}'],
  ['plan-eng-review/sections/review-sections.md.tmpl', '## Review Sections (after scope is agreed)', '{{CODEX_PLAN_REVIEW}}'],
  ['plan-eng-review/sections/review-sections.md.tmpl', '### Failure modes', '### Worktree parallelization strategy'],
  ['review/SKILL.md.tmpl', '## Step 2: Read the checklist', '## Step 2.5:'],
  ['review/SKILL.md.tmpl', 'Apply both checklist passes in order:', '{{SECTION:review-army}}'],
] as const;
export function extractCanonicalBlock(source: string, start: string, end: string, file: string): string {
  const a = source.indexOf(start), b = source.indexOf(end, a + start.length);
  if (a < 0 || b < 0 || source.indexOf(start, a + start.length) >= 0 || source.indexOf(end, b + end.length) >= 0)
    throw new Error(`Seat C source boundary missing or ambiguous: ${file}`);
  return source.slice(a, b).trim();
}
export function generateAutobuilderSeatC(ctx: TemplateContext): string {
  const root = path.resolve(import.meta.dir, '../..');
  return SEAT_C_SOURCES.map(([file, start, end]) => {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    // Use /review's calibration, not autobuilder's generic confidence variant.
    const body = extractCanonicalBlock(source, start, end, file).replace('{{CONFIDENCE_CALIBRATION}}', generateConfidenceCalibration({ ...ctx, skillName: 'review' }));
    return `<!-- Canonical source: ${file} | ${start} -->\n${body}`;
  }).join('\n\n');
}
