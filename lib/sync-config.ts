

export const CORRECTION_START = 0.6;

export const CORRECTION_STOP = 0.3;

export const RATE_CORRECTION_SKIP = 3.0;

export const RATE_ADJUSTMENT_TIERS: ReadonlyArray<[number, number]> = [
  [2.0, 0.15],
  [1.0, 0.1],
  [0.0, 0.05],
];

export const YOUTUBE_MAX_RATE_ADJUSTMENT = 0.03;


export const HARD_SEEK_HTML5 = 3.0;

export const HARD_SEEK_IFRAME = 2.0;

export const HARD_SEEK_TWITCH = 1.0;

export const PAUSED_HARD_SEEK = 3.0;


export const PAUSE_DEBOUNCE_MS = 150;


export const BADGE_SYNCED = 0.3;
