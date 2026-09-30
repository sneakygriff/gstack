/**
 * Fork (sneakygriff/gstack): the outside-voices advisory panel is LAYERED on
 * top of upstream's harness-routed Outside Voice since the v1.91.9.0 port.
 * Upstream renders its reviewer first; the panel follows and skips the voice
 * the primary step already ran. These pins live in a fork-owned file so
 * upstream's own tests stay byte-identical across ports.
 */
import { describe, test, expect } from 'bun:test';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { generateOutsideVoices } from '../scripts/resolvers/outside-voices';
import type { TemplateContext } from '../scripts/resolvers/types';

const ROOT = path.resolve(import.meta.dir, '..');
const PANEL = path.join(ROOT, 'bin', 'gstack-panel');
const PANEL_HEADING = 'Outside Voices — Advisory Panel';
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf-8');

function runPanel(args: string[]) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gstack-ov-layer-'));
  const home = path.join(dir, 'home');
  const out = path.join(dir, 'out');
  fs.mkdirSync(home);
  fs.mkdirSync(out);
  fs.writeFileSync(path.join(dir, 'prompt.txt'), 'Review this.\n');
  fs.writeFileSync(path.join(dir, 'untrusted.txt'), 'plan body\n');
  const r = spawnSync('bash', [PANEL, '--surface', 'plan-eng',
    '--prompt-file', path.join(dir, 'prompt.txt'), '--untrusted-file', path.join(dir, 'untrusted.txt'),
    '--datamark', 'abc123', '--out-dir', out, '--wall-clock-s', '30', ...args], {
    encoding: 'utf-8', timeout: 60_000,
    env: { ...process.env, GSTACK_HOME: home, GSTACK_STATE_DIR: home },
  });
  return { r, dir, home, out };
}

describe('gstack-panel --skip-voices', () => {
  test('skipped voices are recorded ABSENT(covered-by-primary) and never reach a receipt or spawn', () => {
    const { r, dir, home, out } = runPanel(['--skip-voices', 'codex,grok,gemini']);
    try {
      expect(r.status).toBe(0);
      for (const voice of ['codex', 'grok', 'gemini']) {
        const res = JSON.parse(fs.readFileSync(path.join(out, `${voice}.result.json`), 'utf-8'));
        expect(res.status).toBe('absent');
        expect(res.reason).toContain('covered-by-primary');
      }
      expect(r.stdout).toContain('external spend estimate $0');
      // No egress receipt was written: the skip gate runs before the receipt.
      const receipts = fs.readdirSync(home, { recursive: true }).map(String).filter((p) => /receipt/i.test(p));
      expect(receipts).toEqual([]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);

  test('an unknown voice name is a usage error, never a silent no-op', () => {
    const { r, dir } = runPanel(['--skip-voices', 'codx']);
    try {
      expect(r.status).toBe(2);
      expect(r.stderr).toContain("unknown voice 'codx'");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);

  test('the skip gate is the first gate in the voice loop', () => {
    const src = fs.readFileSync(PANEL, 'utf-8');
    const loop = src.indexOf('for voice in $CLI_VOICES; do\n    # (0) layered mode');
    expect(loop).toBeGreaterThan(-1);
    expect(src.indexOf('covered-by-primary', loop)).toBeLessThan(src.indexOf('wall-clock budget', loop));
  });
});

describe('panel renders AFTER the upstream Outside Voice', () => {
  for (const skill of ['plan-ceo-review', 'plan-eng-review', 'plan-devex-review']) {
    test(`${skill}: upstream outside voice first, then the panel with --skip-voices codex`, () => {
      const md = read(`${skill}/sections/review-sections.md`);
      const upstream = md.indexOf('"skill":"codex-plan-review"');
      const panel = md.indexOf(PANEL_HEADING);
      expect(upstream).toBeGreaterThan(-1);
      expect(panel).toBeGreaterThan(upstream);
      expect(md.slice(panel)).toContain('--skip-voices codex');
    });
  }

  for (const file of ['review/sections/adversarial.md', 'ship/sections/adversarial.md']) {
    test(`${file}: upstream adversarial step kept, panel appended`, () => {
      const md = read(file);
      const panel = md.indexOf(PANEL_HEADING);
      expect(panel).toBeGreaterThan(0);
      expect(md.slice(0, panel)).toContain('under_codex'); // upstream's codex preflight survives
      expect(md.slice(panel)).toContain('--skip-voices codex');
    });
  }

  test('design-review runs the panel automatically; plan-design-review keeps its opt-in gate', () => {
    const auto = read('design-review/SKILL.md');
    expect(auto).toContain(PANEL_HEADING);
    expect(auto).not.toContain('Opt-in gate (this review only)');
    const optIn = read('plan-design-review/SKILL.md');
    expect(optIn).toContain('Opt-in gate (this review only)');
    expect(optIn).not.toContain('Running the outside-voices panel automatically');
  });

  test('design-consultation gets no panel (creative-direction flow, not a review)', () => {
    expect(read('design-consultation/SKILL.md')).not.toContain(PANEL_HEADING);
  });

  test('codex host: the full recipe strips (a Codex session never runs the panel inline)', () => {
    const ctx = { host: 'codex', skillName: 'plan-eng-review', paths: { binDir: '~/.codex/skills/gstack/bin' } } as unknown as TemplateContext;
    expect(generateOutsideVoices(ctx, ['surface=eng'])).toBe('');
  });
});

describe('fork skill routes', () => {
  test('/plan-eng-review offers /plan-deliverables before implementation', () => {
    expect(read('plan-eng-review/sections/review-sections.md')).toContain('Run /plan-deliverables');
  });

  test('/office-hours hands off to /plan-deliverables', () => {
    expect(read('office-hours/sections/design-and-handoff.md')).toContain('/plan-deliverables');
  });

  test('the root router routes both fork skills', () => {
    const root = read('SKILL.md');
    expect(root).toContain('invoke `/plan-deliverables`');
    expect(root).toContain('invoke `/autobuilder-loop`');
  });
});
