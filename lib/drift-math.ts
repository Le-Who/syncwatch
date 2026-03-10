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
    let adjustment = 0.05; // 5%
    if (currentDrift > 2.0) {
      adjustment = 0.15; // 15%
    } else if (currentDrift > 1.0) {
      adjustment = 0.1; // 10%
    }
    const rateAdjustment =
      currentPosition < expectedPosition ? 1 + adjustment : 1 - adjustment;
    const finalRate = serverPlaybackRate * rateAdjustment;
    return Math.max(0.5, Math.min(2.0, finalRate));
  }

  // Perfect sync
  return serverPlaybackRate;
}
