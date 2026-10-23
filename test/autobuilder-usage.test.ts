import { test, expect } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const script = path.resolve(import.meta.dir, '../scripts/autobuilder-usage.ts');
const hash = 'a'.repeat(64);
const event = (overrides: Record<string, unknown> = {}) => ({
  runId: 'run-1', attemptId: 'attempt-1', eventId: 'message-1',
  kind: 'model', phase: 'build', role: 'implementer', observation: 'observed',
  provider: 'anthropic', model: 'claude-fable-5-1', transport: 'interactive-cli',
  sourceFingerprints: { 'source.ts': hash }, instructionFingerprints: { 'instructions.md': hash },
  evidence: [{ ref: 'retained-session.jsonl#message-1', sha256: hash }],
  usage: { inputTokens: 2, outputTokens: 124, cacheCreationInputTokens: 31107, cacheReadInputTokens: 0 },
  durationMs: 100, isRetry: false, ...overrides,
});
function run(events: unknown[], extra: Record<string, unknown> = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ab-usage-'));
  const raw = JSON.stringify({ schemaVersion: 'autobuilder-usage-events/v1', events, ...extra });
  const input = path.join(dir, 'provider events.json');
  fs.writeFileSync(input, raw);
  try {
    const result = spawnSync(process.execPath, ['--no-env-file', '--config=/dev/null', script, input], {
      cwd: dir, encoding: 'utf8', timeout: 15_000, maxBuffer: 4 * 1024 * 1024,
    });
    return { status: result.status, stdout: result.stdout, stderr: result.stderr,
      report: result.status === 0 ? JSON.parse(result.stdout) : null,
      digest: createHash('sha256').update(raw).digest('hex') };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

test('retained final message usage is reported by phase and role with input provenance', () => {
  const r = run([event()]);
  expect(r.status).toBe(0);
  expect(r.report.schemaVersion).toBe('autobuilder-usage-report/v1');
  expect(r.report.input.sha256).toBe(r.digest);
  expect(r.report.events[0].sourceFingerprints).toEqual({ 'source.ts': hash });
  expect(r.report.events[0].instructionFingerprints).toEqual({ 'instructions.md': hash });
  expect(r.report.events[0].evidence[0].ref).toBe('retained-session.jsonl#message-1');
  expect(r.report.groups[0]).toMatchObject({ phase: 'build', role: 'implementer', kind: 'model', observation: 'observed', events: 1, attempts: 1,
    inputTokens: { total: 2, knownSubtotal: 2, known: 1, unknown: 0 },
    cacheCreationInputTokens: { total: 31107 }, cacheReadInputTokens: { total: 0 },
    attemptDurationMs: { total: 100 }, retryAttempts: { total: 0 } });
  expect(r.report.invoiceCharges).toBeNull();
  expect(r.report.wallTimeMs).toBeNull();
});

test('duplicate messages count once and multiple messages share one attempt duration and retry', () => {
  const a = event({ isRetry: true });
  const b = event({ eventId: 'message-2', isRetry: true, usage: { inputTokens: 32, outputTokens: 219,
    cacheCreationInputTokens: 36395, cacheReadInputTokens: 8200 } });
  const r = run([a, b, { ...a, evidence: [{ ref: 'second-capture#message-1', sha256: hash }] }]);
  expect(r.status).toBe(0);
  expect(r.report.duplicateEvents).toBe(1);
  expect(r.report.events).toHaveLength(2);
  expect(r.report.events[0].evidence).toHaveLength(2);
  expect(r.report.groups[0]).toMatchObject({ events: 2, attempts: 1,
    inputTokens: { total: 34 }, outputTokens: { total: 343 },
    cacheCreationInputTokens: { total: 67502 }, cacheReadInputTokens: { total: 8200 },
    attemptDurationMs: { total: 100 }, retryAttempts: { total: 1 } });
  const conflict = run([a, { ...a, usage: { ...a.usage as object, inputTokens: 900 } }]);
  expect(conflict.status).toBe(2);
  expect(conflict.stdout).toBe('');
  expect(conflict.stderr).toContain('conflicting_event');
  const conflictingAttempt = run([a, { ...b, durationMs: 101 }]);
  expect(conflictingAttempt.status).toBe(2);
  expect(conflictingAttempt.stderr).toContain('conflicting_attempt');
});

test('missing usage stays unknown and estimated or helper events cannot inflate observed model usage', () => {
  const missing = event({ eventId: 'missing', attemptId: 'attempt-2', usage: { outputTokens: 6 },
    durationMs: undefined, isRetry: undefined, sourceFingerprints: undefined, instructionFingerprints: undefined });
  const helper = event({ eventId: 'helper-1', attemptId: 'helper-attempt', kind: 'helper', provider: null,
    model: null, transport: 'local', usage: undefined, durationMs: 5 });
  const estimate = event({ eventId: 'estimate-1', attemptId: 'estimate-attempt', observation: 'estimated',
    usage: { inputTokens: 999999 } });
  const r = run([event(), missing, helper, estimate]);
  expect(r.status).toBe(0);
  expect(r.report.groups).toHaveLength(3);
  expect(r.report.groups[0]).toMatchObject({ kind: 'model', observation: 'observed',
    inputTokens: { total: null, knownSubtotal: 2, known: 1, unknown: 1 },
    outputTokens: { total: 130, known: 2, unknown: 0 },
    attemptDurationMs: { total: null, knownSubtotal: 100, unknown: 1 },
    retryAttempts: { total: null, knownSubtotal: 0, unknown: 1 } });
  expect(r.report.groups[1]).toMatchObject({ kind: 'helper', inputTokens: { total: null, knownSubtotal: null, known: 0, unknown: 1 } });
  expect(r.report.groups[2]).toMatchObject({ observation: 'estimated', inputTokens: { total: 999999 } });
  expect(r.report.events[1].sourceFingerprints).toBeNull();
  expect(r.report.events[1].instructionFingerprints).toBeNull();
});

test('invalid records fail closed without leaking payloads or emitting a partial report', () => {
  const invalid = [
    { events: [event()], extra: { schemaVersion: 'future/v9' } },
    { events: [event({ usage: { inputTokens: -1 } })] },
    { events: [event({ usage: { inputTokens: '2' } })] },
    { events: [event({ durationMs: 1.5 })] },
    { events: [event({ isRetry: 'false' })] },
    { events: [event({ eventId: '' })] },
    { events: [event({ sourceFingerprints: { file: 'not-a-digest' } })] },
    { events: [event({ evidence: [] })] },
    { events: [event({ privateApiToken: 'private-payload-must-not-leak' })] },
    { events: [event({ kind: 'helper', provider: null, model: null })] },
    { events: [event({ kind: 'model', provider: null })] },
    { events: [null] },
    { events: [event({ usage: { inputTokens: Number.MAX_SAFE_INTEGER } }), event({ eventId: 'overflow' })] },
  ];
  for (const invalidInput of invalid) {
    const r = run(invalidInput.events, invalidInput.extra);
    expect(r.status).toBe(2);
    expect(r.stdout).toBe('');
    expect(r.stderr).not.toContain('private-payload-must-not-leak');
    expect(r.stderr).toContain('autobuilder-usage:');
  }
});

test('session aggregates retain unknown attempt identity and cannot be added to their message records', () => {
  const aggregate = event({ eventId: 'sha256:retained-aggregate', attemptId: null, recordScope: 'aggregate',
    durationMs: null, isRetry: null, provenanceNote: 'Session-level retained usage, not a provider message ID.' });
  const r = run([aggregate]);
  expect(r.status).toBe(0);
  expect(r.report.events[0].attemptId).toBeNull();
  expect(r.report.groups[0]).toMatchObject({ attempts: null, knownAttempts: 0, unknownAttemptRecords: 1,
    attemptDurationMs: { total: null, known: 0, unknown: 1 }, retryAttempts: { total: null } });
  const overlap = run([aggregate, event()]);
  expect(overlap.status).toBe(2);
  expect(overlap.stderr).toContain('overlapping_aggregate');
  const twoAggregates = run([aggregate, { ...aggregate, eventId: 'different-aggregate' }]);
  expect(twoAggregates.status).toBe(2);
  expect(twoAggregates.stderr).toContain('overlapping_aggregate');
  const noData = run([]);
  expect(noData.status).toBe(0);
  expect(noData.report.groups).toEqual([]);
});

test('retained Fable session aggregate follows the real offline normalization path without invented attempts', () => {
  const sample = JSON.parse(fs.readFileSync(path.resolve(import.meta.dir, '../docs/reviews/autobuilder-validation/usage-example-input.json'), 'utf8'));
  const r = run(sample.events);
  expect(r.status).toBe(0);
  expect(r.report.groups[0]).toMatchObject({ events: 1, attempts: null,
    inputTokens: { total: 194 }, outputTokens: { total: 13090 },
    cacheCreationInputTokens: { total: 179229 }, cacheReadInputTokens: { total: 595132 },
    retryAttempts: { total: null }, attemptDurationMs: { total: null } });
  const retained = fs.readFileSync(path.resolve(import.meta.dir, '../docs/reviews/autobuilder-through4-2026-10-23/fable-metadata.json'));
  expect(r.report.events[0].evidence[0].sha256).toBe(createHash('sha256').update(retained).digest('hex'));
  expect(r.report.events[0].recordScope).toBe('aggregate');
  expect(r.report.events[0].instructionFingerprints).toBeNull();
});
