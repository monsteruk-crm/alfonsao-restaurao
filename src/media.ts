import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { access, rename, writeFile } from 'node:fs/promises';
const require=createRequire(import.meta.url);
export const ffmpeg: string=process.env.FFMPEG_PATH || require('ffmpeg-static');
export const ffprobe: string=process.env.FFPROBE_PATH || require('ffprobe-static').path;
export const exec=promisify(execFile);
export async function exists(file:string){try{await access(file);return true;}catch{return false;}}
export async function jsonFile(file:string,value:unknown){const tmp=file+'.partial';await writeFile(tmp,JSON.stringify(value,null,2)+'\n',{mode:0o600});await rename(tmp,file);}
export async function probe(file:string,count=false):Promise<any>{
  const {stdout}=await exec(ffprobe,['-v','error',...(count?['-count_frames']:[]),'-show_streams','-show_format','-of','json',file],{maxBuffer:16*1024*1024});return JSON.parse(stdout);
}
export function rate(value:string){const [a,b]=value.split('/').map(Number);return a!/(b??1);}
export async function verifyVideo(file:string,frames:number,fps:number,width?:number,height?:number){
  const info=await probe(file,true);const v=info.streams.find((s:any)=>s.codec_type==='video');
  if(!v || Number(v.nb_read_frames)!==frames || (width&&v.width!==width)||(height&&v.height!==height))throw new Error(`Video verification failed: ${file}`);
  const duration=Number(v.duration ?? info.format.duration);
  if(!Number.isFinite(duration)||Math.abs(duration-frames/fps)>Math.max(.25,2/fps))throw new Error(`Video duration mismatch: ${file}`);
  return info;
}
