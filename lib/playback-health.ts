import { calculatePlaybackRate } from "./drift-math";
import type { CanonicalPlayback } from "./room-events";
import {
  HARD_SEEK_HTML5,
  HARD_SEEK_IFRAME,
  HARD_SEEK_TWITCH,
  PAUSED_HARD_SEEK,
} from "./sync-config";
import type { PlaybackHealth } from "./types";

const HEALTH_TELEMETRY_INTERVAL_MS = 1_000;
const LONG_STALL_MS = 2_000;
const RECOVERY_HARD_SEEK_DRIFT = 0.25;

export type PlaybackRecoveryMode =
  | "none"
  | "long-stall"
  | "reconnect"
  | "media-change"
  | "provider-reinitialize";

type PlaybackHealthControllerOptions = {
  now?: () => number;
  emitTelemetry?: (health: PlaybackHealth) => boolean;
  onHealthChange?: (health: PlaybackHealth) => void;
};

/**
 * Owns one participant's provider health. It never receives or mutates room
 * playback, which makes it safe to instantiate independently for every friend.
 */
export class PlaybackHealthController {
  private health: PlaybackHealth = "idle";
  private stallStartedAt: number | null = null;
  private pendingTelemetry: PlaybackHealth | null = null;
  private telemetryTimer: ReturnType<typeof setTimeout> | null = null;
  private lastTelemetryAt: number | null = null;
  private lastSuccessfulHealth: PlaybackHealth | null = null;
  private recovery: PlaybackRecoveryMode = "none";
  private awaitingReconciliation = false;
  private lastResyncGeneration: number | null = null;
  private readonly now: () => number;
  private readonly emitTelemetry?: (health: PlaybackHealth) => boolean;
  private readonly onHealthChange?: (health: PlaybackHealth) => void;

  constructor(options: PlaybackHealthControllerOptions = {}) {
    this.now = options.now ?? Date.now;
    this.emitTelemetry = options.emitTelemetry;
    this.onHealthChange = options.onHealthChange;
  }

  current(): PlaybackHealth {
    return this.health;
  }

  recoveryMode(): PlaybackRecoveryMode {
    return this.recovery;
  }

  completeRecovery(): void {
    this.recovery = "none";
    this.awaitingReconciliation = false;
  }

  canAcceptProviderEvents(): boolean {
    return (
      this.health !== "buffering" &&
      this.health !== "error" &&
      !this.awaitingReconciliation
    );
  }

  needsReconciliation(): boolean {
    return this.awaitingReconciliation;
  }

  resendCurrent(): void {
    if (
      this.pendingTelemetry === null &&
      this.lastSuccessfulHealth === this.health
    ) {
      return;
    }
    this.queueTelemetry(this.health);
  }

  resyncCurrent(connectionGeneration: number): void {
    if (connectionGeneration === this.lastResyncGeneration) return;
    this.lastResyncGeneration = connectionGeneration;
    this.queueTelemetry(this.health, true);
  }

  beginMedia(mediaId: string | null): void {
    if (!mediaId) {
      this.recovery = "none";
      this.awaitingReconciliation = false;
      this.stallStartedAt = null;
      this.set("idle");
      return;
    }
    this.recovery = "media-change";
    this.awaitingReconciliation = true;
    this.stallStartedAt = null;
    this.set("idle");
  }

  markReconnecting(): void {
    this.recovery = "reconnect";
    this.awaitingReconciliation = true;
  }

  set(next: PlaybackHealth, at = this.now()): boolean {
    if (next === this.health) return false;

    const previous = this.health;
    if (next === "buffering") {
      this.stallStartedAt = at;
      this.awaitingReconciliation = true;
    } else if (next === "error") {
      this.awaitingReconciliation = true;
    } else if (previous === "buffering") {
      if (
        this.stallStartedAt !== null &&
        at - this.stallStartedAt >= LONG_STALL_MS
      ) {
        this.recovery = "long-stall";
      }
      this.stallStartedAt = null;
    } else if (previous === "error" && next === "ready") {
      this.recovery = "provider-reinitialize";
    }

    this.health = next;
    this.onHealthChange?.(next);
    this.queueTelemetry(next);
    return true;
  }

  private queueTelemetry(health: PlaybackHealth, force = false): void {
    if (!this.emitTelemetry) return;
    if (force) this.pendingTelemetry = health;
    if (
      !force &&
      this.pendingTelemetry === null &&
      this.lastSuccessfulHealth === health
    ) {
      return;
    }
    const now = this.now();
    if (
      this.lastTelemetryAt === null ||
      now - this.lastTelemetryAt >= HEALTH_TELEMETRY_INTERVAL_MS
    ) {
      this.flushTelemetry(health);
      return;
    }

    this.pendingTelemetry = health;
    if (this.telemetryTimer) return;
    const delay = Math.max(
      0,
      this.lastTelemetryAt + HEALTH_TELEMETRY_INTERVAL_MS - now,
    );
    this.telemetryTimer = setTimeout(() => {
      this.telemetryTimer = null;
      const latest = this.pendingTelemetry;
      this.pendingTelemetry = null;
      if (latest) this.flushTelemetry(latest);
    }, delay);
  }

  private flushTelemetry(health: PlaybackHealth): void {
    if (this.telemetryTimer) {
      clearTimeout(this.telemetryTimer);
      this.telemetryTimer = null;
    }
    const sent = this.emitTelemetry?.(health) === true;
    if (sent) {
      this.pendingTelemetry = null;
      this.lastTelemetryAt = this.now();
      this.lastSuccessfulHealth = health;
    } else {
      this.pendingTelemetry = health;
    }
  }

  dispose(): void {
    if (this.telemetryTimer) clearTimeout(this.telemetryTimer);
    this.telemetryTimer = null;
    this.pendingTelemetry = null;
  }
}

export type PlaybackReconciliationInput = {
  now: number;
  serverClockOffset: number;
  currentPosition: number;
  provider?: string;
  duration: number;
  isReady: boolean;
  health: PlaybackHealth;
  recoveryMode: PlaybackRecoveryMode;
  previouslyAdjusting: boolean;
};

export type PlaybackReconciliationDecision = {
  kind: "waiting" | "steady" | "rate-nudge" | "hard-seek";
  targetPosition: number;
  drift: number;
  playbackRate: number;
  shouldPlay: boolean;
  isAdjusting: boolean;
};

function hardSeekThreshold(provider?: string): number {
  const normalized = provider?.toLowerCase() ?? "";
  if (normalized === "twitch") return HARD_SEEK_TWITCH;
  if (["youtube", "vimeo"].includes(normalized)) return HARD_SEEK_IFRAME;
  return HARD_SEEK_HTML5;
}

function canonicalTarget(
  playback: CanonicalPlayback,
  now: number,
  serverClockOffset: number,
  duration: number,
): number {
  const elapsedSeconds =
    playback.status === "playing"
      ? Math.max(0, now + serverClockOffset - playback.baseTimestamp) / 1_000
      : 0;
  const target = playback.basePosition + elapsedSeconds * playback.rate;
  return duration > 0
    ? Math.min(duration, Math.max(0, target))
    : Math.max(0, target);
}

/**
 * Holds the newest compact playback frame for exactly one media epoch and
 * derives provider actions without ever writing back to the room timeline.
 */
export class PlaybackCoordinator {
  private mediaId: string | null = null;
  private lastSequence = -1;
  private canonical: CanonicalPlayback | null = null;
  private connectionDeliveryFloor: number | null = null;

  beginMediaEpoch(mediaId: string | null): boolean {
    if (this.mediaId === mediaId) return false;
    this.mediaId = mediaId;
    this.lastSequence = -1;
    this.canonical = null;
    this.connectionDeliveryFloor = null;
    return true;
  }

  beginConnectionEpoch(deliveryVersion: number): void {
    this.connectionDeliveryFloor = deliveryVersion;
  }

  awaitingConnectionFrame(): boolean {
    return this.connectionDeliveryFloor !== null;
  }

  acceptCanonical(playback: CanonicalPlayback, deliveryVersion = 0): boolean {
    if (playback.mediaItemId !== this.mediaId) return false;
    if (this.connectionDeliveryFloor !== null) {
      if (deliveryVersion <= this.connectionDeliveryFloor) return false;
      if (playback.sequence < this.lastSequence) return false;
      this.connectionDeliveryFloor = null;
      this.lastSequence = playback.sequence;
      this.canonical = { ...playback };
      return true;
    }
    if (playback.sequence <= this.lastSequence) return false;
    this.lastSequence = playback.sequence;
    this.canonical = { ...playback };
    return true;
  }

  currentCanonical(): CanonicalPlayback | null {
    return this.canonical ? { ...this.canonical } : null;
  }

  reconcile(
    input: PlaybackReconciliationInput,
  ): PlaybackReconciliationDecision {
    const playback = this.canonical;
    if (!playback) {
      return {
        kind: "waiting",
        targetPosition: input.currentPosition,
        drift: 0,
        playbackRate: 1,
        shouldPlay: false,
        isAdjusting: false,
      };
    }

    const targetPosition = canonicalTarget(
      playback,
      input.now,
      input.serverClockOffset,
      input.duration,
    );
    const drift = Math.abs(targetPosition - input.currentPosition);
    const shouldPlay = playback.status === "playing";
    const unavailable =
      !input.isReady ||
      input.health === "buffering" ||
      input.health === "error";
    if (unavailable) {
      return {
        kind: "waiting",
        targetPosition,
        drift,
        playbackRate: playback.rate,
        shouldPlay,
        isAdjusting: false,
      };
    }

    const recoveryNeedsSeek =
      input.recoveryMode !== "none" && drift > RECOVERY_HARD_SEEK_DRIFT;
    const normalNeedsSeek = shouldPlay
      ? drift > hardSeekThreshold(input.provider)
      : drift > PAUSED_HARD_SEEK;
    if (recoveryNeedsSeek || normalNeedsSeek) {
      return {
        kind: "hard-seek",
        targetPosition,
        drift,
        playbackRate: playback.rate,
        shouldPlay,
        isAdjusting: false,
      };
    }

    if (!shouldPlay) {
      return {
        kind: "steady",
        targetPosition,
        drift,
        playbackRate: playback.rate,
        shouldPlay: false,
        isAdjusting: false,
      };
    }

    const normalizedProvider = input.provider?.toLowerCase() ?? "";
    const { rate, isAdjusting } = calculatePlaybackRate(
      drift,
      input.currentPosition,
      targetPosition,
      playback.rate,
      false,
      ["youtube", "vimeo", "twitch"].includes(normalizedProvider),
      normalizedProvider,
      input.previouslyAdjusting,
    );
    return {
      kind: isAdjusting ? "rate-nudge" : "steady",
      targetPosition,
      drift,
      playbackRate: rate,
      shouldPlay: true,
      isAdjusting,
    };
  }
}
