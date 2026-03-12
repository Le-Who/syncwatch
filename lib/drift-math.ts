// Hysteresis thresholds to prevent rate oscillation at drift boundaries
const CORRECTION_START = 0.6;
const CORRECTION_STOP = 0.3;

export function calculatePlaybackRate(
  currentDrift: number,
  currentPosition: number,
  expectedPosition: number,
  serverPlaybackRate: number,
  isBuffering: boolean,
  isIframeProvider: boolean,
  providerName?: string,
  previouslyAdjusting: boolean = false,
): { rate: number; isAdjusting: boolean } {
  const provider = providerName?.toLowerCase() || "";
  const isTwitch = provider === "twitch";
  const isYouTube = provider === "youtube";

  // Twitch & Vimeo: no reliable setPlaybackRate API — skip rate correction
  if (isBuffering || (isIframeProvider && !isYouTube) || isTwitch) {
    return { rate: serverPlaybackRate, isAdjusting: false };
  }

  // If drift is massive, a hard seek will happen anyway, so reset rate to normal
  if (currentDrift > 3.0) {
    return { rate: serverPlaybackRate, isAdjusting: false };
  }

  // Hysteresis: start correction at 0.6s, stop only below 0.3s
  const shouldAdjust = previouslyAdjusting
    ? currentDrift > CORRECTION_STOP
    : currentDrift > CORRECTION_START;

  if (shouldAdjust) {
    let adjustment = 0.05; // 5%
    if (currentDrift > 2.0) {
      adjustment = 0.15; // 15%
    } else if (currentDrift > 1.0) {
      adjustment = 0.1; // 10%
    }

    // YouTube iframe: cap at gentle ±3% to avoid user-noticeable speed changes
    if (isYouTube) {
      adjustment = Math.min(adjustment, 0.03);
    }

    const rateAdjustment =
      currentPosition < expectedPosition ? 1 + adjustment : 1 - adjustment;
    const finalRate = serverPlaybackRate * rateAdjustment;
    return { rate: Math.max(0.5, Math.min(2.0, finalRate)), isAdjusting: true };
  }

  // Perfect sync
  return { rate: serverPlaybackRate, isAdjusting: false };
}
