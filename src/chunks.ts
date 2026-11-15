export function planChunks(frameCount: number, maxFrames: number) {
  if (!Number.isSafeInteger(frameCount) || frameCount < 1 ||
      !Number.isSafeInteger(maxFrames) || maxFrames < 1 || maxFrames > 9000) {
    throw new Error('Frame counts must be positive integers; chunk limit must be <= 9000.');
  }
  const chunks = [];
  for (let startFrame = 0; startFrame < frameCount; startFrame += maxFrames) {
    chunks.push({ startFrame, endFrame: Math.min(frameCount, startFrame + maxFrames) });
  }
  return chunks;
}
