// Used only by the offline subprocess integration test. No network requests.
import { readFile, appendFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
export async function put(name, stream) {
  stream.destroy();
  return {url: `https://test.invalid/${Buffer.from(String(stream.path)).toString('base64url')}`, pathname: name};
}
export async function del() {}
export async function experimental_generateVideo(options) {
  if (process.env.MOCK_PROVIDER_CREDIT_FAILURE === '1') throw new Error('A positive credit balance is required for all requests');
  const segment = Buffer.from(new URL(options.inputReferences[0].data).pathname.slice(1), 'base64url').toString();
  const meta = options.providerOptions.topaz.source;
  if(meta.frameCount > 40 || !options.poll || options.poll.timeoutMs !== 86400000) throw Error('Bad request planning');
  await appendFile(process.env.MOCK_GENERATION_LOG, JSON.stringify({frames:meta.frameCount,segment})+'\n');
  const output = segment.replace(/segment.mp4$/, 'mock-enhanced.mp4');
  execFileSync(require('ffmpeg-static'), ['-v','error','-y','-i',segment,'-an','-vf',`scale=${options.resolution.replace('x',':')}`,'-c:v','libx264','-crf','0','-preset','fast',output]);
  return {video:{mediaType:'video/mp4',uint8Array:await readFile(output)}};
}
export function createGateway() { return {videoModel(modelId) {return modelId;}, async getCredits() {return {balance:process.env.MOCK_CREDIT_BALANCE ?? '100',totalUsed:'0'};}}; }

export async function experimental_getVideoStatus() {
  if(process.env.MOCK_RESUME_VIDEO_FILE)return {status:'completed',videos:[{type:'binary',data:await readFile(process.env.MOCK_RESUME_VIDEO_FILE),mediaType:'video/mp4'}],warnings:[],response:{modelId:'test',timestamp:new Date(),headers:{}}};
  throw new Error('Unexpected live-status call in offline mock');
}
