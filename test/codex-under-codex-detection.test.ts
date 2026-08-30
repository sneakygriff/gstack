/**
 * Running-under-Codex detection (#2519, maintainer decision 7).
 *
 * /review executed inside a Codex host used to spawn nested codex
 * specialists — the same model reviewing itself at multiplied token cost
 * (observed: 15M tokens for one /review). A live Codex session exports
 * CODEX_THREAD_ID / CODEX_SANDBOX into every shell it spawns (verified
 * against a live `codex exec 'env | grep -i codex'` capture on codex
 * 0.147.0: CODEX_THREAD_ID, CODEX_SANDBOX=seatbelt,
 * CODEX_SANDBOX_NETWORK_DISABLED=1, CODEX_CI=1). The shared codexPreflight
 * presence-probes those vars and yields CODEX_MODE=under_codex, skipping
 * nested spawns with a one-line notice; GSTACK_FORCE_CODEX_REVIEW=1
 * overrides.
 */
import { describe, test, expect } from 'bun:test';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { codexPreflight } from '../scripts/resolvers/constants';

const ROOT = path.resolve(import.meta.dir, '..');

/** Extract the runnable bash from the rendered preflight (strip fences/prose). */
function preflightBash(): string {
  const rendered = codexPreflight({ disabledBehavior: 'codex-only' });
  const start = rendered.indexOf('```bash') + '```bash'.length;
  const end = rendered.indexOf('```', start);
  return rendered.slice(start, end);
}

function runPreflight(env: Record<string, string>): string {
  const result = spawnSync('bash', ['-c', `set +e\n${preflightBash()}`], {
    env: {
      // Minimal PATH without codex so the not_installed branch is reachable
      // and no real gstack-config/codex runs. The block's fallbacks
      // (`|| echo enabled`) keep it self-contained.
      PATH: '/usr/bin:/bin',
      HOME: '/nonexistent-home',
      ...env,
    },
    timeout: 10000,
  });
  return (result.stdout ?? '').toString();
}

describe('under-codex detection bash (#2519)', () => {
  test('CODEX_THREAD_ID present -> under_codex', () => {
    const out = runPreflight({ CODEX_THREAD_ID: '01a00ba9-ff91-7143-b424-c2d9b0cc89ff' });
    expect(out).toContain('CODEX_MODE: under_codex');
  });

  test('CODEX_SANDBOX present (no thread id) -> under_codex', () => {
    const out = runPreflight({ CODEX_SANDBOX: 'seatbelt' });
    expect(out).toContain('CODEX_MODE: under_codex');
  });

  test('GSTACK_FORCE_CODEX_REVIEW=1 overrides the presence probe', () => {
    const out = runPreflight({
      CODEX_THREAD_ID: '01a00ba9-ff91-7143-b424-c2d9b0cc89ff',
      CODEX_SANDBOX: 'seatbelt',
      GSTACK_FORCE_CODEX_REVIEW: '1',
    });
    expect(out).not.toContain('CODEX_MODE: under_codex');
    // With codex absent from the restricted PATH, the forced probe falls
    // through to the ordinary availability chain.
    expect(out).toContain('CODEX_MODE: not_installed');
  });

  test('no CODEX_* env -> ordinary availability chain', () => {
    const out = runPreflight({});
    expect(out).not.toContain('CODEX_MODE: under_codex');
    expect(out).toContain('CODEX_MODE: not_installed');
  });
});

describe('under-codex wiring renders (#2519)', () => {
  test('rendered adversarial section carries the probe + override + notice', () => {
    const rendered = fs.readFileSync(
      path.join(ROOT, 'ship', 'sections', 'adversarial.md'),
      'utf-8',
    );
    expect(rendered).toContain('CODEX_THREAD_ID');
    expect(rendered).toContain('GSTACK_FORCE_CODEX_REVIEW');
    expect(rendered).toContain('under_codex');
    expect(rendered).toContain('nested codex passes skipped');
  });

  test('rendered codex skill stops with the one-line notice when under codex', () => {
    const rendered = fs.readFileSync(path.join(ROOT, 'codex', 'SKILL.md'), 'utf-8');
    expect(rendered).toContain('UNDER_CODEX');
    expect(rendered).toContain('GSTACK_FORCE_CODEX_REVIEW=1');
  });

  test('the inline codexPreflight consumers render the probe', () => {
    // ship (diff adversarial) and document-release (doc review) still emit the
    // codexPreflight bash block inline, so the under_codex mode is rendered
    // verbatim in their sections.
    for (const file of [
      path.join(ROOT, 'ship', 'sections', 'adversarial.md'),
      path.join(ROOT, 'document-release', 'sections', 'release-body.md'),
    ]) {
      const rendered = fs.readFileSync(file, 'utf-8');
      expect(rendered).toContain('under_codex');
    }
  });

  test('the panel codex path carries the under-codex nested-self-invocation guard', () => {
    // The three plan-review surfaces (ceo/eng/devex) migrated from the inline
    // codexPreflight block to the outside-voices panel (#2519 guard moved with
    // them). REAL protection now lives in bin/gstack-panel: it must refuse to
    // spawn a nested `codex exec` when running inside a live Codex session
    // (CODEX_THREAD_ID / CODEX_SANDBOX present), honoring GSTACK_FORCE_CODEX_REVIEW=1.
    const panel = fs.readFileSync(path.join(ROOT, 'bin', 'gstack-panel'), 'utf-8');
    expect(panel).toContain('CODEX_THREAD_ID');
    expect(panel).toContain('CODEX_SANDBOX');
    expect(panel).toContain('GSTACK_FORCE_CODEX_REVIEW');
    expect(panel).toContain('under-codex');
    // The guard must gate the codex voice specifically, before the codex exec spawn.
    expect(panel).toContain('_panel_under_codex');
  });

  test('the plan-review sections reference the panel under-codex guard', () => {
    // The plan-review sections delegate the codex preflight to gstack-panel, but
    // still surface the guard so the orchestrator knows why the codex voice may
    // come back ABSENT(under-codex) and how to force it.
    for (const skill of ['plan-ceo-review', 'plan-eng-review', 'plan-devex-review']) {
      const rendered = fs.readFileSync(
        path.join(ROOT, skill, 'sections', 'review-sections.md'), 'utf-8');
      expect(rendered).toContain('under-codex');
      expect(rendered).toContain('GSTACK_FORCE_CODEX_REVIEW');
    }
  });
});
