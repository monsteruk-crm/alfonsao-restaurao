import { config } from 'dotenv';
import { experimental_getVideoStatus as getVideoStatus } from 'ai';
import { setTimeout as delay } from 'node:timers/promises';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdir, mkdtemp, readFile, readdir, rename, rm, stat, copyFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { parseArgs } from 'node:util';
import { SETTINGS } from './settings.js';
import { scenePlan, detectedCuts, type SceneRange } from './scene-plan.js';
import { outputDimensions } from './resolution.js';
import { exec, exists, ffmpeg, jsonFile, probe, rate, verifyVideo } from './media.js';
import { sanitize } from './diagnostics.js';
config({quiet:true});
process.env.AI_GATEWAY_API_KEY ||= process.env.VERCEL_API_KEY;
const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const restoreScript=path.join(project,'src/index.ts');
type Job=SceneRange & { input:string; output:string; work:string; state:'pending'|'running'|'completed'|'failed';
  sha256?:string; inputSha256?:string; childPid?:number; error?:string; reused?:boolean; completedAt?:string };
type Coverage={file:string; startFrame:number; endFrame:number; fileStartFrame:number};
type Queue={version:1; input:string; inputSha256:string; start:number; end:number; fps:number; fpsExpression:string;
  frames:number; width:number; height:number; outputWidth:number; outputHeight:number; hasAudio:boolean;
  master:string; masterSha256?:string; settings:typeof SETTINGS; threshold:number; maxSeconds:number; detectedCuts:number[];
  jobs:Job[]; state:string; createdAt:string; updatedAt:string; coverage:Coverage[]; final?:string; finalSha256?:string};
async function hash(file:string){const h=createHash('sha256');for await(const data of createReadStream(file))h.update(data);return h.digest('hex');}
const relativeJob=(index:number)=>String(index).padStart(5,'0');
async function load(root:string):Promise<Queue>{
  const q:Queue=JSON.parse(await readFile(path.join(root,'queue.json'),'utf8'));
  if(q.version!==1||!Number.isSafeInteger(q.frames)||q.frames<1||!Number.isFinite(q.fps)||q.fps<=0||!q.jobs?.length)throw new Error('Invalid queue metadata.');
  let next=0;
  for(const [i,j] of q.jobs.entries()){
    if(j.index!==i+1||j.startFrame!==next||!Number.isSafeInteger(j.endFrame)||j.endFrame<=j.startFrame||j.endFrame>q.frames)throw new Error('Queue frame ranges are reordered, overlapping or incomplete.');
    next=j.endFrame;
    for(const file of [j.input,j.output,j.work,q.master])if(path.isAbsolute(file)||file.split(/[\\/]/).includes('..'))throw new Error('Queue artifact paths must remain inside the queue directory.');
  }
  if(next!==q.frames)throw new Error('Queue does not cover all source frames.');
  return q;
}
async function save(root:string,q:Queue){q.updatedAt=new Date().toISOString();await jsonFile(path.join(root,'queue.json'),q);}
async function validOutput(root:string,q:Queue,j:Job){
  const file=path.join(root,j.output);
  if(!await exists(file))return false;
  if(j.sha256) return await hash(file)===j.sha256;
  await verifyVideo(file,j.endFrame-j.startFrame,q.fps,q.outputWidth,q.outputHeight);
  return true;
}
function alive(pid:number){try{process.kill(pid,0);return true;}catch(e:any){return e.code==='EPERM';}}
async function locked<T>(root:string,fn:()=>Promise<T>){
  const lock=path.join(root,'.queue-lock');
  try{await mkdir(lock);}catch(e:any){
    if(e.code!=='EEXIST')throw e;
    let owner:any;
    try { owner=JSON.parse(await readFile(path.join(lock,'owner.json'),'utf8')); }
    catch { throw new Error('Queue lock is initializing or incomplete; do not start another worker.'); }
    if(owner.host && owner.host!==os.hostname())throw new Error('Queue lock belongs to another host; inspect it before recovery.');
    if(owner.pid && alive(owner.pid))throw new Error(`Queue already in use by PID ${owner.pid}.`);
    const q=await load(root);
    if(q.jobs.some(j=>j.childPid&&alive(j.childPid)))throw new Error('A saved worker PID is still alive. Do not start another worker.');
    await rm(lock,{recursive:true});await mkdir(lock);
  }
  await jsonFile(path.join(lock,'owner.json'),{pid:process.pid,host:os.hostname(),createdAt:new Date().toISOString()});
  try{return await fn();}finally{await rm(lock,{recursive:true,force:true});}
}
async function segmentVideo(input:string,ranges:SceneRange[],fps:number,root:string,pattern:string,startFrame=0){
  if(!ranges.length)return;
  const boundaries=ranges.slice(1).map(j=>j.startFrame-startFrame);
  const last=ranges.at(-1)!.endFrame;
  const filters=`trim=start_frame=${startFrame}:end_frame=${last},setpts=PTS-STARTPTS`;
  const args=['-hide_banner','-loglevel','error','-nostdin','-y','-i',input,'-map','0:v:0','-an','-vf',filters,
    '-r',String(fps),'-fps_mode','cfr','-c:v','libx264','-crf','0','-preset','fast'];
  if(boundaries.length)args.push('-force_key_frames',boundaries.map(n=>(n/fps).toFixed(9)).join(','));
  args.push('-f','segment','-segment_format','mp4','-reset_timestamps','1','-segment_start_number','0');
  if(boundaries.length)args.push('-segment_frames',boundaries.join(','));
  else args.push('-segment_time',String((last-startFrame)/fps+1));
  args.push(path.join(root,pattern));
  await exec(ffmpeg,args,{maxBuffer:8*1024*1024});
}
async function attachAudio(video:string,master:string,start:number,duration:number,hasAudio:boolean,output:string){
  const partial=output.replace(/\.mp4$/,'.partial.mp4');
  await exec(ffmpeg,['-v','error','-nostdin','-y','-i',video,'-ss',String(start),'-t',String(duration),'-i',master,
    '-map','0:v:0',...(hasAudio?['-map','1:a:0']:['-an']),'-c:v','copy','-c:a','aac','-b:a','192k','-t',String(duration),'-movflags','+faststart',partial]);
  await rename(partial,output);
}
async function coverageFromRun(runDir:string,input:string,start:number,fps:number,outputWidth:number,outputHeight:number):Promise<Coverage[]>{
  const old=JSON.parse(await readFile(path.join(runDir,'settings.json'),'utf8'));
  if(path.resolve(old.input)!==input || old.model!==SETTINGS.model || old.resolution!==`${outputWidth}x${outputHeight}`)throw new Error('Paid run source/model/resolution differs from this scene queue.');
  const oldSource=old.providerOptions.topaz.source;
  if(Math.abs(oldSource.frameRate-fps)>1e-6)throw new Error('Paid run FPS differs.');
  const base=(old.start-start)*fps;
  if(Math.abs(base-Math.round(base))>1e-5)throw new Error('Paid run time range does not align to the new frame grid.');
  const result:Coverage[]=[];
  const ranges=old.chunks??[{startFrame:0,endFrame:oldSource.frameCount}];
  for(const [i,r] of ranges.entries()){
    const baseDir=ranges.length===1?runDir:path.join(runDir,`chunk-${String(i+1).padStart(4,'0')}`);
    const restored=path.join(baseDir,'restored.mp4');
    const file=await exists(restored)?restored:path.join(baseDir,'enhanced.mp4');
    if(!await exists(file))continue;
    const info=await verifyVideo(file,r.endFrame-r.startFrame,fps,outputWidth,outputHeight);
    if(!info.streams.some((s:any)=>s.codec_type==='video'))throw new Error('Paid output missing video.');
    result.push({file,startFrame:Math.round(base)+r.startFrame,endFrame:Math.round(base)+r.endFrame,fileStartFrame:Math.round(base)+r.startFrame});
  }
  return result;
}
async function split(values:any){
  if(!values.input)throw new Error('split requires --input VIDEO');
  const input=path.resolve(values.input);const source=await probe(input);
  const v=source.streams.find((s:any)=>s.codec_type==='video');if(!v)throw new Error('No video stream.');
  const fps=rate(v.avg_frame_rate);if(!Number.isFinite(fps)||fps<=0)throw new Error('Invalid frame rate.');
  const start=Number(values.start??0),end=Number(values.end??source.format.duration);
  const threshold=Number(values.threshold??.3),maxSeconds=Number(values['max-seconds']??15);
  if(![start,end,threshold,maxSeconds].every(Number.isFinite)||start<0||end<=start||end>Number(source.format.duration)+.01||threshold<=0||threshold>=1||maxSeconds<=0)throw new Error('Invalid selection, scene threshold (0–1), or clip duration cap.');
  const parent=path.resolve('outputs/scenes');await mkdir(parent,{recursive:true});
  const root=values.queue?path.resolve(values.queue):await mkdtemp(path.join(parent,path.basename(input,path.extname(input)).replace(/[^a-zA-Z0-9_-]/g,'_')+'-'));
  if(values.queue)await mkdir(root); // Never overwrite an existing batch.
  console.log(`Scene queue directory: ${root}`);
  for(const folder of ['clips','processed','work','temporary'])await mkdir(path.join(root,folder));
  const master=path.join(root,'master.mp4');
  console.log('Preparing a lossless CFR video master and copying the source soundtrack (local only)...');
  await exec(ffmpeg,['-v','error','-nostdin','-n','-ss',String(start),'-i',input,'-t',String(end-start),'-map','0:v:0','-map','0:a?',
    '-vf','scale=trunc(iw*sar/2)*2:trunc(ih/2)*2,setsar=1','-r',String(fps),'-fps_mode','cfr','-c:v','libx264','-crf','0','-preset','fast','-c:a','copy',master],{maxBuffer:8*1024*1024});
  const info=await probe(master,true);const mv=info.streams.find((s:any)=>s.codec_type==='video');const frames=Number(mv.nb_read_frames);
  if(!Number.isSafeInteger(frames)||frames<1)throw new Error('Invalid prepared frame count.');
  const size=outputDimensions(mv.width,mv.height,SETTINGS.scale,SETTINGS.maxLongEdge);
  console.log('Detecting edit cuts using FFmpeg scene-change scores...');
  const detection=await exec(ffmpeg,['-hide_banner','-loglevel','info','-i',master,'-map','0:v:0','-an','-vf',`select=gt(scene\\,${threshold}),showinfo`,'-f','null','-'],{maxBuffer:32*1024*1024});
  const cuts=detectedCuts(detection.stderr,fps,Number(mv.start_time??0));
  const coverage=values['reuse-run']?await coverageFromRun(path.resolve(values['reuse-run']),input,start,fps,size.width,size.height):[];
  const ranges=scenePlan(frames,cuts,Math.min(9000,Math.max(1,Math.floor(maxSeconds*fps))),coverage.flatMap(c=>[c.startFrame,c.endFrame]));
  const q:Queue={version:1,input,inputSha256:await hash(input),start,end,fps,fpsExpression:mv.avg_frame_rate,frames,width:mv.width,height:mv.height,
    outputWidth:size.width,outputHeight:size.height,hasAudio:info.streams.some((s:any)=>s.codec_type==='audio'),master:'master.mp4',masterSha256:await hash(master),settings:SETTINGS,
    threshold,maxSeconds,detectedCuts:cuts,coverage,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),state:'preparing',jobs:ranges.map(r=>({...r,
      input:`clips/${relativeJob(r.index)}.mp4`,output:`processed/${relativeJob(r.index)}.mp4`,work:`work/${relativeJob(r.index)}`,state:'pending'}))};
  await save(root,q);
  console.log(`Detected ${cuts.length} cuts; preparing ${q.jobs.length} clips, capped at ${maxSeconds}s / 9000 frames.`);
  await segmentVideo(master,ranges,fps,path.join(root,'temporary'),'split-%05d.mp4');
  for(const [i,j] of q.jobs.entries()){
    const raw=path.join(root,'temporary',`split-${String(i).padStart(5,'0')}.mp4`);
    await verifyVideo(raw,j.endFrame-j.startFrame,fps,q.width,q.height);
    await attachAudio(raw,master,j.startFrame/fps,(j.endFrame-j.startFrame)/fps,q.hasAudio,path.join(root,j.input));
    await verifyVideo(path.join(root,j.input),j.endFrame-j.startFrame,fps,q.width,q.height);
    j.inputSha256=await hash(path.join(root,j.input));
    await rm(raw);
    if((i+1)%10===0)console.log(`Prepared ${i+1}/${q.jobs.length} clips.`);
  }
  await jsonFile(path.join(root,'cuts.json'),{threshold,detectedFrameIndices:cuts,ranges});
  // Import paid coverage in one decode/encode pass per source, preserving decoded video losslessly.
  for(const [ci,c] of coverage.entries()){
    const jobs=q.jobs.filter(j=>j.startFrame>=c.startFrame&&j.endFrame<=c.endFrame);
    if(!jobs.length)continue;
    const shifted=jobs.map(j=>({...j,startFrame:j.startFrame-c.fileStartFrame,endFrame:j.endFrame-c.fileStartFrame}));
    console.log(`Reusing already-paid coverage for ${jobs.length} clips (local lossless cuts; no AI requests)...`);
    await segmentVideo(c.file,shifted,fps,path.join(root,'temporary'),`reuse-${ci}-%05d.mp4`,shifted[0]!.startFrame);
    for(const [k,j] of jobs.entries()){
      const raw=path.join(root,'temporary',`reuse-${ci}-${String(k).padStart(5,'0')}.mp4`);
      await attachAudio(raw,master,j.startFrame/fps,(j.endFrame-j.startFrame)/fps,q.hasAudio,path.join(root,j.output));
      await verifyVideo(path.join(root,j.output),j.endFrame-j.startFrame,fps,size.width,size.height);
      j.sha256=await hash(path.join(root,j.output));j.state='completed';j.reused=true;j.completedAt=new Date().toISOString();
      await save(root,q);await rm(raw);
      if((k+1)%10===0)console.log(`Imported ${k+1}/${jobs.length} already-paid clips.`);
    }
  }
  q.state='ready';await save(root,q);
  await writeFile(path.join(root,'scenes.csv'),'clip,scene,start_frame,end_frame_exclusive,start_seconds,end_seconds,reason,reused_paid_output\n'+q.jobs.map(j=>[j.index,j.scene,j.startFrame,j.endFrame,(j.startFrame/q.fps).toFixed(6),(j.endFrame/q.fps).toFixed(6),j.reason,!!j.reused].join(',')).join('\n')+'\n');
  console.log(`Prepared: ${root}\n${q.jobs.filter(j=>j.state==='completed').length}/${q.jobs.length} clips already restored from paid coverage. No uploads or generations made.`);
  console.log('Pricing is per output frame/resolution; splitting does not guarantee a lower bill. Review queue.json/cuts.json before processing.');
}
async function runQueue(root:string,values:any){await locked(root,async()=>{
  const q=await load(root);
  if(q.state==='preparing')throw new Error('Local scene preparation is incomplete. Do not process this queue.');
  if(q.state==='superseded')throw new Error('This preliminary queue was superseded. Use the replacement queue indicated in queue.json.');
  if(JSON.stringify(q.settings)!==JSON.stringify(SETTINGS))throw new Error('src/settings.ts differs from this queue snapshot; restore the saved settings before running.');
  if(values.all&&(values['max-jobs']!==undefined||values.clips))throw new Error('Use --all by itself, or select a bounded batch.');
  const selected: Set<number> | undefined = values.clips ? new Set(String(values.clips).split(',').map(Number)) : undefined;
  if(selected && [...selected].some(index=>!Number.isSafeInteger(index)||index<1||index>q.jobs.length))throw new Error('--clips must be a comma-separated list of existing clip IDs.');
  const limit=values.all?Infinity:Number(values['max-jobs']??selected?.size??1);
  if(!values.all&&(!Number.isSafeInteger(limit)||limit<1))throw new Error('--max-jobs must be a positive integer.');
  let processed=0;
  for(const j of q.jobs){
    if(selected && !selected.has(j.index))continue;
    if(j.state==='completed'){
      if(!await validOutput(root,q,j))throw new Error(`Completed output changed/missing: ${j.output}. Refusing to regenerate a paid clip automatically.`);
      continue;
    }
    if(processed>=limit)break;
    if(j.childPid&&alive(j.childPid))throw new Error(`Clip ${j.index} still has a live worker PID ${j.childPid}.`);
    if(j.inputSha256&&await hash(path.join(root,j.input))!==j.inputSha256)throw new Error(`Scene input changed: ${j.input}.`);
    const work=path.join(root,j.work);await mkdir(path.dirname(work),{recursive:true});
    if(values['retry-failed']&&j.state==='failed'&&await exists(path.join(work,'job.json'))) {
      const saved=JSON.parse(await readFile(path.join(work,'job.json'),'utf8'));
      const remote=await getVideoStatus(saved.model,{operation:saved.operation,maxRetries:0,abortSignal:AbortSignal.timeout(30000)});
      if(remote.status==='error') {
        const stamp=Date.now();
        await rename(path.join(work,'job.json'),path.join(work,`job.terminal-failure-${stamp}.json`));
        if(await exists(path.join(work,'generation-key.txt')))await rename(path.join(work,'generation-key.txt'),path.join(work,`generation-key.terminal-failure-${stamp}.txt`));
        console.log(`Explicit retry of confirmed failed clip ${j.index}; a new paid request may be submitted.`);
      } else console.log(`Saved clip ${j.index} is ${remote.status}; reusing its existing job rather than submitting another.`);
    }
    const args=['--import','tsx',...process.execArgv,restoreScript,'--lossless-input','--input',path.join(root,j.input),'--start','0','--end',String((j.endFrame-j.startFrame)/q.fps),
      ...(await exists(path.join(work,'settings.json'))?['--resume',work]:['--work-dir',work])];
    j.state='running';delete j.error;q.state='running';await save(root,q);
    console.log(`Queue clip ${j.index}/${q.jobs.length}; scene ${j.scene}; ${(j.endFrame-j.startFrame)/q.fps}s; completed ${q.jobs.filter(j=>j.state==='completed').length}.`);
    const child=spawn(process.execPath,args,{cwd:project,env:process.env,stdio:['ignore','pipe','pipe']});
    const exited=new Promise<number|null>((resolve,reject)=>{child.on('error',reject);child.on('close',resolve);});
    j.childPid=child.pid;await save(root,q);
    let stderr='';child.stdout.on('data',data=>process.stdout.write(data));child.stderr.on('data',data=>{process.stderr.write(data);stderr=(stderr+data.toString()).slice(-4000);});
    const exit=await exited;
    delete j.childPid;
    if(exit!==0){j.state='failed';j.error=String(sanitize(stderr||`Worker exited ${exit}`));q.state='paused';await save(root,q);throw new Error(`Queue paused at clip ${j.index}; completed outputs and active job references retained. See its work directory. ${j.error}`);}
    const result=path.join(work,'restored.mp4');
    await verifyVideo(result,j.endFrame-j.startFrame,q.fps,q.outputWidth,q.outputHeight);
    await copyFile(result,path.join(root,j.output)+'.partial');await rename(path.join(root,j.output)+'.partial',path.join(root,j.output));
    j.sha256=await hash(path.join(root,j.output));j.state='completed';j.completedAt=new Date().toISOString();processed++;await save(root,q);
  }
  q.state=q.jobs.every(j=>j.state==='completed')?(q.final?'assembled':'processed'):'ready';await save(root,q);
  console.log(`Queue: ${q.jobs.filter(j=>j.state==='completed').length}/${q.jobs.length} restored. Run scenes:join when all clips are complete.`);
});}
async function status(root:string){
  const q=await load(root);console.log(`Queue: ${q.state}; ${q.jobs.filter(j=>j.state==='completed').length}/${q.jobs.length} completed; ${q.frames} frames; ${q.frames/q.fps}s.`);
  const ownerFile=path.join(root,'.queue-lock','owner.json');
  if(await exists(ownerFile)){const owner=JSON.parse(await readFile(ownerFile,'utf8'));console.log(`Queue worker PID ${owner.pid}: ${alive(owner.pid)?'alive':'not running; saved state may be stale'}.`);}
  else if(q.state==='running'||q.state==='joining')console.log('No active queue lock; this is saved state, not proof of a running worker.');
  for(const j of q.jobs.filter(j=>j.state!=='pending')){
    console.log(`${relativeJob(j.index)} scene=${j.scene} frames=${j.startFrame}–${j.endFrame-1} state=${j.state}${j.reused?' (reused paid coverage)':''}`);
    const diagnostics=path.join(root,j.work,'diagnostics.json');if(await exists(diagnostics)){
      const d=JSON.parse(await readFile(diagnostics,'utf8'));console.log(`  stage=${d.stage}; Gateway=${d.gatewayStatus??'—'}; last response=${d.lastResponseAt??'—'}; job=${d.jobId??'—'}`);
    }
    if(j.error)console.log(`  ${j.error}`);
  }
}
async function join(root:string){await locked(root,async()=>{
  const q=await load(root);
  if(!q.masterSha256 || await hash(path.join(root,q.master))!==q.masterSha256)throw new Error('Original soundtrack/video master is missing, changed, or lacks its integrity hash. Refusing assembly.');
  for(const j of q.jobs)if(j.state!=='completed'||!await validOutput(root,q,j))throw new Error(`Clip ${j.index} is incomplete or changed. Nothing joined; no AI requests made.`);
  const final=path.join(root,'restored.mp4');
  if(await exists(final)){if(q.finalSha256&&await hash(final)===q.finalSha256){console.log(`Already assembled: ${final}`);return;}throw new Error('Existing final output differs; refusing to overwrite it.');}
  q.state='joining';await save(root,q);
  const infos=await Promise.all(q.jobs.map(j=>probe(path.join(root,j.output))));
  const signature=(info:any)=>{const v=info.streams.find((s:any)=>s.codec_type==='video');return JSON.stringify([v.codec_name,v.width,v.height,v.pix_fmt,v.avg_frame_rate,v.sample_aspect_ratio,v.time_base]);};
  const homogeneous=infos.every(info=>signature(info)===signature(infos[0]));
  const files:string[]=[];
  await mkdir(path.join(root,'join-cache'),{recursive:true});
  if(!homogeneous){
    if(infos.some(info=>info.streams.find((s:any)=>s.codec_type==='video').pix_fmt!=='yuv420p'))throw new Error('Mixed-format join cache currently supports 8-bit yuv420p only. Paid outputs are preserved; no automatic precision reduction.');
    console.log('Mixed provider codecs/pixel formats: normalizing a local lossless H.264 join cache. Paid outputs remain unchanged.');

    for(const j of q.jobs){const rel=`join-cache/${relativeJob(j.index)}.mp4`;const file=path.join(root,rel);
      await exec(ffmpeg,['-v','error','-nostdin','-y','-i',path.join(root,j.output),'-map','0:v:0','-an','-c:v','libx264','-crf','0','-preset','fast','-pix_fmt','yuv420p','-r',String(q.fps),'-vf','setsar=1',file]);files.push(rel);}
  } else {
    // Drop preview AAC tracks before concatenation so priming/padding never offsets video.
    for(const j of q.jobs){const rel=`join-cache/${relativeJob(j.index)}.mp4`;
      await exec(ffmpeg,['-v','error','-nostdin','-y','-i',path.join(root,j.output),'-map','0:v:0','-an','-c:v','copy',path.join(root,rel)]);files.push(rel);
    }
  }
  await jsonFile(path.join(root,'join-inputs.json'),files);
  const list=path.join(root,'join.txt');await writeFile(list,files.map((file,i)=>`file '${file}'\nduration ${((q.jobs[i]!.endFrame-q.jobs[i]!.startFrame)/q.fps).toFixed(9)}`).join('\n')+'\n');
  const partial=path.join(root,'restored.partial.mp4');
  await exec(ffmpeg,['-v','error','-nostdin','-y','-f','concat','-safe','1','-i',list,'-i',path.join(root,q.master),'-map','0:v:0','-map','1:a?','-c','copy','-movflags','+faststart',partial]);
  const verified=await verifyVideo(partial,q.frames,q.fps,q.outputWidth,q.outputHeight);
  if(q.hasAudio&&!verified.streams.some((s:any)=>s.codec_type==='audio'))throw new Error('Final soundtrack missing.');
  // Verify original compressed audio packets survived final muxing unchanged.
  if(q.hasAudio){
    for(const stream of verified.streams.filter((s:any)=>s.codec_type==='audio')){
      const index=verified.streams.filter((s:any)=>s.codec_type==='audio').indexOf(stream);
      const checksum=async(file:string)=>(await exec(ffmpeg,['-v','error','-i',file,'-map',`0:a:${index}`,'-c','copy','-f','hash','-'])).stdout.trim();
      if(await checksum(partial)!==await checksum(path.join(root,q.master)))throw new Error('Final soundtrack packet hash differs from the original selected soundtrack.');
    }
  }
  await rename(partial,final);q.final='restored.mp4';q.finalSha256=await hash(final);q.state='assembled';await save(root,q);
  console.log(`Assembled ${q.frames} frames with the original continuous soundtrack: ${final}`);
});}
async function main(){
  const command=process.argv[2];const {values}=parseArgs({args:process.argv.slice(3),options:{
    input:{type:'string'},queue:{type:'string'},start:{type:'string'},end:{type:'string'},threshold:{type:'string'},'max-seconds':{type:'string'},
    'reuse-run':{type:'string'},'max-jobs':{type:'string'},clips:{type:'string'},all:{type:'boolean'},'retry-failed':{type:'boolean'},watch:{type:'boolean'},help:{type:'boolean'},
  }});
  if(values.help||!command){console.log('Scene workflow: split --input VIDEO [--start S --end S --threshold 0.3 --max-seconds 15 --reuse-run DIR --queue NEW-DIR]; run --queue DIR [--clips 49,120 | --max-jobs N | --all]; status --queue DIR [--watch]; join --queue DIR. Split/join/status are local and never generate. Run defaults to one new clip.');return;}
  if(command==='split')return split(values);
  if(!values.queue)throw new Error('--queue DIR is required.');const root=path.resolve(values.queue);
  if(command==='run')return runQueue(root,values);if(command==='status'){
    do { await status(root); const q=await load(root);
      if(!values.watch||['paused','processed','assembled'].includes(q.state))return;
      await delay(15000);
    }while(true);
  }if(command==='join')return join(root);
  throw new Error(`Unknown scene command: ${command}`);
}
main().catch(error=>{console.error(`Scene workflow stopped: ${sanitize(error instanceof Error?error.message:String(error))}`);process.exitCode=1;});
