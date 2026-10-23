/** Opt-in evidence at EvalCollector's existing lifecycle; never launches a run. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

type NativeCheck = { id: string; kind?: string; cases?: string[]; files: string[]; inputs: string[];
  environment: string[]; scope: { status: string; note: string; unresolved: string[] }; record?: string };
const engineRoot = path.resolve(import.meta.dir, '..');
const engineFiles = ['scripts/native-eval-binding.ts', 'scripts/autobuilder-acceptance.ts',
  'test/helpers/eval-store.ts', 'test/helpers/cookie-workflow-manual-review.ts',
  'test/helpers/cookie-workflow-judge-input.ts', 'lib/eval-model.ts'];
function stable(value: any): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + stable(value[key])).join(',') + '}';
}
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const same = (a: unknown, b: unknown) => stable(a) === stable(b);
function fileHash(file: string) {
  try { return { path: fs.realpathSync(file), sha256: hash(fs.readFileSync(file)) }; }
  catch { return { path: path.resolve(file), sha256: null }; }
}
function declaration(root: string, check: NativeCheck) {
  const { record: _, ...contract } = check;
  return hash(stable({ root, ...contract }));
}
function snapshot(root: string, check: NativeCheck) {
  return { inputs: check.inputs.map(file => ({ file, ...fileHash(path.resolve(root, file)) })),
    engine: engineFiles.map(file => ({ file, ...fileHash(path.join(engineRoot, file)) })),
    runtime: { ...fileHash(process.execPath), bun: Bun.version, node: process.versions.node, platform: process.platform, arch: process.arch },
    environment: [...new Set(['PATH', 'TMPDIR', 'NODE_OPTIONS', 'BUN_OPTIONS', ...check.environment])].sort()
      .map(name => ({ name, sha256: process.env[name] == null ? null : hash(process.env[name]!) })) };
}
export function nativeResultDigest(result: any) {
  const { acceptance: _, ...native } = result;
  // Match the persisted JSON: optional undefined entry fields are omitted.
  return hash(stable(JSON.parse(JSON.stringify(native))));
}
function configuredCheck(): { root: string; check: NativeCheck } | null {
  const file = process.env.GSTACK_ACCEPTANCE_PLAN, id = process.env.GSTACK_ACCEPTANCE_CHECK;
  if (file == null && id == null) return null;
  if (!file || !id) throw new Error('Native acceptance requires both GSTACK_ACCEPTANCE_PLAN and GSTACK_ACCEPTANCE_CHECK');
  const plan = JSON.parse(fs.readFileSync(file, 'utf8'));
  const root = fs.realpathSync(path.resolve(path.dirname(path.resolve(file)), plan.root));
  const checks = Array.isArray(plan.checks) ? plan.checks.filter((check: any) => check.id === id) : [];
  const check = checks[0];
  const strings = (values: any): values is string[] => Array.isArray(values)
    && values.every(value => typeof value === 'string' && value.length > 0) && new Set(values).size === values.length;
  if (plan.schemaVersion !== 'autobuilder-acceptance-plan/v1' || checks.length !== 1 || check.kind !== 'native-eval'
    || !strings(check.cases) || !check.cases.length || !strings(check.files) || !check.files.length
    || !strings(check.inputs) || !strings(check.environment)
    || check.files.some((file: string) => path.isAbsolute(file) || path.relative(root, path.resolve(root, file)).startsWith('..') || !check.inputs.includes(file))
    || !check.scope || !['declared-complete', 'unknown'].includes(check.scope.status)
    || typeof check.scope.note !== 'string' || !check.scope.note.trim() || !strings(check.scope.unresolved))
    throw new Error('Invalid native acceptance check');
  return { root, check };
}
export function beginNativeBinding() {
  const configured = configuredCheck();
  if (!configured) return null;
  const { root, check } = configured;
  const before = snapshot(root, check);
  if ([...before.inputs, ...before.engine, before.runtime].some(input => !input.sha256))
    throw new Error('Native acceptance cannot start with missing declared inputs');
  // The check is detached from caller objects and captured before addTest/model work.
  return { root, check, schemaVersion: 'native-eval-binding/v1', checkId: check.id,
    declaration: declaration(root, check), runId: randomUUID(), startedAt: new Date().toISOString(), before };
}
export function finishNativeBinding(start: ReturnType<typeof beginNativeBinding>, result: any) {
  if (!start) return undefined;
  const { root, check, ...binding } = start;
  return { ...binding, root, completedAt: new Date().toISOString(), after: snapshot(root, check), resultSha256: nativeResultDigest(result) };
}
export function inspectNativeBinding(root: string, check: NativeCheck, native: any) {
  const binding = native.acceptance;
  const reasons: string[] = [];
  let applicability = 'applicable';
  if (!binding) return { applicability: 'incomplete', reasons: ['Native evaluation lacks consumed source/instruction fingerprints',
    'Native evaluation lacks complete runtime and environment binding'] };
  if (native.schema_version !== 3 || binding.schemaVersion !== 'native-eval-binding/v1' || binding.checkId !== check.id || binding.root !== root
    || typeof binding.runId !== 'string' || !binding.runId || !binding.before || !binding.after
    || !Number.isFinite(Date.parse(binding.startedAt)) || !Number.isFinite(Date.parse(binding.completedAt))
    || Date.parse(binding.startedAt) > Date.parse(native.timestamp) || Date.parse(native.timestamp) > Date.parse(binding.completedAt)
    || binding.resultSha256 !== nativeResultDigest(native))
    return { applicability: 'incomplete', reasons: ['Native lifecycle binding or result digest is invalid'] };
  if (!same(binding.before, binding.after)) reasons.push('Native consumed inputs changed during execution');
  if (binding.declaration !== declaration(root, check) || !same(binding.before, snapshot(root, check))) {
    applicability = 'stale'; reasons.push('Native declared inputs, environment, runtime, engine or selection changed');
  }
  if (reasons.length && applicability !== 'stale') applicability = 'incomplete';
  return { applicability, reasons };
}
