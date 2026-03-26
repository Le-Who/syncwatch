/**
 * sync-config.ts — Centralized drift and synchronization thresholds.
 *
 * All sync-related magic numbers live here. Previously scattered across
 * drift-math.ts, usePlaybackSync.ts, and SyncStatusBadge.tsx, these
 * constants are now tunable from a single location.
 */

// ─── Drift Correction (drift-math.ts) ──────────────────────────────────

/** Drift threshold to START rate correction (hysteresis entry) */
export const CORRECTION_START = 0.6;

/** Drift threshold to STOP rate correction (hysteresis exit, must be < CORRECTION_START) */
export const CORRECTION_STOP = 0.3;

/** Drift above which rate correction is skipped (hard seek handles it instead) */
export const RATE_CORRECTION_SKIP = 3.0;

/** Rate adjustment tiers: [driftThreshold, adjustmentPercent] ordered high→low */
export const RATE_ADJUSTMENT_TIERS: ReadonlyArray<[number, number]> = [
  [2.0, 0.15], // >2s drift → 15% speed adjustment
  [1.0, 0.10], // >1s drift → 10%
  [0.0, 0.05], // default   →  5%
];

/** YouTube iframe: cap rate adjustment to prevent user-noticeable speed changes */
export const YOUTUBE_MAX_RATE_ADJUSTMENT = 0.03;

// ─── Hard Seek Thresholds (usePlaybackSync.ts) ─────────────────────────

/** Universal hard-seek threshold for HTML5 players */
export const HARD_SEEK_HTML5 = 3.0;

/** Hard-seek threshold for iframe providers (YouTube, Vimeo) */
export const HARD_SEEK_IFRAME = 2.0;

/** Hard-seek threshold for Twitch (most latency-sensitive) */
export const HARD_SEEK_TWITCH = 1.0;

/** Controlled-mode: owner sends sync_correction when drift exceeds this */
export const CONTROLLED_OWNER_CORRECTION = 0.6;

/** Controlled-mode: followers hard-seek when drift exceeds this */
export const CONTROLLED_FOLLOWER_SEEK = 2.0;

/** Paused state: hard-seek when position mismatch exceeds this */
export const PAUSED_HARD_SEEK = 3.0;

// ─── Grace Periods ─────────────────────────────────────────────────────

/** Milliseconds to skip hard seeks after joining (lets clock sync converge) */
export const JOIN_GRACE_PERIOD_MS = 3000;

/** Milliseconds to suppress SyncStatusBadge after playback status change */
export const BADGE_GRACE_PERIOD_MS = 2000;

/** Pause debounce window in milliseconds */
export const PAUSE_DEBOUNCE_MS = 150;

// ─── SyncStatusBadge Thresholds ────────────────────────────────────────

/** Drift below this = "synced" */
export const BADGE_SYNCED = 0.3;

/** Drift below this but above BADGE_SYNCED = "syncing" */
export const BADGE_SYNCING = 1.0;

/** Drift below this but above BADGE_SYNCING = "drift" */
export const BADGE_DRIFT = 3.0;

/** Drift at or above BADGE_DRIFT = "lost" */
