export const formatTime = (seconds: number | undefined | null): string => {
  if (typeof seconds !== "number" || isNaN(seconds) || seconds < 0)
    return "0:00";
  const totalSeconds = Math.max(0, Math.floor(seconds));
  const hh = Math.floor(totalSeconds / 3600);
  const mm = Math.floor((totalSeconds % 3600) / 60);
  const ss = (totalSeconds % 60).toString().padStart(2, "0");
  if (hh > 0) return `${hh}:${mm.toString().padStart(2, "0")}:${ss}`;
  return `${mm}:${ss}`;
};

export const calculateDrift = (
  playbackStatus: string,
  basePosition: number,
  baseTimestamp: number,
  currentServerTime: number,
  currentLocalPosition: number,
  rate: number,
): { expectedPosition: number; drift: number } => {
  if (playbackStatus !== "playing") {
    return {
      expectedPosition: basePosition,
      drift: Math.abs(basePosition - currentLocalPosition),
    };
  }

  const expectedPosition =
    basePosition + ((currentServerTime - baseTimestamp) / 1000) * rate;
  return {
    expectedPosition,
    drift: Math.abs(expectedPosition - currentLocalPosition),
  };
};
