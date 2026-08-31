/**
 * Deprecated codex web-search flag tripwire (#2525).
 *
 * codex >=0.144 deprecates `--enable web_search_cached` (its `--enable
 * <FEATURE>` surface now means `-c features.<name>=true`); the replacement
 * is `-c 'web_search="cached"'`, owned by ONE constant:
 * CODEX_WEB_SEARCH_FLAG in scripts/resolvers/constants.ts. Resolvers
 * interpolate it; templates reference {{CODEX_WEB_SEARCH_FLAG}}.
 *
 * These tests fail CI if the deprecated spelling re-enters any source
 * (resolver, template, helper) or any rendered SKILL.md / section / golden.
 */
import { describe, test, expect } from 'bun:test';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { CODEX_WEB_SEARCH_FLAG } from '../scripts/resolvers/constants';

const ROOT = path.join(import.meta.dir, '..');
const DEPRECATED = '--enable web_search_cached';

function grepRepo(pattern: string, includes: string[]): string[] {
  const includeArgs = includes.map((i) => `--include='${i}'`).join(' ');
  const out = execSync(
    `grep -rln ${includeArgs} -e '${pattern}' "${ROOT}" || true`,
    { encoding: 'utf-8' },
  );
  return out
    .split('\n')
    .filter(Boolean)
    .filter((f) => !f.includes('node_modules'))
    // The workspace-local .claude/ install is not generated output and can
    // carry dangling symlinks from unrelated sessions.
    .filter((f) => !f.includes('/.claude/'))
    .filter((f) => !f.endsWith('test/codex-web-search-flag.test.ts'));
}

describe('deprecated codex web-search flag is gone (#2525)', () => {
  test('the replacement flag has exactly the documented shape', () => {
    expect(CODEX_WEB_SEARCH_FLAG).toBe(`-c 'web_search="cached"'`);
  });

  test('no rendered SKILL.md or section carries the deprecated flag', () => {
    const hits = grepRepo(DEPRECATED, ['SKILL.md', '*.md']);
    expect(hits).toEqual([]);
  });

  test('no source file (resolver, template, helper) carries the deprecated flag', () => {
    const hits = grepRepo(DEPRECATED, ['*.ts', '*.tmpl']);
    expect(hits).toEqual([]);
  });

  test('rendered codex skill actually resolves the token to the live flag', () => {
    const rendered = fs.readFileSync(path.join(ROOT, 'codex', 'SKILL.md'), 'utf-8');
    expect(rendered).toContain(CODEX_WEB_SEARCH_FLAG);
    expect(rendered).not.toContain('{{CODEX_WEB_SEARCH_FLAG}}');
  });

  test('rendered autoplan skill no longer carries the inline codex flag (M2: codex now routes through the outside-voices panel)', () => {
    // Pre-M2, autoplan hardcoded 4 inline `codex exec` blocks (one per phase),
    // each interpolating {{CODEX_WEB_SEARCH_FLAG}} directly — hence the old
    // ">= 4 sites" assertion here. M2 replaced all 4 with
    // {{OUTSIDE_VOICES:variant=invoke:surface=...}} placeholders (plus one
    // {{OUTSIDE_VOICES:variant=procedure}} emitted once); the codex CLI
    // invocation — and its web-search flag — now lives entirely inside
    // bin/gstack-panel, which the resolver's procedure text documents by name
    // rather than inlining the raw `codex exec` argv. So autoplan itself no
    // longer carries the flag at all.
    const rendered = fs.readFileSync(path.join(ROOT, 'autoplan', 'SKILL.md'), 'utf-8');
    const count = rendered.split(CODEX_WEB_SEARCH_FLAG).length - 1;
    expect(count).toBe(0);
    expect(rendered).not.toContain('{{CODEX_WEB_SEARCH_FLAG}}');
  });
});
