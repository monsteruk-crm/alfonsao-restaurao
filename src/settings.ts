// Fixed settings for your experiments; dimensions align upwards to four pixels.
export const SETTINGS = {
  model: 'topaz/starlight-precise-2.6', scale: 5, maxLongEdge: 3840,
  auto: 'Auto', // Proteus estimates denoise and restoration parameters.
  clipCrf: 16,
  maxFramesPerRequest: 9000,   // Starlight's hard limit; long selections split automatically.
  timeoutHours: 24,           // Overall wait for background jobs and downloads.
  pollIntervalSeconds: 15,
  segmentUrl: '',             // Hosted URL of the exact extracted clip for background jobs.
  keepUploadedSegment: false, // Remove our temporary Blob after verified success; retain on errors.
} as const;
