/**
 * Structural coverage for the two fork-only skills (review finding:
 * floor-only eval coverage). autobuilder-loop and plan-deliverables had
 * nothing beyond skill-coverage-floor.test.ts, which only pins frontmatter
 * shape and body length — it cannot see whether a load-bearing recipe
 * fragment (a security gate, a retry contract, a fail-closed verdict) got
 * clobbered by a template edit.
 *
 * Free static-text pins over the .tmpl SOURCES (not the generated
 * SKILL.md) — this is what an author actually edits, and it's what
 * `bun run gen:skill-docs` reads from. No LLM, no E2E cost.
 *
 * Each pin below is tied to a real incident cited inline in the .tmpl
 * (dates/notes preserved in the comments at the cited lines) so a future
 * "simplify this bash" pass can't silently regress the exact class of bug
 * that was already caught once.
 */
import { describe, test, expect } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(import.meta.dir, '..');
const AUTOBUILDER_TMPL = fs.readFileSync(path.join(ROOT, 'autobuilder-loop', 'SKILL.md.tmpl'), 'utf-8');
const PLAN_DELIVERABLES_TMPL = fs.readFileSync(path.join(ROOT, 'plan-deliverables', 'SKILL.md.tmpl'), 'utf-8');

describe('autobuilder-loop/SKILL.md.tmpl — recipe invariants', () => {
  test('Codex forum-member config gate rejects only the explicit negative (disabled/off)', () => {
    // Gate on the EXPLICIT negative only — an unknown/empty value must not
    // silently drop the member (live failure 2026-08-15: a literal `!= "on"`
    // check classified enabled-as-disabled).
    expect(AUTOBUILDER_TMPL).toContain('= "disabled" ] || [ "$_CODEX_ENABLED" = "off"');
  });

  test('Grok forum-member config gate rejects absent/disabled/off explicitly', () => {
    expect(AUTOBUILDER_TMPL).toContain(
      '[ "$_GROK_ENABLED" = "absent" ] || [ "$_GROK_ENABLED" = "disabled" ] || [ "$_GROK_ENABLED" = "off" ]',
    );
  });

  test('error-class retry: quota is its own class, and timeout steps down to medium effort', () => {
    // Exit code alone conflates timeout/capacity/quota (proven live 2026-07:
    // exit-1 quota AND exit-1 capacity both looked like "Codex gone"), so the
    // recipe must branch on stderr content, not just $?.
    expect(AUTOBUILDER_TMPL).toContain('quota');
    expect(AUTOBUILDER_TMPL).toContain('stepping down to medium');
  });

  test('a forum member ABSENT at one gate is re-attempted at the next, never latched for the run', () => {
    expect(AUTOBUILDER_TMPL).toContain('ABSENT is PER-GATE');
  });

  test('Worktree preflight gate checks git status --porcelain and offers a stash option', () => {
    expect(AUTOBUILDER_TMPL).toContain('git status --porcelain');
    expect(AUTOBUILDER_TMPL).toContain('git stash push -u -m "autobuilder-preflight"');
  });

  test('the adversarial-forum gate verdict is fail-closed', () => {
    // Absence of a positive success signal is a FAIL, not a pass-by-default.
    expect(AUTOBUILDER_TMPL).toContain('fail-closed');
  });
});

describe('plan-deliverables/SKILL.md.tmpl — recipe invariants', () => {
  test('cross-model gap-check retries by failure class, not raw exit code alone', () => {
    expect(PLAN_DELIVERABLES_TMPL).toContain('Retry by failure class');
  });

  test('milestone content travels via the GAP_CONTEXT_FILE file transport, not pasted into the script', () => {
    // A doc-derived line equal to a heredoc terminator ends the heredoc early
    // and everything after it EXECUTES as shell (cross-model forum [P1],
    // 2026-08-15) — the fix is a separate context FILE, never inlined text.
    expect(PLAN_DELIVERABLES_TMPL).toContain('GAP_CONTEXT_FILE');
    expect(PLAN_DELIVERABLES_TMPL).toContain('EXECUTES as shell');
  });

  test('the skip-guard greps for the untrusted-context fence before sending the prompt', () => {
    // Guards against a placeholder/empty prompt going out silently when the
    // context file was never written or appended.
    expect(PLAN_DELIVERABLES_TMPL).toContain("grep -q 'BEGIN UNTRUSTED CONTEXT'");
  });
});
