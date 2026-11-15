import { experimental_getVideoStatus as getVideoStatus } from 'ai';
import { setTimeout as delay } from 'node:timers/promises';

// A resume checks the saved operation; it never submits another generation.
export async function resumeVideo(model: Parameters<typeof getVideoStatus>[0], operation: any, options: {
  signal: AbortSignal; intervalMs: number;
  check?: typeof getVideoStatus;
}) {
  const check=options.check??getVideoStatus;
  for (;;) {
    options.signal.throwIfAborted();
    const result=await check(model,{operation,abortSignal:options.signal,maxRetries:0});
    if(result.status==='error')throw new Error(`Saved generation failed: ${JSON.stringify(result.error)}`);
    if(result.status==='completed'){
      const video=result.videos[0];if(!video)throw new Error('Saved job completed without an available video. No new generation submitted.');
      let data:Uint8Array;
      if(video.type==='url'){
        const response=await fetch(video.url,{signal:options.signal});
        if(!response.ok)throw new Error(`Saved video download failed: HTTP ${response.status}`);
        data=new Uint8Array(await response.arrayBuffer());
      }else if(video.type==='base64')data=Buffer.from(video.data,'base64');
      else if(video.type==='binary')data=video.data;
      else throw new Error('Unsupported saved video response. No new generation submitted.');
      return {video:{mediaType:video.mediaType??'video/mp4',uint8Array:data}};
    }
    await delay(options.intervalMs,undefined,{signal:options.signal});
  }
}
