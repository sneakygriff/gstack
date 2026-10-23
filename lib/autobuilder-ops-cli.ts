import { updateState, measureSize, AutobuilderOpsError, failureReason } from './autobuilder-ops';
const [op, ...args] = process.argv.slice(2);
try {
  if ((op === 'queue' || op === 'exploration') && args.length === 1) {
    const q = await import('./autobuilder-queue');
    let request: any;
    try { request = JSON.parse(args[0]); } catch { throw new AutobuilderOpsError('invalid_request_json'); }
    const { action, runDir, task, attempt, head, handle } = request;
    let result;
    if (op === 'exploration' && action === 'capture') result = q.captureExploration(request.repo, request.base, request.sections);
    else if (op === 'queue') {
      if (action === 'init') result = q.queueInit(request.contract);
      else if (action === 'next') result = q.queueNext(runDir);
      else if (action === 'bind') result = q.queueBind(runDir, task, attempt, handle);
      else if (action === 'complete') result = await q.queueComplete(runDir, task, attempt, head);
      else if (action === 'status') result = q.queueStatus(runDir);
      else if (action === 'cancel') result = q.queueCancel(runDir);
      else throw new AutobuilderOpsError('usage');
    } else throw new AutobuilderOpsError('usage');
    console.log(JSON.stringify(result));
  } else if (op === 'state' && args.length === 1) {
    let request: unknown;
    try { request = JSON.parse(args[0]); }
    catch { throw new AutobuilderOpsError('invalid_request_json'); }
    updateState(request as Record<string, any>);
    console.log('ok');
  } else if (op === 'meter' && args.length === 2) console.log(measureSize(args[0], args[1]).line);
  else throw new AutobuilderOpsError('usage');
} catch (error) {
  if (op === 'queue' || op === 'exploration') {
    const { QueueError } = await import('./autobuilder-queue');
    console.log(JSON.stringify({ status: 'BLOCKED', reason: error instanceof QueueError ? error.reason : failureReason(error) }));
    process.exitCode = 1;
  } else {
    console.log(op === 'meter' ? 'SHIP_METER FAIL: operation failed' : 'FAILED: state operation failed');
    const reason = failureReason(error);
    console.error(`AUTOBUILDER_OPS_ERROR: ${reason}`);
    if (reason === 'lock_held') console.error('LOCK_RECOVERY: Stop and investigate the existing .state.lock. Check for an active writer and preserve the checkpoint; manual cleanup requires confirming no writer is active and inspecting the pending checkpoint. Never auto-delete the lock or increase the existing retry limit.');
    process.exitCode = 1;
  }
}
