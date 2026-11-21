import {
  CORRECTION_START,
  CORRECTION_STOP,
  RATE_CORRECTION_SKIP,
  RATE_ADJUSTMENT_TIERS,
  YOUTUBE_MAX_RATE_ADJUSTMENT,
} from "./sync-config";

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

  if (isBuffering || (isIframeProvider && !isYouTube) || isTwitch) {
    return { rate: serverPlaybackRate, isAdjusting: false };
  }

  if (currentDrift > RATE_CORRECTION_SKIP) {
    return { rate: serverPlaybackRate, isAdjusting: false };
  }

  const shouldAdjust = previouslyAdjusting
    ? currentDrift > CORRECTION_STOP
    : currentDrift > CORRECTION_START;

  if (shouldAdjust) {
    let adjustment = RATE_ADJUSTMENT_TIERS[RATE_ADJUSTMENT_TIERS.length - 1][1];
    for (const [threshold, pct] of RATE_ADJUSTMENT_TIERS) {
      if (currentDrift > threshold) {
        adjustment = pct;
        break;
      }
    }

    if (isYouTube) {
      adjustment = Math.min(adjustment, YOUTUBE_MAX_RATE_ADJUSTMENT);
    }

    const rateAdjustment =
      currentPosition < expectedPosition ? 1 + adjustment : 1 - adjustment;
    const finalRate = serverPlaybackRate * rateAdjustment;
    return { rate: Math.max(0.5, Math.min(2.0, finalRate)), isAdjusting: true };
  }

  return { rate: serverPlaybackRate, isAdjusting: false };
}
