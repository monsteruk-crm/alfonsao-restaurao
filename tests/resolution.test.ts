import { test } from 'node:test';
import assert from 'node:assert/strict';
import { outputDimensions, matchesResolution } from '../src/resolution.js';

test('5× archival dimensions match the observed provider alignment', () => {
  assert.deepEqual(outputDimensions(338, 254, 5, 3840), { width: 1692, height: 1272 });
  assert.equal(matchesResolution(1692, 1272, 1690, 1270), true);
});
test('already aligned dimensions and 4K cap remain correct', () => {
  assert.deepEqual(outputDimensions(320, 240, 2, 3840), { width: 640, height: 480 });
  assert.deepEqual(outputDimensions(1920, 1080, 5, 3840), { width: 3840, height: 2160 });
  assert.deepEqual(outputDimensions(1080, 1920, 5, 3841), { width: 2160, height: 3840 });
});
test('unexpected provider dimensions are still rejected', () => {
  assert.equal(matchesResolution(1696, 1272, 1690, 1270), false);
  assert.equal(matchesResolution(1692, 1280, 1690, 1270), false);
  assert.equal(matchesResolution(undefined, undefined, 1690, 1270), false);
});
test('invalid resize settings fail before submission', () => {
  for (const scale of [0, -1, NaN, Infinity]) {
    assert.throws(() => outputDimensions(338, 254, scale, 3840));
  }
});
