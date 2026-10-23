/**
 * autobuilder-loop's adversarial forum vs the Outside Voices panel — pin the
 * DISTINCTION between the two mechanisms (M3 of the outside-voices-panel
 * autobuilder run, task T5; see docs/designs/OUTSIDE_VOICES_PANEL.md
 * Non-Goals: "autobuilder-loop's union-FAIL forum is preserved unchanged").
 *
 * The panel (lib/outside-voices/vote.ts `tallyVoices()`, invoked via
 * `bin/gstack-vote`) is an ADVISORY N-voice consensus mechanism — it
 * produces a recommendation, not a hard PASS/FAIL gate on its own.
 *
 * autobuilder-loop's per-milestone two-seat forum (v1.8: Seat C Claude + Seat X
 * Codex Astra; formerly Codex+Grok) is a STRICTER,
 * deliberately different mechanism: a UNION-FAIL gate where a single `[P1]`
 * from EITHER model fails the whole gate. M3 explicitly does NOT swap this
 * for the panel's advisory tally. This file pins both halves of that
 * divergence directly against the current autobuilder-loop source: the
 * union-FAIL literals still exist verbatim, and no file under
 * autobuilder-loop/ imports/references the panel's tally mechanism.
 */
import { describe, test, expect } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(import.meta.dir, '..');

const TMPL_PATH = path.join(ROOT, 'autobuilder-loop', 'SKILL.md.tmpl');
const GENERATED_PATH = path.join(ROOT, 'autobuilder-loop', 'SKILL.md');

const sectionDir = path.join(ROOT, 'autobuilder-loop', 'sections');
const sectionText = (suffix: string) => fs.readdirSync(sectionDir).filter(f => f.endsWith(suffix)).sort().map(f => fs.readFileSync(path.join(sectionDir, f), 'utf8')).join('\n');
const AUTOBUILDER_TMPL = fs.readFileSync(TMPL_PATH, 'utf-8') + sectionText('.md.tmpl');
const AUTOBUILDER_GENERATED = fs.readFileSync(GENERATED_PATH, 'utf-8') + sectionText('.md');

describe('autobuilder-loop forum vs outside-voices panel — divergence pin (M3 T5)', () => {
  describe('union-FAIL literals are present verbatim, in both composed template and generated sources', () => {
    // "a kept [P1] from EITHER model FAILs the gate" — the cross-model gate rule
    // stated where the forum step is introduced. v1.8 round-1 ruling R3: the
    // gate verdict counts KEPT (post-consolidation) P1s, so the literal says "kept".
    test('cross-model gate statement: a kept [P1] from EITHER model FAILs the gate', () => {
      const fragment = 'a kept `[P1]` from EITHER model FAILs the gate';
      expect(AUTOBUILDER_TMPL).toContain(fragment);
      expect(AUTOBUILDER_GENERATED).toContain(fragment);
    });

    // "The station's verdict is the UNION of both members: it FAILs if
    // EITHER reports a [P1]." — the Quick-reference restatement of the same
    // rule (SKILL.md.tmpl:641 as of this writing).
    // v1.8 ruling R3: the [P1] must survive consolidation to fail the station.
    test('station verdict is explicitly the UNION of both members, failing if EITHER reports a kept [P1]', () => {
      const fragment =
        "The station's verdict is the UNION of both members: it FAILs if EITHER reports a `[P1]` that consolidation keeps.";
      expect(AUTOBUILDER_TMPL).toContain(fragment);
      expect(AUTOBUILDER_GENERATED).toContain(fragment);
    });

    // "FAIL on any [P1]/P0 from EITHER model, ..." — the fail-closed gate
    // verdict spelled out a third time near the forum's full recipe
    // (SKILL.md.tmpl:809 as of this writing).
    test('gate-verdict rule: FAIL on any [P1]/P0 from EITHER model', () => {
      const fragment = 'FAIL on any `[P1]`/P0 from EITHER model';
      expect(AUTOBUILDER_TMPL).toContain(fragment);
      expect(AUTOBUILDER_GENERATED).toContain(fragment);
    });

    // Sanity: all three fragments above must actually be distinct
    // occurrences (not one fragment being a substring of another), so this
    // test suite is pinning three separate statements of the rule, not the
    // same string three times.
    test('the three union-FAIL statements are textually distinct fragments', () => {
      const a = 'a kept `[P1]` from EITHER model FAILs the gate';
      const b = "The station's verdict is the UNION of both members: it FAILs if EITHER reports a `[P1]` that consolidation keeps.";
      const c = 'FAIL on any `[P1]`/P0 from EITHER model';
      expect(a).not.toBe(b);
      expect(a).not.toBe(c);
      expect(b).not.toBe(c);
      expect(a.includes(b)).toBe(false);
      expect(b.includes(a)).toBe(false);
      expect(a.includes(c)).toBe(false);
      expect(c.includes(a)).toBe(false);
      expect(b.includes(c)).toBe(false);
      expect(c.includes(b)).toBe(false);
    });
  });

  describe('the panel\'s tally mechanism is NOT used by the autobuilder gate', () => {
    // lib/outside-voices/vote.ts exports tallyVoices(); bin/gstack-vote is
    // documented as "the ONLY tabulation path for the Outside Voices panel"
    // and imports tallyVoices() from that module. autobuilder-loop's forum
    // must reference neither — its UNION-FAIL verdict is computed inline by
    // the forum recipe itself (see the pins above), never delegated to the
    // panel's advisory tally.
    test('neither the .tmpl source nor the generated SKILL.md references tallyVoices', () => {
      expect(AUTOBUILDER_TMPL).not.toContain('tallyVoices');
      expect(AUTOBUILDER_GENERATED).not.toContain('tallyVoices');
    });

    test('neither the .tmpl source nor the generated SKILL.md references gstack-vote', () => {
      expect(AUTOBUILDER_TMPL).not.toContain('gstack-vote');
      expect(AUTOBUILDER_GENERATED).not.toContain('gstack-vote');
    });

    // The forum's prose also never invokes the panel/outside-voices
    // vocabulary by name — the two mechanisms are not merely undelegated
    // in code, the forum's own text never frames itself as (or defers to)
    // the advisory panel.
    test('neither file frames the forum as, or defers to, the Outside Voices panel', () => {
      for (const needle of ['OUTSIDE_VOICES', 'outside-voices', 'outside voices panel']) {
        expect(AUTOBUILDER_TMPL.toLowerCase()).not.toContain(needle.toLowerCase());
        expect(AUTOBUILDER_GENERATED.toLowerCase()).not.toContain(needle.toLowerCase());
      }
    });

    // v1.8.0 (retro-2026-10-19 item 7) adds the reference unit workflow
    // autobuilder-unit.js as the third file. This pin still fails loudly
    // (rather than silently under-covering) if a future edit adds a fourth
    // file under autobuilder-loop/ that this test doesn't also scan.
    test('all autobuilder entrypoints and sections are included in the policy scan', () => {
      const dir = path.join(ROOT, 'autobuilder-loop');
      const entries = fs.readdirSync(dir).filter((f) => !f.startsWith('.'));
      expect(entries.sort()).toEqual(['SKILL.md', 'SKILL.md.tmpl', 'autobuilder-unit.js', 'sections']);
      const manifest = JSON.parse(fs.readFileSync(path.join(sectionDir, 'manifest.json'), 'utf8'));
      const covered = ['manifest.json', 'preservation.json', ...manifest.sections.flatMap((entry: { file: string }) => [entry.file, `${entry.file}.tmpl`])];
      expect(fs.readdirSync(sectionDir).filter(f => !f.startsWith('.')).sort()).toEqual(covered.sort());
    });

    // The unit workflow computes the gate verdict in code, so it gets the same
    // scan: it must never delegate to the panel's advisory tally.
    test('autobuilder-unit.js never references tallyVoices, gstack-vote or the Outside Voices panel', () => {
      const unit = fs.readFileSync(path.join(ROOT, 'autobuilder-loop', 'autobuilder-unit.js'), 'utf-8');
      for (const needle of ['tallyVoices', 'gstack-vote', 'OUTSIDE_VOICES', 'outside-voices', 'outside voices panel']) {
        expect(unit.toLowerCase()).not.toContain(needle.toLowerCase());
      }
    });
  });
});
