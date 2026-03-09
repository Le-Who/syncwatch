export function calculatePlaybackRate(
  currentDrift: number,
  currentPosition: number,
  expectedPosition: number,
  serverPlaybackRate: number,
  isBuffering: boolean,
  isIframeProvider: boolean,
): number {
  if (isBuffering || isIframeProvider) {
    return serverPlaybackRate;
  }

  // If drift is massive, a hard seek will happen anyway, so reset rate to normal
  if (currentDrift > 3.0) {
    return serverPlaybackRate;
  }

  // Minor drift threshold
  if (currentDrift > 0.5) {
    const rateAdjustment = currentPosition < expectedPosition ? 1.05 : 0.95;
    return serverPlaybackRate * rateAdjustment;
  }

  // Perfect sync
  return serverPlaybackRate;
}
