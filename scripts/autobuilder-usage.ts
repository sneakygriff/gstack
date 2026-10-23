#!/usr/bin/env bun
/** Offline usage evidence adapter. See docs/autobuilder-usage.md for the v1 input contract. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

type Fingerprints = Record<string, string> | null;
type Usage = { inputTokens: number | null; outputTokens: number | null;
  cacheCreationInputTokens: number | null; cacheReadInputTokens: number | null };
type Event = {
  runId: string; attemptId: string | null; eventId: string;
  kind: 'model' | 'helper'; phase: string; role: string; observation: 'observed' | 'estimated';
  provider: string | null; model: string | null; transport: string | null;
  sourceFingerprints: Fingerprints; instructionFingerprints: Fingerprints;
  evidence: { ref: string; sha256: string }[]; usage: Usage;
  recordScope: 'message' | 'aggregate' | 'operation' | 'unknown'; provenanceNote: string | null;
  durationMs: number | null; isRetry: boolean | null;
};
const metrics = ['inputTokens', 'outputTokens', 'cacheCreationInputTokens', 'cacheReadInputTokens'] as const;
class UsageError extends Error {}
function invalid(field: string): never { throw new UsageError(`invalid_input: ${field}`); }
function object(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(field);
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, allowed: string[], field: string) {
  if (Object.keys(value).some(k => !allowed.includes(k))) invalid(`${field}: unexpected field`);
}
function string(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 4096 || /[\x00-\x1f\x7f]/.test(value)) invalid(field);
  return value;
}
function nullableString(value: unknown, field: string): string | null {
  return value == null ? null : string(value, field);
}
function number(value: unknown, field: string): number | null {
  if (value == null) return null;
  if (!Number.isSafeInteger(value) || (value as number) < 0) invalid(field);
  return value as number;
}
function choice<T extends string>(value: unknown, options: readonly T[], field: string): T {
  if (!options.includes(value as T)) invalid(field);
  return value as T;
}
function digest(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) invalid(field);
  return value;
}
function fingerprints(value: unknown, field: string): Fingerprints {
  if (value == null) return null;
  const map = object(value, field);
  if (!Object.keys(map).length) invalid(field);
  return Object.fromEntries(Object.entries(map).map(([key, hash]) => [string(key, field), digest(hash, field)]));
}
function parseEvents(value: unknown): Event[] {
  const input = object(value, 'input');
  keys(input, ['schemaVersion', 'events'], 'input');
  if (input.schemaVersion !== 'autobuilder-usage-events/v1') invalid('schemaVersion');
  if (!Array.isArray(input.events)) invalid('events');
  return input.events.map((item, i) => {
    const field = `events[${i}]`;
    const row = object(item, field);
    keys(row, ['runId', 'attemptId', 'eventId', 'kind', 'phase', 'role', 'observation', 'provider', 'model',
      'transport', 'sourceFingerprints', 'instructionFingerprints', 'evidence', 'usage', 'durationMs', 'isRetry',
      'recordScope', 'provenanceNote'], field);
    const usage = row.usage == null ? {} : object(row.usage, `${field}.usage`);
    keys(usage, [...metrics], `${field}.usage`);
    const kind = choice(row.kind, ['model', 'helper'] as const, `${field}.kind`);
    const provider = nullableString(row.provider, `${field}.provider`);
    const model = nullableString(row.model, `${field}.model`);
    const normalizedUsage = Object.fromEntries(metrics.map(metric => [metric, number(usage[metric], `${field}.usage.${metric}`)])) as Usage;
    if (kind === 'model' && provider === null) invalid(`${field}.provider`);
    if (kind === 'helper' && (provider !== null || model !== null || metrics.some(m => normalizedUsage[m] !== null))) invalid(`${field}: helper cannot carry model usage`);
    if (!Array.isArray(row.evidence) || !row.evidence.length) invalid(`${field}.evidence`);
    const evidence = row.evidence.map((item, n) => {
      const ref = object(item, `${field}.evidence[${n}]`);
      keys(ref, ['ref', 'sha256'], `${field}.evidence[${n}]`);
      return { ref: string(ref.ref, `${field}.evidence[${n}].ref`), sha256: digest(ref.sha256, `${field}.evidence[${n}].sha256`) };
    });
    if (row.isRetry != null && typeof row.isRetry !== 'boolean') invalid(`${field}.isRetry`);
    if (row.attemptId == null && (row.durationMs != null || row.isRetry != null)) invalid(`${field}: attempt metrics require identity`);
    return {
      runId: string(row.runId, `${field}.runId`), attemptId: nullableString(row.attemptId, `${field}.attemptId`),
      eventId: string(row.eventId, `${field}.eventId`), kind,
      phase: string(row.phase, `${field}.phase`), role: string(row.role, `${field}.role`),
      observation: choice(row.observation, ['observed', 'estimated'] as const, `${field}.observation`),
      provider, model, transport: nullableString(row.transport, `${field}.transport`),
      sourceFingerprints: fingerprints(row.sourceFingerprints, `${field}.sourceFingerprints`),
      instructionFingerprints: fingerprints(row.instructionFingerprints, `${field}.instructionFingerprints`),
      evidence, usage: normalizedUsage, durationMs: number(row.durationMs, `${field}.durationMs`),
      isRetry: row.isRetry == null ? null : row.isRetry as boolean,
      recordScope: choice(row.recordScope ?? 'unknown', ['message', 'aggregate', 'operation', 'unknown'] as const, `${field}.recordScope`),
      provenanceNote: nullableString(row.provenanceNote, `${field}.provenanceNote`),
    };
  });
}
function summarize(values: (number | null)[]) {
  const available = values.filter((v): v is number => v !== null);
  const knownSubtotal = available.length ? available.reduce((a, b) => a + b, 0) : null;
  if (knownSubtotal !== null && !Number.isSafeInteger(knownSubtotal)) throw new UsageError('metric_overflow');
  return { total: available.length === values.length ? knownSubtotal : null,
    knownSubtotal, known: available.length, unknown: values.length - available.length };
}
function stable(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + stable((value as Record<string, unknown>)[key])).join(',') + '}';
}
function report(incoming: Event[], input: { path: string; sha256: string }) {
  const unique = new Map<string, Event>();
  const attemptMetadata = new Map<string, string>();
  let duplicateEvents = 0;
  for (const event of incoming) {
    const { eventId, evidence, usage, sourceFingerprints, instructionFingerprints, provenanceNote, recordScope, ...attempt } = event;
    const attemptKey = JSON.stringify([event.runId, event.attemptId]);
    if (event.attemptId !== null) {
      const priorAttempt = attemptMetadata.get(attemptKey);
      if (priorAttempt && priorAttempt !== stable(attempt)) throw new UsageError('conflicting_attempt');
      attemptMetadata.set(attemptKey, stable(attempt));
    }
    const key = JSON.stringify([event.runId, event.provider, event.kind, event.eventId]);
    const prior = unique.get(key);
    if (prior) {
      const { evidence: priorEvidence, ...priorPayload } = prior;
      const { evidence: _, ...payload } = event;
      if (stable(priorPayload) !== stable(payload)) throw new UsageError('conflicting_event');
      prior.evidence = [...new Map([...priorEvidence, ...evidence].map(ref => [stable(ref), ref])).values()];
      duplicateEvents++;
    } else unique.set(key, { ...event, evidence: [...evidence] });
  }
  const events = [...unique.values()];
  // Aggregates cannot be reconciled with constituent messages without a coverage manifest.
  const scopes = new Map<string, boolean>();
  for (const event of events) {
    const scope = JSON.stringify([event.runId, event.provider, event.kind, event.observation]);
    if (scopes.has(scope) && (event.recordScope === 'aggregate' || scopes.get(scope))) throw new UsageError('overlapping_aggregate');
    scopes.set(scope, event.recordScope === 'aggregate');
  }
  const groups = new Map<string, Event[]>();
  for (const event of events) {
    const key = JSON.stringify([event.phase, event.role, event.kind, event.observation]);
    const rows = groups.get(key);
    if (rows) rows.push(event);
    else groups.set(key, [event]);
  }
  return { schemaVersion: 'autobuilder-usage-report/v1', input,
    duplicateEvents, invoiceCharges: null, wallTimeMs: null,
    attribution: 'Input digest computed locally. Event provenance, observations and consumed fingerprints are caller-attributed, not independently verified.',
    durationMeaning: 'Sum of available attempt durations; overlapping attempts are not wall time.',
    events, groups: [...groups.values()].map(rows => {
      const { phase, role, kind, observation } = rows[0];
      const attempts = [...new Map(rows.filter(e => e.attemptId !== null).map(e => [JSON.stringify([e.runId, e.attemptId]), e])).values()];
      const unknownAttempts = rows.filter(e => e.attemptId === null);
      const attemptEvidence = [...attempts, ...unknownAttempts];
      return { phase, role, kind, observation, events: rows.length,
        attempts: unknownAttempts.length ? null : attempts.length, knownAttempts: attempts.length, unknownAttemptRecords: unknownAttempts.length,
        ...Object.fromEntries(metrics.map(metric => [metric, summarize(rows.map(e => e.usage[metric]))])),
        attemptDurationMs: summarize(attemptEvidence.map(e => e.durationMs)),
        retryAttempts: summarize(attemptEvidence.map(e => e.isRetry === null ? null : Number(e.isRetry))) };
    }) };
}
function main() {
  if (process.argv.length !== 3) throw new UsageError('usage: bun scripts/autobuilder-usage.ts <normalized-events.json>');
  const inputPath = path.resolve(process.argv[2]);
  let raw: Buffer;
  try { raw = fs.readFileSync(inputPath); } catch { throw new UsageError('cannot_read_input'); }
  let input: unknown;
  try { input = JSON.parse(raw.toString('utf8')); } catch { throw new UsageError('invalid_json'); }
  const events = parseEvents(input);
  console.log(JSON.stringify(report(events, { path: inputPath, sha256: createHash('sha256').update(raw).digest('hex') }), null, 2));
}
if (import.meta.main) {
  try { main(); } catch (error) {
    console.error(`autobuilder-usage: ${error instanceof UsageError ? error.message : 'report_failed'}`);
    process.exitCode = 2;
  }
}
