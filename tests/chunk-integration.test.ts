import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ffmpeg = require('ffmpeg-static');
const ffprobe = require('ffprobe-static').path;

test('offline CLI splits, assembles all frames with audio, and resumes completed chunks', () => {
  const temporary = mkdtempSync(path.join(tmpdir(), 'proteus-chunks-'));
  let directory: string | undefined;
  try {
    const input = path.join(temporary, 'input.mp4');
    const log = path.join(temporary, 'generation.log');
    execFileSync(ffmpeg, ['-v','error','-f','lavfi','-i','testsrc2=size=64x48:rate=25:duration=4.2',
      '-f','lavfi','-i','aevalsrc=0.2*sin(2*PI*(220*t+50*t*t)):s=48000:d=4.2','-c:v','libx264','-c:a','aac','-shortest',input]);
    const args = ['--import','tsx','--import','./tests/fixtures/provider-hooks.mjs','src/index.ts',
      '--input',input,'--start','0','--end','4.2','--max-chunk-frames','40'];
    const options = {encoding:'utf8' as const, env:{...process.env,AI_GATEWAY_API_KEY:'offline-test',
      BLOB_READ_WRITE_TOKEN:'offline-test',MOCK_GENERATION_LOG:log},maxBuffer:8*1024*1024};
    const stdout = execFileSync(process.execPath, args, options);
    directory = stdout.match(/Working directory: (.+)/)![1]!;
    const output = path.join(directory, 'restored.mp4');
    const meta = JSON.parse(execFileSync(ffprobe,['-v','error','-count_frames','-show_streams','-of','json',output],{encoding:'utf8'}));
    assert.equal(Number(meta.streams.find((s: any) => s.codec_type === 'video').nb_read_frames),105);
    assert.ok(meta.streams.some((s: any) => s.codec_type === 'audio'));
    const calls=readFileSync(log,'utf8').trim().split('\n').map(s=>JSON.parse(s));
    assert.deepEqual(calls.map(s=>s.frames),[40,40,25]);
    // Compare every decoded frame to an independently scaled full segment.
    function hashes(file: string, filters: string[] = []) {
      return execFileSync(ffmpeg,['-v','error','-i',file,'-map','0:v:0',...filters,'-f','framemd5','-'],{encoding:'utf8'})
        .split('\n').filter(s=>s&&!s.startsWith('#')).map(s=>s.split(',').at(-1)?.trim());
    }
    assert.deepEqual(hashes(output),hashes(path.join(directory,'segment.mp4'),['-vf','scale=320:240']));
    const audioPcm = (file: string) => execFileSync(ffmpeg,['-v','error','-i',file,'-map','0:a:0','-ac','1','-ar','48000','-f','f32le','-']);
    const fullAudio = audioPcm(path.join(directory,'segment.mp4'));
    for (const [index, count] of [40,40,25].entries()) {
      const chunkOutput = path.join(directory,`chunk-${String(index+1).padStart(4,'0')}`,'restored.mp4');
      const chunkMeta = JSON.parse(execFileSync(ffprobe,['-v','error','-show_streams','-of','json',chunkOutput],{encoding:'utf8'}));
      const audio = chunkMeta.streams.find((s: any) => s.codec_type === 'audio');
      assert.ok(audio, 'each independently playable chunk must have audio');
      assert.ok(Math.abs(Number(audio.duration)-count/25)<0.05);
      const samples = audioPcm(chunkOutput);
      const offset = index*40/25*48000;
      const n = Math.min(samples.length/4,fullAudio.length/4-offset);
      let xy=0,xx=0,yy=0;
      for(let i=2048;i<n-2048;i++) {
        const x=samples.readFloatLE(i*4),y=fullAudio.readFloatLE((offset+i)*4);
        xy+=x*y;xx+=x*x;yy+=y*y;
      }
      assert.ok(xy/Math.sqrt(xx*yy)>0.98,'chunk audio must match the correct position of the varying source soundtrack');
    }
    // Simulate an old silent completed chunk. Recovery must attach source audio locally.
    const firstChunk=path.join(directory,'chunk-0001');
    const silent=path.join(firstChunk,'silent.mp4');
    execFileSync(ffmpeg,['-v','error','-i',path.join(firstChunk,'restored.mp4'),'-map','0:v:0','-c','copy',silent]);
    unlinkSync(path.join(firstChunk,'restored.mp4'));
    const {renameSync}=require('node:fs');renameSync(silent,path.join(firstChunk,'restored.mp4'));
    // Simulate interruption before final assembly: all completed chunks must be reused.
    unlinkSync(output);
    const resumed=execFileSync(process.execPath,[...args,'--resume',directory],options);
    assert.match(resumed,/Repairing saved enhanced chunk/);
    assert.match(resumed,/Reusing verified completed chunk/);
    assert.ok(audioPcm(path.join(firstChunk,'restored.mp4')).length>1000);
    assert.equal(readFileSync(log,'utf8').trim().split('\n').length,3);
    assert.deepEqual(hashes(output),hashes(path.join(directory,'segment.mp4'),['-vf','scale=320:240']));
    // Even with zero credits, saved enhanced video must be recoverable without a new request.
    unlinkSync(path.join(firstChunk,'restored.mp4'));
    // Empty credit balance must stop before uploading/generating a missing chunk.
    unlinkSync(output);
    rmSync(path.join(directory,'chunk-0002'),{recursive:true});
    rmSync(path.join(directory,'chunk-0003'),{recursive:true});
    assert.throws(() => execFileSync(process.execPath,[...args,'--resume',directory],{
      ...options,env:{...options.env,MOCK_CREDIT_BALANCE:'0'},stdio:'pipe',
    }));
    const pause=JSON.parse(readFileSync(path.join(directory,'run-status.json'),'utf8'));
    assert.equal(pause.status,'paused-for-credits');
    assert.ok(audioPcm(path.join(firstChunk,'restored.mp4')).length>1000);
    assert.equal(readFileSync(log,'utf8').trim().split('\n').length,3);
    assert.throws(()=>readFileSync(path.join(directory,'chunk-0002','upload.json')));
    const local=execFileSync(process.execPath,[...args,'--resume',directory,'--local-only'],options);
    assert.match(local,/Local recovery stopped before chunk 2/);
    assert.equal(readFileSync(log,'utf8').trim().split('\n').length,3);
    // A provider-side balance rejection after preflight must be paused and its failed key archived.
    assert.throws(() => execFileSync(process.execPath,[...args,'--resume',directory],{
      ...options,env:{...options.env,MOCK_PROVIDER_CREDIT_FAILURE:'1'},stdio:'pipe',
    }));
    const chunkTwo=path.join(directory,'chunk-0002');
    assert.throws(()=>readFileSync(path.join(chunkTwo,'generation-key.txt')));
    assert.ok(require('node:fs').readdirSync(chunkTwo).some((s: string)=>s.startsWith('generation-key.credit-rejected-')));
    assert.equal(JSON.parse(readFileSync(path.join(directory,'run-status.json'),'utf8')).status,'paused-for-credits');
    assert.equal(readFileSync(log,'utf8').trim().split('\n').length,3);
  } finally {
    rmSync(temporary,{recursive:true,force:true});
    if(directory) rmSync(directory,{recursive:true,force:true});
  }
});
