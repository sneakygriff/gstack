/** Opt-in diagnostics for the free lifecycle replay; never acceptance evidence. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

const TEXT_LIMIT = 4096;
const FILE_LIMIT = 64 * 1024;
const clipped = (value: unknown) => String(value ?? '').slice(-TEXT_LIMIT);

export function createLifecycleDiagnostics(root: string, destination = process.env.GSTACK_LIFECYCLE_DIAGNOSTICS_DIR) {
  let log: string | undefined;
  let sequence = 0;
  const writeFailures: string[] = [];
  const started = performance.now();
  const record = (event: string, data: Record<string, unknown> = {}) => {
    if (!log) return;
    try { fs.appendFileSync(log, JSON.stringify({ event, elapsedMs: performance.now() - started, ...data }) + '\n'); }
    catch (error: any) {
      if (!writeFailures.length) console.error('LIFECYCLE_DIAGNOSTIC_WRITE_FAILED');
      if (writeFailures.length < 8) writeFailures.push(String(error?.code ?? 'UNKNOWN'));
    }
  };
  if (destination) {
    const target = fs.realpathSync(destination), fixture = fs.realpathSync(root);
    if (target === fixture || target.startsWith(fixture + path.sep)) throw new Error('Lifecycle diagnostics must survive fixture cleanup');
    const directory = fs.mkdtempSync(path.join(target, 'lifecycle-'));
    fs.chmodSync(directory, 0o700);
    log = path.join(directory, 'events.jsonl');
    fs.writeFileSync(log, '', { mode: 0o600, flag: 'wx' });
    record('runtime', { fixture, cwd: process.cwd(), pid: process.pid, execPath: process.execPath,
      bun: Bun.version, node: Bun.which('node'), git: Bun.which('git'), tmpdir: os.tmpdir(), loadavg: os.loadavg() });
  }
  return {
    log,
    writeFailures,
    record,
    async step<T>(label: string, work: () => T | Promise<T>): Promise<T> {
      if (!log) return await work();
      const id = ++sequence, start = performance.now();
      record('start', { id, label: clipped(label) });
      try {
        const result = await work();
        record('end', { id, durationMs: performance.now() - start });
        return result;
      } catch (error: any) {
        record('error', { id, durationMs: performance.now() - start, name: error?.name,
          code: error?.code, status: error?.status, signal: error?.signal,
          message: clipped(error?.message), stderr: clipped(error?.stderr), loadavg: os.loadavg() });
        throw error;
      }
    },
    beforeCleanup() {
      if (!log) return;
      try {
        record('before-cleanup');
        // Only the known local replay diagnostics, never arbitrary fixture contents.
        const captures = path.join(root, '.context/shared-libs-captures');
        if (!fs.existsSync(captures)) return;
        if (fs.realpathSync(captures) !== path.join(fs.realpathSync(root), '.context/shared-libs-captures')) {
          record('capture-rejected', { reason: 'symlinked-directory' }); return;
        }
        const files = fs.readdirSync(captures).filter(name => name.endsWith('.failure.json')).sort();
        for (const name of files.slice(0, 8)) {
          let fd: number | undefined;
          try {
            fd = fs.openSync(path.join(captures, name), fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
            const stat = fs.fstatSync(fd);
            if (!stat.isFile()) { record('capture-rejected', { name, reason: 'not-regular' }); continue; }
            const bytes = Buffer.alloc(Math.min(stat.size, FILE_LIMIT));
            const read = fs.readSync(fd, bytes, 0, bytes.length, 0);
            record('fixture-failure', { name, bytes: stat.size, truncated: stat.size > read, text: bytes.subarray(0, read).toString('utf8') });
          } catch (error: any) {
            record('capture-error', { name, code: error?.code });
          } finally { if (fd !== undefined) fs.closeSync(fd); }
        }
        if (files.length > 8) record('captures-truncated', { omitted: files.length - 8 });
      } catch (error: any) { record('cleanup-capture-error', { code: error?.code }); }
    },
  };
}
