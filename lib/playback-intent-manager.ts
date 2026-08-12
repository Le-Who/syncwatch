/**
 * PlaybackIntentManager — Guards against spurious native player events.
 *
 * Core mechanism: When the client emits a command (play/pause/seek), we
 * record the nonce. Native events are blocked until the server echoes back
 * a room_state with a matching nonce (ACK-based), OR a safety-net timeout
 * expires. This replaces fragile wall-clock heuristics with deterministic
 * server acknowledgment.
 */
export class PlaybackIntentManager {
  private mediaTransitionTimeout: ReturnType<typeof setTimeout> | null = null;
  private lastCommandEmitTime: number = 0;
  private lastStateEmitted: {
    status: string;
    position: number;
    time: number;
    nonce?: string;
  } | null = null;
  private lastProgrammaticSeek: number = 0;
  private ignoreNativeEventsUntil: number = 0;
  private _allowUserActionsDuringIgnore: boolean = false;
  private _userIsDraggingScrubber: boolean = false;
  private pauseDebounce: NodeJS.Timeout | null = null;

  // State-based media transition guard (replaces blunt timer)
  private _mediaTransitionId: string | null = null;
  private _mediaTransitionTimestamp: number = 0;

  // ── Nonce-based ACK Pipeline ──────────────────────────────────────
  /** The nonce we are currently waiting to be acknowledged by the server. */
  private _pendingNonce: string | null = null;
  /** Timestamp when the pending nonce was set. Used for safety-net timeout. */
  private _pendingNonceTimestamp: number = 0;
  /** Safety-net timeout (ms): if no ACK arrives within this window, unblock.
   *  This covers lost packets and socket reconnections. */
  private static readonly NONCE_ACK_TIMEOUT_MS = 3000;

  public setUserDraggingScrubber(isDragging: boolean) {
    this._userIsDraggingScrubber = isDragging;
  }

  public isUserDraggingScrubber(): boolean {
    return this._userIsDraggingScrubber;
  }

  public markCommandEmitted(status: string, position: number, nonce: string) {
    this.lastCommandEmitTime = Date.now();
    this._pendingNonce = nonce;
    this._pendingNonceTimestamp = Date.now();
    this.lastStateEmitted = {
      status,
      position,
      time: Date.now(),
      nonce,
    };
  }

  public markProgrammaticSeek() {
    this.lastProgrammaticSeek = Date.now();
  }

  /**
   * Suppress native player events for `ms` milliseconds.
   * @param passThroughUserActions When true, user-initiated play/pause clicks
   *   are NOT suppressed during this window — only programmatic/buffer events are.
   *   This prevents the "eaten click" UX bug where a user clicks play/pause
   *   during a post-seek ignore window and nothing happens.
   */
  public ignoreEventsFor(ms: number, passThroughUserActions: boolean = false) {
    this.ignoreNativeEventsUntil = Date.now() + ms;
    this._allowUserActionsDuringIgnore = passThroughUserActions;
  }

  public isIgnoringNativeEvents(): boolean {
    return Date.now() < this.ignoreNativeEventsUntil;
  }

  /**
   * Begin a state-based transition. Native events are blocked until
   * `clearMediaTransition(mediaId)` is called with the same ID.
   * A 10-second hard timeout prevents permanent lockout.
   */
  public setMediaTransition(mediaId: string) {
    this._mediaTransitionId = mediaId;
    this._mediaTransitionTimestamp = Date.now();

    // Active auto-expiry: clears the guard if onReady never fires (e.g., player crash)
    if (this.mediaTransitionTimeout) {
      clearTimeout(this.mediaTransitionTimeout);
    }
    this.mediaTransitionTimeout = setTimeout(() => {
      if (this._mediaTransitionId === mediaId) {
        console.warn(
          "[IntentManager] Auto-clearing stuck media transition after 8s for",
          mediaId,
        );
        this._mediaTransitionId = null;
      }
      this.mediaTransitionTimeout = null;
    }, 8000);
  }

  /**
   * Called from onReady — clears the transition guard only if
   * the ready event is for the media we're actually transitioning to.
   */
  public clearMediaTransition(mediaId: string) {
    if (this._mediaTransitionId === mediaId) {
      this._mediaTransitionId = null;
      if (this.mediaTransitionTimeout) {
        clearTimeout(this.mediaTransitionTimeout);
        this.mediaTransitionTimeout = null;
      }
    }
  }

  public isInMediaTransition(): boolean {
    if (!this._mediaTransitionId) return false;
    // Hard timeout: 10s safety net prevents permanent lockout
    if (Date.now() - this._mediaTransitionTimestamp > 10000) {
      this._mediaTransitionId = null;
      return false;
    }
    return true;
  }

  // ── Nonce ACK Methods ─────────────────────────────────────────────

  /**
   * Returns true if we are waiting for a server ACK for a recently emitted
   * command. This is the primary guard that replaces `isRecentCommand(ms)`.
   */
  public isAwaitingServerAck(): boolean {
    if (!this._pendingNonce) return false;
    // Safety-net: expire after timeout so we never permanently block
    if (
      Date.now() - this._pendingNonceTimestamp >=
      PlaybackIntentManager.NONCE_ACK_TIMEOUT_MS
    ) {
      this._pendingNonce = null;
      return false;
    }
    return true;
  }

  /**
   * Called when a room_state arrives from the server. If the server's
   * lastActionNonce matches our pending nonce, the command is ACKed
   * and we clear the block. We also set a brief ignore window to
   * absorb any trailing native events from the seek/play.
   */
  public acknowledgeServerNonce(serverNonce?: string): void {
    if (serverNonce && this._pendingNonce === serverNonce) {
      this._pendingNonce = null;
      // Brief post-ACK cooldown to absorb trailing native events
      this.ignoreEventsFor(500);
    }
  }

  /**
   * @param isUserInitiated When true, the event came from a deliberate user action
   *   (e.g., clicking play/pause button). User-initiated events bypass the
   *   time-based ignore window when `_allowUserActionsDuringIgnore` is active.
   */
  public shouldBlockNativeEvent(isUserInitiated: boolean = false): boolean {
    // User clicks always pass through if the ignore window was set with passthrough
    if (
      isUserInitiated &&
      this._allowUserActionsDuringIgnore &&
      this.isIgnoringNativeEvents()
    ) {
      // Clear the ignore window since user took deliberate action
      this.ignoreNativeEventsUntil = 0;
      return false;
    }

    return (
      this.isIgnoringNativeEvents() ||
      this._userIsDraggingScrubber ||
      this.isInMediaTransition() ||
      this.isAwaitingServerAck()
    );
  }

  public isRecentCommand(thresholdMs: number = 2000): boolean {
    return Date.now() - this.lastCommandEmitTime < thresholdMs;
  }

  public isRecentProgrammaticSeek(thresholdMs: number = 1500): boolean {
    return Date.now() - this.lastProgrammaticSeek < thresholdMs;
  }

  /**
   * Check if a programmatic seek happened recently within a custom window.
   * Used by Twitch to detect phantom-pause events fired asynchronously after seek.
   */
  public isRecentSeek(windowMs: number = 300): boolean {
    return (
      this.lastProgrammaticSeek > 0 &&
      Date.now() - this.lastProgrammaticSeek < windowMs
    );
  }

  public clearPauseDebounce() {
    if (this.pauseDebounce) {
      clearTimeout(this.pauseDebounce);
      this.pauseDebounce = null;
    }
  }

  public setPauseDebounce(fn: () => void, ms: number) {
    this.clearPauseDebounce();
    this.pauseDebounce = setTimeout(fn, ms);
  }

  public getExpectedStatus(
    fallbackStatus: string | undefined,
  ): string | undefined {
    // Use nonce-based check first (deterministic), then fallback to time-based
    if (
      this._pendingNonce &&
      this.isAwaitingServerAck() &&
      this.lastStateEmitted
    ) {
      return this.lastStateEmitted.status;
    }
    if (this.isRecentCommand(2000) && this.lastStateEmitted !== null) {
      return this.lastStateEmitted.status;
    }
    return fallbackStatus;
  }

  public get lastStateEmittedRef() {
    return this.lastStateEmitted;
  }

  /**
   * @deprecated Use acknowledgeServerNonce() instead. Kept for backward
   * compatibility during migration.
   */
  public checkAndConsumeNonce(playbackNonce?: string) {
    this.acknowledgeServerNonce(playbackNonce);
  }
}
