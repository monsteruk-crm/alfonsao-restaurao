// The observed Topaz encoder aligns each dimension upwards to four pixels.
export function alignDimension(value: number): number {
  return Math.max(4, Math.ceil(value / 4) * 4);
}

export function outputDimensions(width: number, height: number, scale: number, maxLongEdge: number) {
  if (![width, height, scale, maxLongEdge].every(n => Number.isFinite(n) && n > 0) || maxLongEdge < 4) {
    throw new Error('Source dimensions, scale and maximum long edge must be positive; maximum must be at least 4.');
  }
  const cap = Math.floor(maxLongEdge / 4) * 4;
  const factor = Math.min(scale, cap / Math.max(width, height));
  return { width: Math.min(cap, alignDimension(width * factor)),
    height: Math.min(cap, alignDimension(height * factor)) };
}

// Accept the precise alignment of an older, non-aligned request as well.
// Other unexpected dimensions must still fail validation.
export function matchesResolution(width: number | undefined, height: number | undefined,
  requestedWidth: number, requestedHeight: number) {
  return (width === requestedWidth && height === requestedHeight) ||
    (width === alignDimension(requestedWidth) && height === alignDimension(requestedHeight));
}
