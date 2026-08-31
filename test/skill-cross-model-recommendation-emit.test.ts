/**
 * Static guard for cross-model synthesis recommendation emit instructions.
 *
 * v1.25.1.0+ extended the AskUserQuestion recommendation-quality coverage
 * to the cross-model /codex skill surfaces (review/challenge/consult). Each
 * surface MUST tell the model to end its synthesis with a canonical
 *   `Recommendation: <action> because <reason>`
 * line so judgeRecommendation can grade it (see test/llm-judge-recommendation
 * for the rubric exercise).
 *
 * NOTE (outside-voices M3): /review + /ship's two adversarial passes (the
 * Claude adversarial subagent + the Codex adversarial `codex exec` challenge)
 * were deleted from scripts/resolvers/review.ts and single-sourced into the
 * shared outside-voices advisory panel (surface=review). The panel uses a
 * machine-readable verdict block (schema `outside-voice/v2`), NOT the
 * `Recommendation: <action> because` line, so the two former review.ts pins
 * are gone; the panel's verdict contract is pinned in
 * test/skill-recipe-invariants.test.ts instead.
 *
 * Free, deterministic, single-purpose: if any contributor edits these
 * templates and removes the emit instruction, this test trips before the
 * change reaches a paid eval. The runtime grading still happens via
 * judgeRecommendation when the skills run for real; this test just pins the
 * source of truth.
 */
import { describe, test, expect } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(import.meta.dir, '..');

describe('cross-model synthesis emit instructions', () => {
  test('codex/SKILL.md.tmpl Step 2A (review) requires a synthesis Recommendation', () => {
    const tmpl = fs.readFileSync(path.join(ROOT, 'codex', 'SKILL.md.tmpl'), 'utf-8');
    const step2a = sliceBetween(tmpl, '## Step 2A:', '## Step 2B:');
    expect(step2a, 'Step 2A section not found in codex template').not.toBe('');
    expect(step2a).toMatch(/Synthesis recommendation \(REQUIRED\)/);
    expect(step2a).toMatch(/Recommendation:\s*<action>\s*because/);
  });

  test('codex/SKILL.md.tmpl Step 2B (challenge) requires a synthesis Recommendation', () => {
    const tmpl = fs.readFileSync(path.join(ROOT, 'codex', 'SKILL.md.tmpl'), 'utf-8');
    const step2b = sliceBetween(tmpl, '## Step 2B:', '## Step 2C:');
    expect(step2b, 'Step 2B section not found in codex template').not.toBe('');
    expect(step2b).toMatch(/Synthesis recommendation \(REQUIRED\)/);
    expect(step2b).toMatch(/Recommendation:\s*<action>\s*because/);
  });

  test('codex/SKILL.md.tmpl Step 2C (consult) requires a synthesis Recommendation', () => {
    const tmpl = fs.readFileSync(path.join(ROOT, 'codex', 'SKILL.md.tmpl'), 'utf-8');
    const step2c = sliceBetween(tmpl, '## Step 2C:', '## Model & Reasoning');
    expect(step2c, 'Step 2C section not found in codex template').not.toBe('');
    expect(step2c).toMatch(/Synthesis recommendation \(REQUIRED\)/);
    expect(step2c).toMatch(/Recommendation:\s*<action>\s*because/);
  });

  // The two former pins here — the Claude adversarial subagent prompt and the
  // Codex adversarial `codex exec` challenge in scripts/resolvers/review.ts —
  // were removed when those inline passes were deleted and delegated to the
  // shared outside-voices panel (surface=review, outside-voices M3). The panel
  // emits a machine-readable verdict block, not the `Recommendation: <action>`
  // line, so there is no equivalent emit instruction to assert here; the panel's
  // verdict contract is pinned in test/skill-recipe-invariants.test.ts.
  test('review.ts no longer inlines the deleted adversarial passes', () => {
    const resolver = fs.readFileSync(path.join(ROOT, 'scripts', 'resolvers', 'review.ts'), 'utf-8');
    // The two deleted block headings from generateAdversarialStep. (There is
    // no "dashboard's Review-tiers bullet" post-M3 — the dashboard now
    // renders a single N-voice "Outside Voice" row sourced from the
    // `outside-voices` aggregate record, not a per-pass Review-tiers list.
    // The bare phrases still appear once in generateAdversarialStep's own
    // explanatory comment above the generateOutsideVoices(...) call
    // (review.ts:488, "The two adversarial PASSES … are now single-sourced
    // from the shared outside-voices advisory panel") — so assert the
    // specific block markers, not the bare phrases.)
    expect(resolver).not.toContain('### Claude adversarial subagent (always runs)');
    expect(resolver).not.toContain('### Codex adversarial challenge');
    // The delegated panel must be wired in.
    expect(resolver).toContain("generateOutsideVoices(ctx, ['surface=review'])");
  });
});

function sliceBetween(text: string, startMarker: string, endMarker: string): string {
  const start = text.indexOf(startMarker);
  if (start < 0) return '';
  const end = text.indexOf(endMarker, start + startMarker.length);
  return end > start ? text.slice(start, end) : text.slice(start);
}
