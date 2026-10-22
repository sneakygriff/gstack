import { updateState, measureSize, AutobuilderOpsError, failureReason } from './autobuilder-ops';
const [op, ...args] = process.argv.slice(2);
try {
  if (op === 'state' && args.length === 1) {
    let request: unknown;
    try { request = JSON.parse(args[0]); }
    catch { throw new AutobuilderOpsError('invalid_request_json'); }
    updateState(request as Record<string, any>);
    console.log('ok');
  } else if (op === 'meter' && args.length === 2) console.log(measureSize(args[0], args[1]).line);
  else throw new AutobuilderOpsError('usage');
} catch (error) {
  console.log(op === 'meter' ? 'SHIP_METER FAIL: operation failed' : 'FAILED: state operation failed');
  const reason = failureReason(error);
  console.error(`AUTOBUILDER_OPS_ERROR: ${reason}`);
  if (reason === 'lock_held') console.error('LOCK_RECOVERY: Stop and investigate the existing .state.lock. Check for an active writer and preserve the checkpoint; manual cleanup requires confirming no writer is active and inspecting the pending checkpoint. Never auto-delete the lock or increase the existing retry limit.');
  process.exitCode = 1;
}
