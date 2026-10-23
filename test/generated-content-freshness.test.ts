// The dependent-check runner accepts exact free test files. Adapt the existing
// skill:check policy unchanged: scratch renders, canonical settings, no writes
// through installed skill links. Generator behavior is tested by its own suite.
import { expect, test } from 'bun:test';
import { main } from '../scripts/skill-check';

test('tracked generated skills and references match their current source', async () => {
  expect(await main()).toBe(0);
}, 120_000);
