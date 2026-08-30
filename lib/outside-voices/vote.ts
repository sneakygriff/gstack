/**
 * Outside Voices — `tallyVoices()`, the advisory aggregation layer.
 *
 * Co-located with `registry.ts` per OV-13 (NOT `lib/gstack-decision.ts`, the
 * append-only institutional-memory store + fork merge-risk surface).
 *
 * DESIGN CONTRACT: docs/designs/OUTSIDE_VOICES_PANEL.md §5 (`tallyVoices()` —
 * fully specified advisory aggregation) and §3 (verdict schema this function
 * consumes). This module implements §5 EXACTLY:
 *   - ordinal scale PASS=0 / CONCERNS=1 / BLOCK=2 (imported from `registry.ts`
 *     so the scale has one source),
 *   - vendor-collapsed median (per-vendor median first, so the correlated
 *     Anthropic pair — native `claude` + `fable` — cannot double-weight the
 *     recommendation),
 *   - the SAME even-count tiebreak at both the per-vendor step and the
 *     cross-vendor step: equal middles → that value, differing middles →
 *     CONCERNS (a genuine split reads as "look closer," never PASS or BLOCK),
 *   - numeric quorum `readyVoices >= 2`,
 *   - four ORDERED degradation guards, evaluated top-to-bottom so exactly one
 *     fires per absence pattern: NO_VOICES / INSUFFICIENT_QUORUM /
 *     SINGLE_VENDOR_ANTHROPIC / OK,
 *   - `[claude-voice-errored]` when native Claude specifically errored/absent
 *     but >=1 external voice is ready,
 *   - non-Anthropic dissent surfacing whenever a ready non-anthropic voice's
 *     verdict differs from the final recommendation,
 *   - ran-but-unparseable (`status:'error'`) NEVER counts as `absent` and
 *     NEVER casts an ordinal — it is excluded from the tally exactly like
 *     `absent`, but is surfaced loudly in `perVoice` with its real status.
 *
 * This is advisory: `recommendation` is a display value for the existing
 * human gate / fix-first pipeline. It sets nothing, and `tallyVoices()` is
 * pure — no fs/network/process access.
 */

import {
  VERDICT_ORDINAL,
  ORDINAL_VERDICT,
  VENDORS,
  type ResultVoice,
  type Vendor,
  type Verdict,
  type VoiceStatus,
  type VoiceResult,
} from './registry';

// ─────────────────────────────────────────────────────────────────────────────
// Output shape (§5)
// ─────────────────────────────────────────────────────────────────────────────

/** The four ordered degradation statuses (§5). Exactly one fires per tally. */
export type TallyStatus = 'OK' | 'SINGLE_VENDOR_ANTHROPIC' | 'INSUFFICIENT_QUORUM' | 'NO_VOICES';

/** One input voice's result, flattened for display — ordinal is null unless `status:'ready'`. */
export interface PerVoiceEntry {
  voice: ResultVoice;
  vendor: Vendor;
  status: VoiceStatus;
  verdict: Verdict | null;
  ordinal: number | null;
}

/** One vendor's collapsed ordinal — the median of that vendor's ready voices (§5 step 3). */
export interface PerVendorEntry {
  vendor: Vendor;
  /** The ready voices this vendor collapsed (native `claude` + `fable` both land under `anthropic`). */
  readyVoices: ResultVoice[];
  ordinal: number;
  verdict: Verdict;
}

/**
 * A genuine split where the even-count tiebreak resolved two DIFFERING middle
 * ordinals to CONCERNS — at the per-vendor step (`level:'vendor'`, e.g. fable
 * PASS vs claude BLOCK collapsing the anthropic vendor to CONCERNS) or at the
 * final cross-vendor step (`level:'panel'`, e.g. `[PASS, BLOCK]` across two
 * vendors). Equal middles never produce a tension (no genuine disagreement).
 */
export interface Tension {
  level: 'vendor' | 'panel';
  vendor?: Vendor;
  /** The two differing middle ordinals that triggered the tiebreak, sorted ascending. */
  ordinals: [number, number];
  note: string;
}

/**
 * A ready, non-Anthropic voice whose verdict differs from the final
 * recommendation (OV-6: "surface that non-Anthropic dissent prominently").
 * Correlated Anthropic agreement (claude + fable) is never treated as extra
 * confirmation, so dissent surfacing is scoped to non-anthropic voices only.
 */
export interface Dissent {
  voice: ResultVoice;
  vendor: Vendor;
  verdict: Verdict;
  note: string;
}

export interface TallyResult {
  /** null exactly when status is NO_VOICES or INSUFFICIENT_QUORUM (no recommendation is emitted). */
  recommendation: Verdict | null;
  status: TallyStatus;
  quorum: { readyVoices: number; readyVendors: number };
  perVoice: PerVoiceEntry[];
  perVendor: PerVendorEntry[];
  tensions: Tension[];
  dissents: Dissent[];
  /** Orthogonal string annotations, e.g. `'claude-voice-errored'`, `'single-vendor-anthropic'`. */
  diversityFlags: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Vendor-collapsed median (§5) — the same tiebreak at both the per-vendor and
// cross-vendor steps
// ─────────────────────────────────────────────────────────────────────────────

interface MedianResult {
  ordinal: number;
  /** True when an even-count tiebreak was invoked on DIFFERING middles. */
  tension: boolean;
  /** The two differing middle ordinals, sorted ascending; null unless `tension`. */
  mid: [number, number] | null;
}

/**
 * Median of a non-empty ordinal list. Odd count → the middle element. Even
 * count → the two middle elements: equal → that value; differ → CONCERNS (the
 * even-split tiebreak, §5 step 4) — this is a genuine disagreement, never
 * resolved toward either extreme.
 */
function medianOrdinal(ordinals: number[]): MedianResult {
  if (ordinals.length === 0) {
    throw new Error('medianOrdinal: empty ordinal list (caller must guarantee >=1 ready voice)');
  }
  const sorted = [...ordinals].sort((a, b) => a - b);
  const n = sorted.length;
  if (n % 2 === 1) {
    return { ordinal: sorted[(n - 1) / 2], tension: false, mid: null };
  }
  const lo = sorted[n / 2 - 1];
  const hi = sorted[n / 2];
  if (lo === hi) {
    return { ordinal: lo, tension: false, mid: null };
  }
  // Differing middles → CONCERNS, never PASS or BLOCK.
  return { ordinal: VERDICT_ORDINAL.CONCERNS, tension: true, mid: [lo, hi] };
}

// ─────────────────────────────────────────────────────────────────────────────
// tallyVoices()
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tally a set of voice results into an advisory recommendation. Pure function;
 * never mutates its input. See module doc + design §5 for the full spec.
 */
export function tallyVoices(results: VoiceResult[]): TallyResult {
  const perVoice: PerVoiceEntry[] = results.map((r) => ({
    voice: r.voice,
    vendor: r.vendor,
    status: r.status,
    verdict: r.verdict,
    ordinal: r.status === 'ready' && r.verdict !== null ? VERDICT_ORDINAL[r.verdict] : null,
  }));

  // Only `status: 'ready'` voices with a verdict cast an ordinal. `absent` AND
  // `error` (ran-but-unparseable) both cast none — but `error` still appears
  // in `perVoice` with its real status, never silently folded into `absent`.
  const readyResults = results.filter((r) => r.status === 'ready' && r.verdict !== null);
  const readyVoices = readyResults.length;

  // Group ready voices by vendor (native `claude` + `fable` both collapse
  // under `anthropic`) and reduce each vendor to one ordinal via the median.
  const byVendor = new Map<Vendor, VoiceResult[]>();
  for (const r of readyResults) {
    const list = byVendor.get(r.vendor);
    if (list) list.push(r);
    else byVendor.set(r.vendor, [r]);
  }

  const tensions: Tension[] = [];
  const perVendor: PerVendorEntry[] = [];
  for (const [vendor, voices] of byVendor.entries()) {
    const ordinals = voices.map((v) => VERDICT_ORDINAL[v.verdict as Verdict]);
    const { ordinal, tension, mid } = medianOrdinal(ordinals);
    if (tension && mid) {
      tensions.push({
        level: 'vendor',
        vendor,
        ordinals: mid,
        note: `${vendor} voices split ${ORDINAL_VERDICT[mid[0]]}/${ORDINAL_VERDICT[mid[1]]} → collapsed to CONCERNS`,
      });
    }
    perVendor.push({
      vendor,
      readyVoices: voices.map((v) => v.voice),
      ordinal,
      verdict: ORDINAL_VERDICT[ordinal],
    });
  }
  // Deterministic display order (does not affect the median, which is symmetric).
  perVendor.sort((a, b) => VENDORS.indexOf(a.vendor) - VENDORS.indexOf(b.vendor));

  const readyVendors = perVendor.length;
  const quorum = { readyVoices, readyVendors };

  // ── Ordered degradation guards (§5) — top to bottom, first match wins, so
  //    each absence pattern hits exactly one rule. ──

  // 1. readyVoices == 0 → NO_VOICES. Never a block, never an auto-pass.
  if (readyVoices === 0) {
    return {
      recommendation: null,
      status: 'NO_VOICES',
      quorum,
      perVoice,
      perVendor,
      tensions,
      dissents: [],
      diversityFlags: [],
    };
  }

  // 2. readyVoices == 1 → INSUFFICIENT_QUORUM. Present as informational only.
  if (readyVoices === 1) {
    return {
      recommendation: null,
      status: 'INSUFFICIENT_QUORUM',
      quorum,
      perVoice,
      perVendor,
      tensions,
      dissents: [],
      diversityFlags: [],
    };
  }

  // readyVoices >= 2 from here — always emit a recommendation.
  const vendorOrdinals = perVendor.map((v) => v.ordinal);
  const { ordinal: recOrdinal, tension: recTension, mid: recMid } = medianOrdinal(vendorOrdinals);
  if (recTension && recMid) {
    tensions.push({
      level: 'panel',
      ordinals: recMid,
      note: `cross-vendor split ${ORDINAL_VERDICT[recMid[0]]}/${ORDINAL_VERDICT[recMid[1]]} → CONCERNS (surfaced, not resolved toward either extreme)`,
    });
  }
  const recommendation = ORDINAL_VERDICT[recOrdinal];

  // ── Orthogonal annotations (layered on any emitting path) ──
  const diversityFlags: string[] = [];

  // [claude-voice-errored]: native Claude specifically errored/absent, but
  // >=1 EXTERNAL voice is ready — native Claude's absence never halts the tally.
  const claudeResult = results.find((r) => r.voice === 'claude');
  const hasReadyExternalVoice = readyResults.some((r) => r.vendor !== 'anthropic');
  if (claudeResult && claudeResult.status !== 'ready' && hasReadyExternalVoice) {
    diversityFlags.push('claude-voice-errored');
  }

  // Dissent surfacing: a ready NON-Anthropic voice whose verdict differs from
  // the final recommendation. Correlated Anthropic agreement (claude+fable)
  // is never treated as extra confirmation, so this scope is deliberate.
  const dissents: Dissent[] = [];
  for (const r of readyResults) {
    if (r.vendor === 'anthropic') continue;
    const ord = VERDICT_ORDINAL[r.verdict as Verdict];
    if (ord !== recOrdinal) {
      dissents.push({
        voice: r.voice,
        vendor: r.vendor,
        verdict: r.verdict as Verdict,
        note: `${r.voice} (${r.vendor}) dissents: ${r.verdict} vs recommendation ${recommendation}`,
      });
    }
  }

  // 3. readyVoices >= 2 && readyVendors == 1 → SINGLE_VENDOR_ANTHROPIC (only
  //    possible when the single ready vendor is anthropic — claude/fable are
  //    the only voices sharing a vendor in the fixed 5-voice roster).
  if (readyVendors === 1) {
    diversityFlags.push('single-vendor-anthropic');
    return {
      recommendation,
      status: 'SINGLE_VENDOR_ANTHROPIC',
      quorum,
      perVoice,
      perVendor,
      tensions,
      dissents,
      diversityFlags,
    };
  }

  // 4. readyVoices >= 2 && readyVendors >= 2 → OK.
  return {
    recommendation,
    status: 'OK',
    quorum,
    perVoice,
    perVendor,
    tensions,
    dissents,
    diversityFlags,
  };
}
