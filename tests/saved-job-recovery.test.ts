import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),ffmpeg=require('ffmpeg-static'),ffprobe=require('ffprobe-static').path;
test('CLI recovers a saved Gateway operation with zero credits, without uploading or submitting again',()=>{
  const root=mkdtempSync(path.join(tmpdir(),'proteus-saved-job-'));
  try{
    const input=path.join(root,'input.mp4'),work=path.join(root,'worker'),mock=path.join(root,'saved-video.mp4'),log=path.join(root,'generations.log');
    execFileSync(ffmpeg,['-v','error','-f','lavfi','-i','testsrc2=s=64x48:r=25:d=1','-f','lavfi','-i','sine=frequency=440:duration=1','-c:v','libx264','-c:a','aac',input]);
    const base=['--import','tsx','--import','./tests/fixtures/provider-hooks.mjs','src/index.ts','--input',input,'--start','0','--end','1'];
    const options={encoding:'utf8' as const,env:{...process.env,AI_GATEWAY_API_KEY:'offline-test',BLOB_READ_WRITE_TOKEN:'offline-test',MOCK_CREDIT_BALANCE:'0',MOCK_GENERATION_LOG:log,MOCK_RESUME_VIDEO_FILE:mock}};
    execFileSync(process.execPath,[...base,'--work-dir',work,'--dry-run'],options);
    execFileSync(ffmpeg,['-v','error','-i',path.join(work,'segment.mp4'),'-an','-vf','scale=320:240','-c:v','libx264','-crf','0',mock]);
    writeFileSync(path.join(work,'job.json'),JSON.stringify({model:'topaz/starlight-precise-2.6',operation:{jobId:'already-paid'},jobId:'already-paid'}));
    const stdout=execFileSync(process.execPath,[...base,'--resume',work],options);
    assert.match(stdout,/Resuming saved Gateway job/);
    assert.throws(()=>readFileSync(log));assert.throws(()=>readFileSync(path.join(work,'upload.json')));
    const info=JSON.parse(execFileSync(ffprobe,['-v','error','-count_frames','-show_streams','-of','json',path.join(work,'restored.mp4')],{encoding:'utf8'}));
    assert.equal(Number(info.streams.find((s:any)=>s.codec_type==='video').nb_read_frames),25);
    assert.ok(info.streams.some((s:any)=>s.codec_type==='audio'));
  }finally{rmSync(root,{recursive:true,force:true});}
});
