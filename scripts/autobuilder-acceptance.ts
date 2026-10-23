#!/usr/bin/env bun
/** Bounded, operator-declared input scope; never a dependency discovery or release gate. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { FreeRunReporter } from './test-free-shards';
import { BunTestOutputClassifier, installChildSignalForwarding } from './test-strict-output';
import { evalEntryOutcome } from '../test/helpers/eval-store';
import { readUsageReport } from './autobuilder-usage';
import { inspectNativeBinding } from './native-eval-binding';

type Check = { id: string; kind?: 'focused' | 'native-eval'; cases?: string[]; files: string[]; inputs: string[]; environment: string[];
  scope: { status: 'declared-complete' | 'unknown'; note: string; unresolved: string[] }; record?: string; wallTimeoutSeconds?: number };
type Measurement = { id: string; report: string; inputs: string[]; instructions: string[];
  environment: string[]; scope: Check['scope'] };
type Plan = { schemaVersion: string; root: string; checks: Check[]; measurements?: Measurement[]; historical?: unknown[] };
const engineRoot = path.resolve(import.meta.dir, '..');
const engineFiles = ['scripts/autobuilder-acceptance.ts', 'scripts/test-focused.ts', 'scripts/test-free-shards.ts',
  'scripts/test-strict-output.ts', 'test/helpers/paid-test-set.ts', 'test/helpers/touchfiles.ts',
  'test/helpers/touchfiles-data.ts', 'test/helpers/test-selection.ts', 'scripts/autobuilder-usage.ts',
  'test/helpers/eval-store.ts', 'test/helpers/cookie-workflow-manual-review.ts', 'scripts/native-eval-binding.ts'];
const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(s => typeof s === 'string' && s.length > 0)
    && new Set(value).size === value.length;
}
function readJSON(file: string) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function loadPlan(file: string): Plan {
  const plan = readJSON(file);
  if (plan.schemaVersion !== 'autobuilder-acceptance-plan/v1' || typeof plan.root !== 'string'
    || !Array.isArray(plan.checks) || !plan.checks.length) throw new Error('Invalid acceptance plan');
  plan.root = fs.realpathSync(path.resolve(path.dirname(file), plan.root));
  const ids = new Set();
  for (const check of plan.checks) {
    if (typeof check.id !== 'string' || !check.id || ids.has(check.id) || !strings(check.files) || !check.files.length
      || !strings(check.inputs) || !strings(check.environment) || !check.scope
      || !['declared-complete', 'unknown'].includes(check.scope.status) || typeof check.scope.note !== 'string'
      || !check.scope.note.trim() || !strings(check.scope.unresolved)
      || check.wallTimeoutSeconds != null && (!Number.isFinite(check.wallTimeoutSeconds) || check.wallTimeoutSeconds <= 0)
      || check.record != null && typeof check.record !== 'string') throw new Error('Invalid check declaration');
    if (check.kind != null && !['focused', 'native-eval'].includes(check.kind)
      || check.kind === 'native-eval' && (!strings(check.cases) || !check.cases.length)) throw new Error('Invalid evidence kind or native cases');
    ids.add(check.id);
    for (const file of check.files) {
      if (path.isAbsolute(file) || path.relative(plan.root, path.resolve(plan.root, file)).startsWith('..')
        || !check.inputs.includes(file)) throw new Error('Selected tests must belong to declared inputs inside root');
    }
    if (check.record) check.record = path.resolve(path.dirname(file), check.record);
  }
  if (plan.historical != null && !Array.isArray(plan.historical)) throw new Error('Invalid historical records');
  if (plan.measurements != null && !Array.isArray(plan.measurements)) throw new Error('Invalid measurements');
  for (const measurement of plan.measurements ?? []) {
    if (typeof measurement.id !== 'string' || !measurement.id || ids.has(measurement.id)
      || typeof measurement.report !== 'string' || !measurement.report
      || !strings(measurement.inputs) || !strings(measurement.instructions) || !strings(measurement.environment)
      || measurement.inputs.some((file: string) => measurement.instructions.includes(file))
      || !measurement.scope || !['declared-complete', 'unknown'].includes(measurement.scope.status)
      || typeof measurement.scope.note !== 'string' || !measurement.scope.note.trim() || !strings(measurement.scope.unresolved))
      throw new Error('Invalid measurement declaration');
    ids.add(measurement.id);
    measurement.report = path.resolve(path.dirname(file), measurement.report);
  }
  return plan;
}
function fingerprint(file: string) {
  try { return { path: fs.realpathSync(file), sha256: sha(fs.readFileSync(file)) }; }
  catch { return { path: path.resolve(file), sha256: null }; }
}
function snapshot(root: string, check: Check) {
  const environment = [...new Set(['PATH', 'TMPDIR', 'NODE_OPTIONS', 'BUN_OPTIONS', ...check.environment])].sort();
  return { inputs: check.inputs.map(file => ({ file, ...fingerprint(path.resolve(root, file)) })),
    engine: engineFiles.map(file => ({ file, ...fingerprint(path.join(engineRoot, file)) })),
    runtime: { ...fingerprint(process.execPath), version: Bun.version, platform: process.platform, arch: process.arch },
    environment: environment.map(name => ({ name, sha256: process.env[name] == null ? null : sha(process.env[name]!) })) };
}
function declaration(root: string, check: Check) {
  const { record: _, ...contract } = check;
  return sha(JSON.stringify({ root, ...contract }));
}
function revision(root: string) {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', timeout: 5000 });
  return result.status === 0 ? result.stdout.trim() : null;
}
async function capture(plan: Plan, id: string) {
  const check = plan.checks.find(c => c.id === id);
  if (!check?.record) throw new Error('Capture requires a known check with an unused record path');
  if (check.kind === 'native-eval') throw new Error('Native evaluations must be run by the existing model harness; capture is free-only');
  if (fs.existsSync(check.record)) throw new Error('Refusing to replace an original record; use a new path');
  const before = snapshot(plan.root, check);
  if ([...before.inputs, ...before.engine, before.runtime].some(i => !i.sha256)) throw new Error('Cannot capture missing declared inputs');
  const child = spawn(process.execPath, [path.join(engineRoot, 'scripts/test-focused.ts'), '--root', plan.root,
    ...(check.wallTimeoutSeconds == null ? [] : ['--wall-timeout', String(check.wallTimeoutSeconds)]), '--', ...check.files],
    { cwd: plan.root, stdio: ['ignore', 'pipe', 'pipe'] });
  const forwarding = installChildSignalForwarding(child);
  let stdout = ''; let stderr = '';
  child.stdout!.on('data', data => { stdout += data; });
  child.stderr!.on('data', data => { stderr += data; });
  const exitCode = await new Promise<number | null>((resolve, reject) => { child.on('error', reject); child.on('close', resolve); });
  forwarding.dispose();
  const after = snapshot(plan.root, check);
  let receipt: any = null;
  try { receipt = JSON.parse(stdout); } catch { /* preserve failed launch as incomplete, never fabricate receipt */ }
  const record = { schemaVersion: 'autobuilder-acceptance-record/v1', checkId: id, capturedAt: new Date().toISOString(),
    declaration: declaration(plan.root, check), before, after, exitCode, receipt,
    receiptFile: receipt?.receiptPath ? fingerprint(receipt.receiptPath) : null,
    log: receipt?.logPath ? fingerprint(receipt.logPath) : null, stderr,
    runId: receipt?.runId ?? null };
  fs.writeFileSync(check.record, JSON.stringify(record, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify(record));
  process.exitCode = exitCode === 0 ? 0 : 1;
}
function inspectRecord(plan: Plan, check: Check) {
  const base = { id: check.id, status: 'unexecuted', applicability: 'missing', coverageCredit: false, reused: false,
    counts: null as any, failureDetails: null as any, provenance: null as any, scope: check.scope, reasons: [] as string[] };
  if (!check.record || !fs.existsSync(check.record)) return { ...base, reasons: ['No retained execution record'] };
  const reasons: string[] = [];
  let record: any;
  try { record = readJSON(check.record); if (!record || typeof record !== 'object' || Array.isArray(record)) throw new Error(); } catch { return { ...base, applicability: 'incomplete', reasons: ['Unreadable execution record'] }; }
  const receipt = record.receipt;
  const evidence = receipt?.outcome?.evidence;
  base.provenance = { record: fingerprint(check.record), runId: record.runId ?? null,
    revision: receipt?.revision ?? null, startedAt: receipt?.startedAt ?? null, completedAt: receipt?.completedAt ?? null,
    receipt: record.receiptFile ?? null, log: record.log ?? null };
  base.status = ['passed', 'failed', 'cancelled', 'timed-out', 'incomplete'].includes(receipt?.status) ? receipt.status : 'unexecuted';
  let applicable = 'applicable';
  if (record.schemaVersion !== 'autobuilder-acceptance-record/v1' || record.checkId !== check.id
    || !record.before || !record.after || !record.declaration || !receipt || !evidence) reasons.push('Missing capture metadata');
  if (check.scope.status !== 'declared-complete' || check.scope.unresolved.length) reasons.push('Consumed input scope remains unknown');
  if (record.declaration && record.before && (record.declaration !== declaration(plan.root, check) || !equal(record.before, snapshot(plan.root, check)))) {
    applicable = 'stale'; reasons.push('Declared inputs, environment, runtime, engine or selection changed');
  }
  if (!equal(record.before, record.after)) reasons.push('Consumed inputs changed during execution');
  if (!Array.isArray(record.before?.inputs) || !record.before.inputs.length || record.before.inputs.some((i: any) => !i.sha256)) reasons.push('Missing input hashes');
  try {
    if (!record.receiptFile?.sha256 || !record.log?.sha256
      || !equal(record.receiptFile, fingerprint(record.receiptFile.path))
      || !equal(record.log, fingerprint(record.log.path))) throw new Error('Retained artifacts missing or altered');
    if (!equal(readJSON(record.receiptFile.path), receipt)) throw new Error('Receipt does not match captured execution');
    if (receipt.version !== 1 || receipt.kind !== 'focused-result' || !receipt.runId || record.runId !== receipt.runId
      || !receipt.startedAt || !receipt.completedAt || receipt.plan?.root !== plan.root
      || !equal(receipt.plan?.files, check.files) || !equal(receipt.outcome?.files, check.files)
      || receipt.logPath !== record.log.path || receipt.receiptPath !== record.receiptFile.path
      || evidence.logPath !== record.log.path) throw new Error('Plan, receipt and capture disagree');
    const log = fs.readFileSync(record.log.path, 'utf8');
    const parser = new BunTestOutputClassifier(); parser.write(log); const counts = parser.end();
    const reporter = new FreeRunReporter(check.files); reporter.write(log, 'stdout'); reporter.end();
    const report = reporter.report();
    base.failureDetails = { namedFailures: report.failures, unreportedFailures: report.unreportedFailures,
      unhandledErrors: report.unhandledErrors, crashedFiles: report.crashedFiles };
    base.counts = { passed: counts.passedTests, failed: counts.failedTests, skipped: counts.skippedTests,
      unhandled: counts.unhandledBetweenTests, testsRan: report.testsRan, filesRan: report.filesRan };
    if (base.status === 'passed' && counts.skippedTests > 0) base.status = 'skipped';
    if (!equal(reporter.observedFiles(plan.root), receipt.observedFiles)
      || !equal(receipt.observedFiles, evidence.observedFiles)
      || !equal(receipt.missingFiles, check.files.filter(f => !receipt.observedFiles.includes(f)))
      || !equal(receipt.unexpectedFiles, receipt.observedFiles.filter((f: string) => !check.files.includes(f)))
      || evidence.passedTests !== counts.passedTests || evidence.failedTests !== counts.failedTests
      || evidence.skippedTests !== counts.skippedTests
      || receipt.outcome.summary?.testsRan !== report.testsRan || receipt.outcome.summary?.filesRan !== report.filesRan
      || receipt.outcome.summary?.sawTerminalSummary !== report.sawTerminalSummary) throw new Error('Retained log contradicts receipt');
    const selected = record.before.inputs.filter((i: any) => check.files.includes(i.file)).map(({ file, sha256 }: any) => ({ file, sha256 }));
    const ordered = check.files.map(f => selected.find((i: any) => i.file === f));
    if (!equal(receipt.plan.inputs, ordered) || !equal(receipt.finalInputs, ordered) || receipt.inputsUnchanged !== true)
      throw new Error('Selected input hashes disagree');
    if (report.sawTerminalSummary && (report.testsRan !== counts.passedTests + counts.failedTests + counts.skippedTests
      || report.filesRan !== check.files.length)) throw new Error('Terminal totals contradict case counts or plan');
    if (!evidence.captureComplete || !evidence.logRetained || evidence.cleanupError || !report.sawTerminalSummary
      || counts.terminalFileCounts.length !== 1 || receipt.missingFiles.length || receipt.unexpectedFiles.length)
      reasons.push('Incomplete capture or coverage');
    if (receipt.status === 'passed' && (record.exitCode !== 0 || receipt.outcome.exitCode !== 0 || receipt.outcome.status !== 'passed'
      || counts.failedTests || counts.unhandledBetweenTests || report.crashedFiles.length || receipt.outcome.unattributedFailures))
      throw new Error('Passing claim contradicts process or failure evidence');
    if (receipt.status === 'cancelled' || receipt.status === 'timed-out') reasons.push(`Execution ${receipt.status}`);
  } catch (error) { reasons.push(error instanceof Error ? error.message : 'Invalid evidence'); }
  if (reasons.length && applicable !== 'stale') applicable = 'incomplete';
  const coverageCredit = applicable === 'applicable' && base.status === 'passed' && base.counts?.passed > 0
    && receipt.coverageCredit === true;
  return { ...base, applicability: applicable, coverageCredit, reused: applicable === 'applicable', reasons };
}
function inspectNative(plan: Plan, check: Check) {
  const result = { id: check.id, kind: 'native-eval', status: 'unexecuted', applicability: 'missing',
    coverageCredit: false, reused: false, counts: null as any, provenance: null as any,
    scope: check.scope, reasons: [] as string[], declaredEnvironment: check.environment,
    declaredInputs: check.inputs.map(file => ({ file, ...fingerprint(path.resolve(plan.root, file)) })) };
  if (!check.record || !fs.existsSync(check.record)) return { ...result, reasons: ['No retained native evaluation record'] };
  result.applicability = 'incomplete';
  result.provenance = { record: fingerprint(check.record) };
  try {
    const native = readJSON(check.record);
    const nonempty = (value: unknown) => typeof value === 'string' && value.trim().length > 0;
    const numeric = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0;
    if (![1, 2, 3].includes(native.schema_version) || !['e2e', 'llm-judge'].includes(native.tier)
      || !['version', 'branch', 'git_sha', 'timestamp', 'hostname'].every(key => nonempty(native[key]))
      || !Number.isFinite(Date.parse(native.timestamp)) || !Array.isArray(native.tests) || !native.tests.length
      || !native.tests.every((entry: any) => nonempty(entry.name) && nonempty(entry.suite)
        && ['e2e', 'llm-judge'].includes(entry.tier) && typeof entry.passed === 'boolean'
        && numeric(entry.duration_ms) && (native.schema_version === 3 && entry.cost_usd === null || numeric(entry.cost_usd))
        && (entry.execution == null || ['executed', 'reused'].includes(entry.execution))))
      throw new Error('Invalid native EvalResult metadata');
    const passed = native.tests.filter((entry: any) => evalEntryOutcome(entry) === 'passed').length;
    const manual = native.tests.filter((entry: any) => evalEntryOutcome(entry) === 'manual-review').length;
    const failed = native.tests.length - passed - manual;
    const reused = native.tests.filter((entry: any) => entry.execution === 'reused').length;
    const executed = native.tests.length - reused;
    result.counts = { passed, failed, manual, executed, reused, total: native.tests.length };
    result.provenance = { ...result.provenance, revision: native.git_sha, timestamp: native.timestamp,
      claudeCliVersion: native.claude_cli_version ?? null, tier: native.tier,
      entries: native.tests.map((entry: any) => ({ name: entry.name, outcome: evalEntryOutcome(entry),
        attempt: entry.attempt ?? null, execution: entry.execution ?? 'executed', reusedFrom: entry.reused_from ?? null,
        model: entry.model ?? null, modelSource: entry.model_source ?? 'unspecified', providerModel: entry.provider_model ?? null })) };
    if (native.total_tests !== native.tests.length || native.passed !== passed || native.failed !== failed
      || (native.manual_accepted_tests ?? 0) !== manual
      || native.executed_tests != null && native.executed_tests !== executed
      || native.reused_tests != null && native.reused_tests !== reused
      || native.total_duration_ms !== native.tests.reduce((sum: number, entry: any) => sum + entry.duration_ms, 0)
      || native.total_cost_usd !== (native.tests.some((entry: any) => entry.cost_usd === null) ? null
        : Math.round(native.tests.reduce((sum: number, entry: any) => sum + entry.cost_usd, 0) * 100) / 100))
      throw new Error('Native evaluation counters contradict its entries');
    // Native harness retry policy uses the final attempt of each case. Retain
    // every failed attempt in counters/provenance instead of erasing its cost.
    const finalEntries = [...new Map<string, any>(native.tests.map((entry: any) => [entry.name, entry])).values()];
    result.status = finalEntries.some(entry => evalEntryOutcome(entry) === 'failed') ? 'failed'
      : finalEntries.some(entry => evalEntryOutcome(entry) === 'manual-review') ? 'incomplete' : 'passed';
    if (!equal([...new Set(native.tests.map((entry: any) => entry.name))].sort(), [...check.cases!].sort()))
      result.reasons.push('Native evaluation cases do not match the declared selection');
    if (native._partial) result.reasons.push('Native evaluation is partial, not finalized');
    if (native.tests.some((entry: any) => !nonempty(entry.model))) result.reasons.push('Native evaluation lacks model request/identity metadata');
    if (native.tests.some((entry: any) => !nonempty(entry.prompt))) result.reasons.push('Native evaluation lacks retained model input prompt');
    if (native.acceptance) {
      const attempts = new Map<string, number>();
      for (const entry of native.tests) {
        const expected = (attempts.get(entry.name) ?? 0) + 1;
        if (entry.attempt !== expected) result.reasons.push('Native attempt history is incomplete or out of order');
        attempts.set(entry.name, expected);
      }
      const retries = [...attempts].filter(([, count]) => count > 1).map(([name, count]) => ({ name, attempts: count }));
      if (!equal(native.flaky_retries ?? [], retries)) result.reasons.push('Native retry ledger contradicts its attempts');
    }
    if (native.tests.some((entry: any) => entry.execution === 'reused'
      && (!entry.reused_from?.input_key || !entry.reused_from?.run_id || !entry.reused_from?.revision || !entry.reused_from?.completed_at)))
      result.reasons.push('Native reused entry lacks original provenance');
    if (check.scope.status !== 'declared-complete' || check.scope.unresolved.length) result.reasons.push('Consumed input scope remains unknown');
    if (reused) result.reasons.push('Native entry-level reuse lacks a validated complete origin binding');
    const binding = inspectNativeBinding(plan.root, check, native);
    result.reasons.push(...binding.reasons);
    result.applicability = binding.applicability === 'stale' ? 'stale' : result.reasons.length ? 'incomplete' : 'applicable';
    if (native.acceptance) Object.assign(result.provenance, { runId: native.acceptance.runId,
      startedAt: native.acceptance.startedAt, completedAt: native.acceptance.completedAt });
    result.coverageCredit = result.applicability === 'applicable' && result.status === 'passed' && passed > 0;
    result.reused = result.applicability === 'applicable';
  } catch (error) { result.status = 'incomplete'; result.reasons.push(error instanceof Error ? error.message : 'Invalid native evidence'); }
  return result;
}
function inspect(plan: Plan, check: Check) {
  try { return check.kind === 'native-eval' ? inspectNative(plan, check) : inspectRecord(plan, check); }
  catch { return { id: check.id, status: 'unexecuted', applicability: 'incomplete', coverageCredit: false, reused: false,
    counts: null, provenance: null, scope: check.scope, reasons: ['Malformed execution metadata'] }; }
}
function inspectUsage(plan: Plan, measurement: Measurement) {
  const result = { id: measurement.id, kind: 'usage', applicability: 'incomplete', consistency: 'incomplete',
    coverageCredit: false, scope: measurement.scope, provenance: { report: fingerprint(measurement.report), input: null as any,
      evidence: [] as any[] }, duplicateEvents: null as number | null, groups: null as any, events: null as any,
    reasons: [] as string[] };
  try {
    const report = readJSON(measurement.report);
    if (report.schemaVersion !== 'autobuilder-usage-report/v1' || typeof report.input?.path !== 'string'
      || !path.isAbsolute(report.input.path)) throw new Error('Invalid usage report metadata');
    result.provenance.input = fingerprint(report.input.path);
    if (!report.input.sha256 || report.input.sha256 !== result.provenance.input.sha256)
      throw new Error('Usage normalized input missing or changed');
    const recomputed = readUsageReport(report.input.path);
    if (!equal(report, recomputed)) throw new Error('Usage report contradicts its normalized input');
    result.consistency = 'consistent';
    result.duplicateEvents = report.duplicateEvents;
    result.groups = report.groups;
    result.events = report.events;
    if (!report.events.length) result.reasons.push('Usage report contains no observations');
    for (const event of recomputed.events) {
      for (const evidence of event.evidence) {
        // Local references resolve against the normalized input's directory.
        // Remote/opaque locators are retained but cannot be verified offline.
        const local = !/^[a-z][a-z0-9+.-]*:/i.test(evidence.ref);
        const observed = local ? fingerprint(path.resolve(path.dirname(report.input.path), evidence.ref)) : null;
        result.provenance.evidence.push({ ...evidence, observed });
        if (!observed?.sha256 || evidence.sha256 !== observed.sha256) {
          result.consistency = 'incomplete';
          result.reasons.push(`Usage evidence missing or changed: ${evidence.ref}`);
        }
      }
      for (const [label, declared, recorded] of [
        ['Source', measurement.inputs, event.sourceFingerprints],
        ['Instruction', measurement.instructions, event.instructionFingerprints],
      ] as const) {
        if (!declared.length || !recorded) { result.reasons.push(`${label} consumed inputs are unknown`); continue; }
        if (!equal(Object.keys(recorded).sort(), [...declared].sort())) result.reasons.push(`${label} fingerprint scope differs from declaration`);
        for (const file of declared) {
          const current = fingerprint(path.resolve(plan.root, file));
          if (!recorded[file]) result.reasons.push(`${label} fingerprint missing: ${file}`);
          else if (!current.sha256 || recorded[file] !== current.sha256) {
            result.applicability = 'stale'; result.reasons.push(`${label} fingerprint changed: ${file}`);
          }
        }
      }
      if (event.kind === 'model' && (!event.model || !event.transport)) result.reasons.push('Usage observation lacks model or transport identity');
    }
    if (measurement.scope.status !== 'declared-complete' || measurement.scope.unresolved.length)
      result.reasons.push('Consumed input scope remains unknown');
    // This native usage format has no environment capture. Do not bind it to
    // today's environment or infer applicability from matching source alone.
    result.reasons.push(`Usage format lacks recorded execution environment: ${measurement.environment.join(', ') || '(undeclared)'}`);
    result.reasons.push('Usage fingerprints are caller-attributed; model consumption is not independently established');
  } catch (error) { result.reasons.push(error instanceof Error ? error.message : 'Invalid usage evidence'); }
  result.reasons = [...new Set(result.reasons)];
  return result;
}
function assemble(plan: Plan, planPath: string) {
  const checks = plan.checks.map(check => inspect(plan, check));
  const coverageCredit = checks.length > 0 && checks.every(check => check.coverageCredit);
  const report = { schemaVersion: 'autobuilder-acceptance-manifest/v1', plan: fingerprint(planPath), revision: revision(plan.root),
    assembledAt: new Date().toISOString(), status: coverageCredit ? 'passed' : checks.some(c => c.status === 'failed') ? 'failed' : 'incomplete',
    coverageCredit, applicabilityScope: 'Operator-declared consumed inputs only; no automatic dependency discovery, authenticated provenance or whole-release certification.',
    checks, measurements: (plan.measurements ?? []).map(measurement => inspectUsage(plan, measurement)),
    historical: (plan.historical ?? []).map(record => ({ record, applicability: 'historical-unknown-inputs', coverageCredit: false })) };
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = coverageCredit ? 0 : 1;
}
async function main() {
  const [mode, file, id, ...extra] = process.argv.slice(2);
  if (!file || extra.length || mode === 'assemble' && id || !['capture', 'assemble'].includes(mode))
    throw new Error('usage: autobuilder-acceptance.ts capture <plan.json> <check-id> | assemble <plan.json>');
  const plan = loadPlan(path.resolve(file));
  if (mode === 'capture') await capture(plan, id); else assemble(plan, path.resolve(file));
}
if (import.meta.main) {
  try { await main(); } catch (error) { console.error(`autobuilder-acceptance: ${error instanceof Error ? error.message : String(error)}`); process.exitCode = 2; }
}
