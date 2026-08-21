/**
 * KEEP-IN-SYNC tripwire for the artifacts-sync preamble twins (#48 carve).
 *
 * bin/gstack-artifacts-preamble hand-mirrors the bash that
 * scripts/resolvers/preamble/generate-brain-sync-block.ts renders as skill
 * PROSE for non-Claude hosts. The Claude host runs the real binary instead
 * of executing the rendered prose, so the two files must stay behaviorally
 * identical on every security-sensitive construct — an injection guard fixed
 * in one and forgotten in the other reopens the hole on whichever host
 * didn't get the fix. There is no shared module either twin imports from
 * (that's the whole point of the carve: one host runs code, the other runs
 * agent-executed prose), so nothing else catches this drift.
 *
 * A failing test here means exactly one thing: someone updated one twin
 * (a guard, a sanitize chain, a branch ordering) without updating the other.
 * Fix by porting the change to the twin that's missing it — do not "fix"
 * this test by loosening a pinned string.
 *
 * Pattern mirrors test/hermetic-wiring.test.ts and
 * test/egress-receipt-wiring.test.ts: read source files as text, assert
 * invariants on their contents. Brittle by design — a drifting spelling must
 * force the author to look here.
 */

import { describe, test, expect } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(new URL(import.meta.url).pathname, '..', '..');

const BIN = 'bin/gstack-artifacts-preamble';
const TS = 'scripts/resolvers/preamble/generate-brain-sync-block.ts';

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), 'utf-8');
}

describe('artifacts-preamble sync tripwire', () => {
  test('both twins carry the arithmetic-injection guard on _BRAIN_LAST', () => {
    // $(( _BRAIN_NOW - _BRAIN_LAST )) evaluates its operands; _BRAIN_LAST
    // comes from a file inside the git-SYNCED ~/.gstack tree, so a
    // non-numeric value must be neutralized before it reaches arithmetic.
    const GUARD = `case "$_BRAIN_LAST" in ''|*[!0-9]*)`;
    for (const rel of [BIN, TS]) {
      expect(read(rel).includes(GUARD), `${rel}: missing numeric guard before the age arithmetic`).toBe(true);
    }
  });

  test('both twins sanitize the gbrain-mcp host to hostname-safe chars', () => {
    // _GBRAIN_HOST is derived from ~/.claude.json (often written by
    // third-party install snippets) and echoed into agent-consumed status
    // output; a crafted value could otherwise forge extra ARTIFACTS_SYNC lines.
    const SANITIZE = `tr -cd 'A-Za-z0-9._-'`;
    for (const rel of [BIN, TS]) {
      expect(read(rel).includes(SANITIZE), `${rel}: missing host sanitize before echoing _GBRAIN_HOST`).toBe(true);
    }
  });

  test('both twins run the identical last-push sanitize chain (head -1 | tr -cd | cut)', () => {
    // .brain-last-push lives in the git-SYNCED tree; first line only,
    // timestamp-safe charset, capped length before it's echoed.
    const CHAIN = `head -1 "$_GSTACK_HOME/.brain-last-push" 2>/dev/null | tr -cd 'A-Za-z0-9TZ:+.-' | cut -c1-40`;
    for (const rel of [BIN, TS]) {
      expect(read(rel).includes(CHAIN), `${rel}: last-push sanitize chain drifted from the pinned spelling`).toBe(
        true,
      );
    }
  });

  test('both twins carry the numeric guard on _BRAIN_QUEUE_DEPTH', () => {
    // wc -l should already be numeric, but the counted file also lives in
    // the git-SYNCED tree; enforce numeric before it's interpolated into
    // the agent-consumed status line.
    const GUARD = `case "$_BRAIN_QUEUE_DEPTH" in ''|*[!0-9]*) _BRAIN_QUEUE_DEPTH=0 ;; esac`;
    for (const rel of [BIN, TS]) {
      expect(read(rel).includes(GUARD), `${rel}: missing numeric guard before queue depth is echoed`).toBe(true);
    }
  });

  test('the last-pull stamp write sits after the fetch-success conditional in both twins', () => {
    // Only stamp the 24h cooldown once the fetch attempt has actually run —
    // stamping first would silence a genuinely failed fetch for a day. This
    // is a text-position check (brittle by design): the stamp line must
    // appear later in the file than the line that attempts the fetch.
    const bin = read(BIN);
    const binFetchIdx = bin.indexOf('_receipted_git closed brain-sync');
    const binStampIdx = bin.indexOf('echo "$_BRAIN_NOW" > "$_BRAIN_LAST_PULL_FILE"');
    expect(binFetchIdx, `${BIN}: fetch-success conditional marker not found`).toBeGreaterThan(-1);
    expect(binStampIdx, `${BIN}: last-pull stamp write not found`).toBeGreaterThan(-1);
    expect(binStampIdx, `${BIN}: stamp must be written after the fetch attempt, not before`).toBeGreaterThan(
      binFetchIdx,
    );

    const ts = read(TS);
    // Both twins now route the daily fetch through the same receipted marker
    // (#48 forum F4 gave the non-Claude generator host parity), so anchor on it
    // rather than the raw `git fetch origin` — that literal now only appears in
    // the egress-lib-absent fallback branch, which sits after the primary stamp.
    const tsFetchIdx = ts.indexOf('_receipted_git closed brain-sync');
    const tsStampIdx = ts.indexOf('echo "$_BRAIN_NOW" > "$_BRAIN_LAST_PULL_FILE"');
    expect(tsFetchIdx, `${TS}: fetch attempt marker not found`).toBeGreaterThan(-1);
    expect(tsStampIdx, `${TS}: last-pull stamp write not found`).toBeGreaterThan(-1);
    expect(tsStampIdx, `${TS}: stamp must be written after the fetch attempt, not before`).toBeGreaterThan(
      tsFetchIdx,
    );
  });

  test('the Claude-host script (bin twin) sources gstack-egress-lib.sh', () => {
    // Unlike the TS twin's rendered prose (agent-executed, exempt), this
    // script runs automatically as a real binary — a genuine sink that must
    // route through the receipt helpers.
    expect(
      read(BIN).includes('gstack-egress-lib.sh'),
      `${BIN}: must source bin/gstack-egress-lib.sh for _receipted_* helpers`,
    ).toBe(true);
  });

  test('the Claude-host script (bin twin) receipts its fetch under sink name curated-memory-git-fetch', () => {
    expect(
      read(BIN).includes('curated-memory-git-fetch'),
      `${BIN}: must receipt its daily fetch under sink name curated-memory-git-fetch`,
    ).toBe(true);
  });
});
