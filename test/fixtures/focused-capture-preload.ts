/** OS-pipe failure injection in an isolated CLI child, never the shared test process. */
import { spyOn } from 'bun:test';
import * as cp from 'node:child_process';

const original = cp.spawn;
spyOn(cp, 'spawn').mockImplementation((command, args, options) => {
  const child = original(command, args, options);
  if (Array.isArray(args) && args[0] === 'test') {
    child.stdout!.destroy(new Error('focused fixture capture loss'));
  }
  return child;
});
