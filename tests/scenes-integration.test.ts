import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync,unlinkSync,mkdirSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),ffmpeg=require('ffmpeg-static'),ffprobe=require('ffprobe-static').path;
test('local cut detection, resumable scene queue and original-audio assembly work end to end',()=>{
  const root=mkdtempSync(path.join(tmpdir(),'proteus-scenes-test-'));const batch=path.join(root,'batch');const input=path.join(root,'edits.mp4');
  const log=path.join(root,'calls.log');
  try{
    execFileSync(ffmpeg,['-v','error','-f','lavfi','-i','color=black:s=64x48:r=25:d=1.2','-f','lavfi','-i','color=white:s=64x48:r=25:d=1.6',
      '-f','lavfi','-i','color=red:s=64x48:r=25:d=1.4','-f','lavfi','-i','aevalsrc=0.2*sin(2*PI*(220*t+50*t*t)):s=48000:d=4.2',
      '-filter_complex','[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]','-map','[v]','-map','3:a','-c:v','libx264','-c:a','aac',input]);
    const options={encoding:'utf8' as const,env:{...process.env,AI_GATEWAY_API_KEY:'offline-test',BLOB_READ_WRITE_TOKEN:'offline-test',MOCK_GENERATION_LOG:log},maxBuffer:16*1024*1024};
    const cli=(...args:string[])=>execFileSync(process.execPath,['--import','tsx','--import','./tests/fixtures/provider-hooks.mjs','src/scenes.ts',...args],options);
    const split=cli('split','--input',input,'--queue',batch,'--max-seconds','1','--threshold','0.2');
    const queue=()=>JSON.parse(readFileSync(path.join(batch,'queue.json'),'utf8'));
    assert.match(split,/No uploads or generations made/);assert.deepEqual(queue().detectedCuts,[30,70]);assert.equal(queue().frames,105);assert.equal(queue().jobs.length,6);
    assert.throws(()=>readFileSync(log));
    cli('run','--queue',batch);assert.equal(queue().jobs.filter((j:any)=>j.state==='completed').length,1);
    cli('run','--queue',batch,'--clips','3');
    assert.equal(queue().jobs[2].state,'completed');assert.equal(queue().jobs[1].state,'pending');
    assert.equal(queue().jobs.filter((j:any)=>j.state==='completed').length,2);
    cli('run','--queue',batch,'--all');assert.equal(queue().state,'processed');
    const count=readFileSync(log,'utf8').trim().split('\n').length;assert.equal(count,6);
    cli('run','--queue',batch,'--all');assert.equal(readFileSync(log,'utf8').trim().split('\n').length,count);
    cli('join','--queue',batch);assert.equal(queue().state,'assembled');
    const output=path.join(batch,'restored.mp4');
    const info=JSON.parse(execFileSync(ffprobe,['-v','error','-count_frames','-show_streams','-of','json',output],{encoding:'utf8'}));
    assert.equal(Number(info.streams.find((s:any)=>s.codec_type==='video').nb_read_frames),105);assert.ok(info.streams.some((s:any)=>s.codec_type==='audio'));
    const hashes=(file:string,filter:string[]=[])=>execFileSync(ffmpeg,['-v','error','-i',file,'-map','0:v:0',...filter,'-f','framemd5','-'],{encoding:'utf8'}).split('\n').filter(s=>s&&!s.startsWith('#')).map(s=>s.split(',').at(-1)?.trim());
    assert.deepEqual(hashes(output),hashes(path.join(batch,'master.mp4'),['-vf','scale=320:240']));
    const audioHash=(file:string)=>execFileSync(ffmpeg,['-v','error','-i',file,'-map','0:a:0','-c','copy','-f','hash','-'],{encoding:'utf8'});
    assert.equal(audioHash(output),audioHash(input));
    // A missing paid artifact is a hard stop, not an automatic paid regeneration.
    unlinkSync(path.join(batch,queue().jobs[0].output));
    assert.throws(()=>cli('run','--queue',batch,'--all'));
    assert.equal(readFileSync(log,'utf8').trim().split('\n').length,count);
    // Import a previously paid prefix across scene boundaries without generation.
    const old=path.join(root,'paid-run');mkdirSync(old);
    execFileSync(ffmpeg,['-v','error','-i',input,'-t','2.4','-vf','scale=320:240','-c:v','libx264','-crf','0','-c:a','aac',path.join(old,'restored.mp4')]);
    writeFileSync(path.join(old,'settings.json'),JSON.stringify({input,start:0,end:2.4,model:'topaz/starlight-precise-2.6',resolution:'320x240',providerOptions:{topaz:{source:{frameRate:25,frameCount:60}}}}));
    const reused=path.join(root,'reused');
    cli('split','--input',input,'--queue',reused,'--max-seconds','1','--threshold','0.2','--reuse-run',old);
    const imported=()=>JSON.parse(readFileSync(path.join(reused,'queue.json'),'utf8'));
    assert.equal(imported().jobs.filter((j:any)=>j.reused).reduce((n:number,j:any)=>n+j.endFrame-j.startFrame,0),60);
    assert.equal(readFileSync(log,'utf8').trim().split('\n').length,count);
    assert.throws(()=>execFileSync(process.execPath,['--import','tsx','--import','./tests/fixtures/provider-hooks.mjs','src/scenes.ts','run','--queue',reused],{
      ...options,env:{...options.env,MOCK_CREDIT_BALANCE:'0'},stdio:'pipe',
    }));
    assert.equal(imported().state,'paused');
    assert.equal(readFileSync(log,'utf8').trim().split('\n').length,count);
    cli('run','--queue',reused,'--all');cli('join','--queue',reused);
    assert.deepEqual(hashes(path.join(reused,'restored.mp4')),hashes(path.join(reused,'master.mp4'),['-vf','scale=320:240']));
    assert.equal(audioHash(path.join(reused,'restored.mp4')),audioHash(input));
    assert.equal(readFileSync(log,'utf8').trim().split('\n').length-count,imported().jobs.filter((j:any)=>!j.reused).length);
  }finally{rmSync(root,{recursive:true,force:true});}
});

test('fractional source FPS survives scene batching with unchanged video frames and continuous audio',()=>{
  const root=mkdtempSync(path.join(tmpdir(),'proteus-scenes-fractional-'));
  try{
    const input=path.join(root,'fractional.mp4'),batch=path.join(root,'batch'),log=path.join(root,'calls.log');
    execFileSync(ffmpeg,['-v','error','-f','lavfi','-i','testsrc2=s=64x48:r=25000/1001:d=2.002','-f','lavfi','-i','sine=frequency=440:duration=2.002','-c:v','libx264','-c:a','aac',input]);
    const options={encoding:'utf8' as const,env:{...process.env,AI_GATEWAY_API_KEY:'offline-test',BLOB_READ_WRITE_TOKEN:'offline-test',MOCK_GENERATION_LOG:log},maxBuffer:16*1024*1024};
    const cli=(...args:string[])=>execFileSync(process.execPath,['--import','tsx','--import','./tests/fixtures/provider-hooks.mjs','src/scenes.ts',...args],options);
    cli('split','--input',input,'--queue',batch,'--end','2.002','--threshold','0.9','--max-seconds','1');
    cli('run','--queue',batch,'--all');cli('join','--queue',batch);
    const q=JSON.parse(readFileSync(path.join(batch,'queue.json'),'utf8'));assert.equal(q.frames,50);
    const output=path.join(batch,'restored.mp4');
    const timing=JSON.parse(execFileSync(ffprobe,['-v','error','-show_streams','-of','json',output],{encoding:'utf8'}));
    const video=timing.streams.find((s:any)=>s.codec_type==='video');
    assert.equal(video.avg_frame_rate,'25000/1001');
    assert.ok(Math.abs(Number(video.start_time))<0.001);
    assert.ok(Math.abs(Number(video.duration)-2.002)<0.001);
    const checks=(file:string,filter:string[]=[])=>execFileSync(ffmpeg,['-v','error','-i',file,'-map','0:v:0',...filter,'-f','framemd5','-'],{encoding:'utf8'}).split('\n').filter(s=>s&&!s.startsWith('#')).map(s=>s.split(',').at(-1)?.trim());
    assert.deepEqual(checks(output),checks(path.join(batch,'master.mp4'),['-vf','scale=320:240']));
    assert.ok(q.jobs.every((j:any)=>j.endFrame-j.startFrame<=24));
  }finally{if(process.env.KEEP_SCENE_TEST)console.log('Preserved fractional fixture:',root);else rmSync(root,{recursive:true,force:true});}
});
