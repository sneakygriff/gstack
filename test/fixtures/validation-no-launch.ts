// System-boundary sentinel: any process/provider launch makes a preview fail.
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
const forbidden = () => { throw new Error('Preview attempted a process or provider launch'); };
for (const name of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) {
  (childProcess as any)[name] = forbidden;
}
syncBuiltinESMExports();
Bun.spawn = forbidden as any;
Bun.spawnSync = forbidden as any;
globalThis.fetch = forbidden as any;
