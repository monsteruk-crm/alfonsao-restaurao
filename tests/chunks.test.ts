import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planChunks } from '../src/chunks.js';

test('full movie splits without gaps, overlaps or over-limit requests', () => {
  assert.deepEqual(planChunks(28350, 9000), [
    { startFrame: 0, endFrame: 9000 }, { startFrame: 9000, endFrame: 18000 },
    { startFrame: 18000, endFrame: 27000 }, { startFrame: 27000, endFrame: 28350 },
  ]);
});
test('exact limits and small clips produce no extra chunk', () => {
  assert.equal(planChunks(9000, 9000).length, 1);
  assert.equal(planChunks(18000, 9000).length, 2);
  assert.deepEqual(planChunks(1, 9000), [{ startFrame: 0, endFrame: 1 }]);
});
test('invalid limits are rejected before provider submission', () => {
  for (const limit of [0, -1, 9001, NaN, 1.5]) assert.throws(() => planChunks(28350, limit));
});
