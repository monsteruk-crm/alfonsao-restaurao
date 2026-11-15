import {test} from 'node:test';
import assert from 'node:assert/strict';
import {resumeVideo} from '../src/resume-video.js';
test('saved operation is polled to completion without any start call',async()=>{
  let calls=0;
  const result=await resumeVideo('topaz/starlight-precise-2.6',{jobId:'saved'},{signal:AbortSignal.timeout(2000),intervalMs:1,
    check:async(_model,options)=>{
      assert.deepEqual(options.operation,{jobId:'saved'});calls++;
      return (calls===1?{status:'pending',response:{modelId:'test',timestamp:new Date(),headers:{}}}:
        {status:'completed',videos:[{type:'base64',data:Buffer.from('saved-video').toString('base64'),mediaType:'video/mp4'}],warnings:[],response:{modelId:'test',timestamp:new Date(),headers:{}}}) as any;
    }});
  assert.equal(calls,2);assert.equal(Buffer.from(result.video.uint8Array).toString(),'saved-video');
});
test('failed saved operation throws rather than generating a replacement',async()=>{
  await assert.rejects(resumeVideo('topaz/starlight-precise-2.6',{jobId:'failed'},{signal:AbortSignal.timeout(2000),intervalMs:1,
    check:async()=>({status:'error',error:{message:'provider failure'},response:{modelId:'test',timestamp:new Date(),headers:{}}}) as any}),/Saved generation failed/);
});
