import {test} from 'node:test';
import assert from 'node:assert/strict';
import {scenePlan,detectedCuts} from '../src/scene-plan.js';
test('cuts and length caps partition every frame exactly once',()=>{
  const jobs=scenePlan(105,[30,70,70,-1,999],25);
  assert.deepEqual(jobs.map(j=>j.endFrame-j.startFrame),[15,15,20,20,17,18]);
  assert.deepEqual(jobs.map(j=>j.scene),[1,1,2,2,3,3]);
  assert.equal(jobs[0]!.startFrame,0);assert.equal(jobs.at(-1)!.endFrame,105);
  for(let i=1;i<jobs.length;i++)assert.equal(jobs[i-1]!.endFrame,jobs[i]!.startFrame);
});
test('paid coverage boundaries split without inventing an edit cut',()=>{
  const jobs=scenePlan(100,[40],30,[50]);
  assert.ok(jobs.some(j=>j.startFrame===50&&j.reason==='coverage-boundary'));
  assert.equal(jobs.at(-1)!.scene,2);
});
test('scene timestamps map to original CFR frame indices',()=>{
  assert.deepEqual(detectedCuts('pts_time:1.2 pts_time:2.8 pts_time:2.8',25),[30,70]);
  assert.deepEqual(detectedCuts('pts_time:1.201',30000/1001),[36]);
});
