import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Diagnostics, sanitize } from '../src/diagnostics.js';

test('diagnostics persist the operation and report real Gateway polls without secrets or video data', async () => {
  const directory = await mkdtemp(path.join(tmpdir(),'proteus-diagnostics-'));
  try {
    const tracker = new Diagnostics(directory,'topaz/starlight-precise-2.6');
    await tracker.observe('https://test.invalid/video-model/start',Response.json({
      operation:{jobId:'job-test'}, providerMetadata:{gateway:{asyncJob:{jobId:'job-test',status:'queued',webhookSigningSecret:'secret-test'}}},
    }));
    await tracker.observe('https://test.invalid/video-model/status',Response.json({status:'pending',providerMetadata:{gateway:{asyncJob:{jobId:'job-test',status:'running',attempts:1}}}}));
    const job = JSON.parse(await readFile(path.join(directory,'job.json'),'utf8'));
    assert.deepEqual(job.operation,{jobId:'job-test'});
    const state = JSON.parse(await readFile(path.join(directory,'diagnostics.json'),'utf8'));
    assert.equal(state.gatewayStatus,'running');assert.equal(state.pollCount,1);assert.equal(state.lastHttpStatus,200);
    assert.match(tracker.summary(),/Gateway=running/);
    assert.ok(!((await readFile(path.join(directory,'events.jsonl'),'utf8')).includes('secret-test')));
    assert.deepEqual(sanitize({authorization:'no',videos:[{data:'huge'}],progress:42,url:'https://signed.invalid/?token=x'}),{progress:42,url:'[url omitted]'});
    await tracker.observe('https://test.invalid/video-model/status',Response.json({error:{message:'provider unavailable'}},{status:503}));
    assert.equal(tracker.state.lastHttpStatus,503);assert.equal(tracker.state.stage,'gateway-error');
  } finally {await rm(directory,{recursive:true,force:true});}
});
