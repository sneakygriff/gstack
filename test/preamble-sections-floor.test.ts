/**
 * preamble/sections/ regression floor (GATE tier, free).
 *
 * The union-normalized parity baseline (test/fixtures/parity-baseline-v1.44.1.json
 * + parity-suite/parity-sectioned) compares generated SKILL.md output against a
 * per-skill byte union. Because the shared preamble/sections/*.md files are
 * carved OUT of every SKILL.md and read lazily at runtime (not inlined into the
 * generated output), that baseline has zero visibility into them: delete
 * preamble/sections/onboarding.md, or gut it to a stub, and every parity/size
 * test still passes — the onboarding gate, the full AskUserQuestion format spec,
 * and the artifacts-sync stop-gate all go silently unreachable on a live run.
 *
 * This file is the guard the union baseline structurally cannot provide:
 *   1. the three shared section files exist on disk;
 *   2. each is still above a byte floor (catches silent gutting, not just deletion);
 *   3. each still contains the distinctive markers a skill's Preamble Section
 *      Index promises the file will deliver (catches content substitution that
 *      preserves size but drops the actual gate/contract text);
 *   4. every generated SKILL.md that advertises a "Preamble Section Index"
 *      only points at preamble/sections/ filenames that actually exist on disk
 *      (catches a rename/delete on one side of the index<->file contract).
 */

import { describe, test, expect } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';

const REPO_ROOT = path.resolve(import.meta.dir, '..');
const SECTIONS_DIR = path.join(REPO_ROOT, 'preamble', 'sections');

const SECTION_FILES = {
  onboarding: 'onboarding.md',
  askUserQuestions: 'ask-user-questions.md',
  artifactsSync: 'artifacts-sync.md',
} as const;

/**
 * Byte floors, measured 2026-08-16 against the files as they stood on this
 * branch (skills/add-autobuilder-loop-and-plan-deliverables):
 *   onboarding.md          6583 bytes -> floor = floor(6583  * 0.75) = 4937
 *   ask-user-questions.md 10869 bytes -> floor = floor(10869 * 0.75) = 8151
 *   artifacts-sync.md      1240 bytes -> floor = floor(1240  * 0.75) = 930
 * A floor this close to current size (25% under) is deliberately tight: it
 * exists to catch gutting, not to tolerate normal trims. Legitimate shrinkage
 * that crosses the floor should lower it explicitly in the same PR, with the
 * new measured size + date noted here.
 */
const BYTE_FLOORS: Record<keyof typeof SECTION_FILES, number> = {
  onboarding: 4937,
  askUserQuestions: 8151,
  artifactsSync: 930,
};

/**
 * Stable, distinctive markers quoted verbatim from each file's current
 * content. Picked so that (a) losing any one of them means the file no
 * longer delivers what its Preamble Section Index row promises, and (b)
 * they're unlikely to be touched by unrelated copy edits.
 */
const MARKERS: Record<keyof typeof SECTION_FILES, string[]> = {
  // Onboarding gate trigger flags — the literal conditions that route each
  // one-time prompt block. Losing these silently disconnects the gate.
  onboarding: [
    'If `LAKE_INTRO` is `no`',
    'If `TEL_PROMPTED` is `no` AND `LAKE_INTRO` is `yes`',
    'If `VENDORED_GSTACK` is `yes`',
  ],
  // The AUQ format contract heading + its two load-bearing subsections.
  askUserQuestions: [
    '## AskUserQuestion Format',
    '### Format',
    '### Self-check before emitting',
  ],
  // The ARTIFACTS_SYNC_PROMPT stop-gate literal + the "don't auto-run" rule
  // it exists to enforce.
  artifactsSync: [
    'ARTIFACTS_SYNC_PROMPT: needed',
    'auto-run the restore.',
  ],
};

function readSection(file: string): string {
  return fs.readFileSync(path.join(SECTIONS_DIR, file), 'utf-8');
}

describe('preamble/sections/ floor (union-normalized parity baseline blind spot)', () => {
  for (const [key, file] of Object.entries(SECTION_FILES) as [keyof typeof SECTION_FILES, string][]) {
    describe(file, () => {
      test('exists on disk', () => {
        expect(fs.existsSync(path.join(SECTIONS_DIR, file))).toBe(true);
      });

      test(`is at least ${BYTE_FLOORS[key]} bytes (~25% under measured size)`, () => {
        const bytes = fs.statSync(path.join(SECTIONS_DIR, file)).size;
        expect(bytes).toBeGreaterThanOrEqual(BYTE_FLOORS[key]);
      });

      test('contains its distinctive markers', () => {
        const content = readSection(file);
        for (const marker of MARKERS[key]) {
          expect(content).toContain(marker);
        }
      });
    });
  }
});

/**
 * Every first-level directory's SKILL.md (glob: one dir deep, "SKILL.md")
 * that advertises a "Preamble Section Index" is a promise: it will only ever
 * point readers at preamble/sections/ files that exist. Verify the promise
 * against the real filesystem, not a generation-time fixture — this is what
 * catches a file getting renamed or deleted out from under every skill that
 * references it.
 */
function listFirstLevelSkillMdFiles(): string[] {
  const entries = fs.readdirSync(REPO_ROOT, { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules')
    .map((e) => path.join(REPO_ROOT, e.name, 'SKILL.md'))
    .filter((p) => fs.existsSync(p));
}

describe('Preamble Section Index references only files that exist on disk', () => {
  const skillMdFiles = listFirstLevelSkillMdFiles();

  test('at least one SKILL.md advertises the Preamble Section Index (sanity: the check below is not vacuous)', () => {
    const withIndex = skillMdFiles.filter((p) => fs.readFileSync(p, 'utf-8').includes('Preamble Section Index'));
    expect(withIndex.length).toBeGreaterThan(0);
  });

  for (const skillMdPath of skillMdFiles) {
    const rel = path.relative(REPO_ROOT, skillMdPath);
    test(`${rel}: referenced preamble/sections/ filenames exist`, () => {
      const content = fs.readFileSync(skillMdPath, 'utf-8');
      if (!content.includes('Preamble Section Index')) return; // no index promise made, nothing to check

      const referenced = new Set<string>();
      for (const m of content.matchAll(/preamble\/sections\/([A-Za-z0-9_.-]+\.md)/g)) {
        referenced.add(m[1]);
      }

      const missing = [...referenced].filter((f) => !fs.existsSync(path.join(SECTIONS_DIR, f)));
      if (missing.length > 0) {
        throw new Error(
          `${rel} references preamble/sections/ file(s) that do not exist on disk: ${missing.join(', ')}`,
        );
      }
    });
  }
});
