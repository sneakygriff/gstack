/**
 * The ONE definition of which test files are paid (API spend, external
 * services, e2e harnesses). package.json's test:gate/test:evals globs, the
 * free-suite exclusion in scripts/test-free-shards.ts, and the sharded paid
 * runner in scripts/test-paid-shards.ts all derive from this list — a file
 * added to one and not the others either burns money in the free suite or
 * silently never runs in the paid tier.
 */

import { matchGlob } from './touchfiles';

/** The exact globs package.json's `test:gate` passes to `bun test`. */
export const PAID_TEST_GLOBS = [
  'test/skill-llm-eval.test.ts',
  'test/skill-e2e-*.test.ts',
  'test/skill-routing-e2e.test.ts',
  'test/codex-e2e.test.ts',
  'test/codex-e2e-sol-scope.test.ts',
  'test/gemini-e2e.test.ts',
  // Outside Voices OS-level write-denial sandbox canary (FIX2 gate P0): spawns
  // real codex/grok/gemini CLIs, so it belongs in the paid tier like the files
  // above. Self-gates on EVALS_TIER === 'periodic' (test/outside-voices-sandbox.test.ts
  // header) — never runs under test:gate. Was previously in NO tier at all
  // (gate-eng-review's core finding: M1 shipped green while this canary's
  // safety property was untested on the build machine); this line is what
  // makes `bun run test:periodic`/`test:periodic:sharded` actually re-run it.
  'test/outside-voices-sandbox.test.ts',
  // grok-as-reviewer / gemini-as-reviewer E2E (M3/T6): drives the REAL
  // bin/gstack-panel reviewer call path for each voice, spawning the real
  // grok/gemini CLIs. Same shape as test/outside-voices-sandbox.test.ts —
  // self-gates on EVALS_TIER === 'periodic' via test/helpers/e2e-gate.ts
  // (test/outside-voices-reviewer-e2e.test.ts header) — never runs under
  // test:gate. Listed here so test:periodic:sharded actually picks it up.
  'test/outside-voices-reviewer-e2e.test.ts',
] as const;

/** True when a repo-relative path (either slash style) is a paid test file. */
export function isPaidTestFile(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, '/');
  return PAID_TEST_GLOBS.some((glob) => matchGlob(normalized, glob));
}
