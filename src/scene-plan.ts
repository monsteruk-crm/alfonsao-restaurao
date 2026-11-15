export type SceneRange = { index: number; scene: number; startFrame: number; endFrame: number; reason: 'edit-cut' | 'length-cap' | 'coverage-boundary' };
export function scenePlan(frameCount: number, cuts: number[], maxFrames: number, coverageBoundaries: number[] = []): SceneRange[] {
  if (!Number.isSafeInteger(frameCount) || frameCount < 1 || !Number.isSafeInteger(maxFrames) || maxFrames < 1 || maxFrames > 9000) {
    throw new Error('Invalid scene frame count or cap (must be 1–9000).');
  }
  const edits = new Set(cuts.filter(n => Number.isSafeInteger(n) && n > 0 && n < frameCount));
  const coverage = new Set(coverageBoundaries.filter(n => Number.isSafeInteger(n) && n > 0 && n < frameCount));
  const boundaries = [0, ...new Set([...edits, ...coverage])].sort((a,b)=>a-b).concat(frameCount);
  const result: SceneRange[] = [];
  let scene = 0;
  for (let i=0;i<boundaries.length-1;i++) {
    const first=boundaries[i]!, last=boundaries[i+1]!;
    if(i===0 || edits.has(first)) scene++;
    const count=Math.ceil((last-first)/maxFrames);
    // Balance subdivisions so a long shot does not leave a tiny final fragment.
    for(let j=0;j<count;j++) {
      const startFrame=first+Math.floor((last-first)*j/count);
      const endFrame=first+Math.floor((last-first)*(j+1)/count);
      result.push({index:result.length+1,scene,startFrame,endFrame,
        reason:j>0?'length-cap':coverage.has(first)&&!edits.has(first)?'coverage-boundary':'edit-cut'});
    }
  }
  return result;
}
export function detectedCuts(log: string, fps: number, firstPts = 0) {
  return [...new Set([...log.matchAll(/pts_time:([\d.eE+-]+)/g)]
    .map(m => Math.round((Number(m[1])-firstPts)*fps)).filter(n=>n>0))].sort((a,b)=>a-b);
}
