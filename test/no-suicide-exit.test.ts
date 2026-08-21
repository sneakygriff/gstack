/**
 * Guard: no test file may schedule a delayed process.exit().
 *
 * `bun test` runs EVERY test file in one process. The pattern of arming a
 * 500ms timer in afterAll whose callback calls process.exit(0) — once used
 * in several browse/design tests as a "bm.close() can hang" workaround —
 * assumes each file gets its own process. It doesn't: the armed timer fires
 * 500ms later, mid-way through a LATER test file, and kills the entire
 * suite with exit code 0 and no summary. The truncated run silently masks
 * every downstream failure (observed: only ~16 of 434 files ran, shell
 * exit 0).
 *
 * This test statically scans every *.test.ts in the repo and fails if any
 * schedules process.exit via setTimeout. Teardown must only release the
 * file's own resources (e.g. `await bm.close()` — BrowserManager.close()
 * is already time-boxed internally) — never terminate the shared runner.
 *
 * If a future test legitimately needs this pattern inside a child-process
 * script (template literal passed to `bun -e`), split the child script
 * into a fixture file instead of exempting it here.
 */
import { test, expect } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const repoRoot = path.resolve(import.meta.dir, '..');

// Matches a setTimeout whose callback reaches process.exit in any common
// spelling: bare reference (`setTimeout(process.exit, ...)`), concise-body
// arrow, block-body arrow, or function expression — across line breaks.
// Doesn't match its own escaped source text (the backslashes in this regex
// literal prevent a literal-text match).
const DELAYED_EXIT =
  /setTimeout\(\s*(?:process\.exit\b|(?:\([^)]*\)|\w+)\s*=>\s*\{?\s*process\.exit\(|function[^)]*\)\s*\{\s*process\.exit\()/;

test('guard regex catches every common delayed-exit spelling', () => {
  const positives = [
    'setTimeout(() => process.exit(0), 500);',
    'setTimeout(() => { process.exit(0); }, 500);',
    'setTimeout(process.exit, 500);',
    'setTimeout((code) => process.exit(code), 500);',
    'setTimeout(function () { process.exit(0) }, 500);',
    'setTimeout(() => {\n  process.exit(0);\n}, 500);',
  ];
  for (const p of positives) expect(DELAYED_EXIT.test(p)).toBe(true);
  // Immediate (non-delayed) exits and unrelated timers must not match.
  expect(DELAYED_EXIT.test('process.exit(0);')).toBe(false);
  expect(DELAYED_EXIT.test('setTimeout(() => resolve(), 500);')).toBe(false);
});

test('no test file schedules a delayed process.exit (kills the whole bun test run)', () => {
  // Enumerate via git so vendored trees (node_modules, .git) are never
  // traversed — a repo-wide glob walk paid the node_modules directory scan
  // on every suite run just to filter matches afterwards.
  const tracked = execFileSync('git', ['ls-files', '*.test.ts'], { cwd: repoRoot, encoding: 'utf-8' })
    .split('\n')
    .filter(Boolean);
  const violations: string[] = [];

  for (const rel of tracked) {
    // This file itself carries the outlawed spellings as regex fixtures above.
    if (rel === 'test/no-suicide-exit.test.ts') continue;
    const source = fs.readFileSync(path.join(repoRoot, rel), 'utf-8');
    const m = DELAYED_EXIT.exec(source);
    if (m) {
      const line = source.slice(0, m.index).split('\n').length;
      violations.push(`${rel}:${line}: ${m[0].split('\n')[0].trim()}`);
    }
  }

  expect(violations).toEqual([]);
});
