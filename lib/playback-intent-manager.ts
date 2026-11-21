import type { CommandAcknowledgement } from "./room-command-contract";

export type PlaybackIntentCompletion = "playback_update" | "command_ack";
export type PlaybackIntentBaseline = {
  sequence: number;
  mediaId: string | null;
};

export class PlaybackIntentManager {
  private mediaTransitionTimeout: ReturnType<typeof setTimeout> | null = null;
  private lastCommandEmitTime: number = 0;
  private lastStateEmitted: {
    status: string;
    position: number | undefined;
    time: number;
    nonce?: string;
  } | null = null;
  private lastProgrammaticSeek: number = 0;
  private ignoreNativeEventsUntil: number = 0;
  private _allowUserActionsDuringIgnore: boolean = false;
  private _userIsDraggingScrubber: boolean = false;
  private pauseDebounce: NodeJS.Timeout | null = null;
  private providerEventEpoch = 0;

  private _mediaTransitionId: string | null = null;
  private _mediaTransitionTimestamp: number = 0;

  private _pendingNonce: string | null = null;
  private _pendingNonceTimestamp: number = 0;
  private _pendingCompletion: PlaybackIntentCompletion = "playback_update";
  private _pendingBaseline: PlaybackIntentBaseline | null = null;
  private static readonly NONCE_ACK_TIMEOUT_MS = 3000;

  public setUserDraggingScrubber(isDragging: boolean) {
    this._userIsDraggingScrubber = isDragging;
  }

  public advanceProviderEventEpoch(): number {
    this.providerEventEpoch += 1;
    return this.providerEventEpoch;
  }

  public isProviderEventEpochCurrent(epoch: number): boolean {
    return epoch === this.providerEventEpoch;
  }

  public currentProviderEventEpoch(): number {
    return this.providerEventEpoch;
  }

  public isUserDraggingScrubber(): boolean {
    return this._userIsDraggingScrubber;
  }

  public markCommandEmitted(
    status: string,
    position: number | undefined,
    nonce: string,
    completion: PlaybackIntentCompletion = "playback_update",
    baseline: PlaybackIntentBaseline | null = null,
  ) {
    this.lastCommandEmitTime = Date.now();
    this._pendingNonce = nonce;
    this._pendingNonceTimestamp = Date.now();
    this._pendingCompletion = completion;
    this._pendingBaseline = completion === "playback_update" ? baseline : null;
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

  public ignoreEventsFor(ms: number, passThroughUserActions: boolean = false) {
    this.ignoreNativeEventsUntil = Date.now() + ms;
    this._allowUserActionsDuringIgnore = passThroughUserActions;
  }

  public isIgnoringNativeEvents(): boolean {
    return Date.now() < this.ignoreNativeEventsUntil;
  }

  public setMediaTransition(mediaId: string) {
    this._mediaTransitionId = mediaId;
    this._mediaTransitionTimestamp = Date.now();

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
    if (Date.now() - this._mediaTransitionTimestamp > 10000) {
      this._mediaTransitionId = null;
      return false;
    }
    return true;
  }


  public isAwaitingServerAck(): boolean {
    if (!this._pendingNonce) return false;
    if (
      Date.now() - this._pendingNonceTimestamp >=
      PlaybackIntentManager.NONCE_ACK_TIMEOUT_MS
    ) {
      this._pendingNonce = null;
      this._pendingCompletion = "playback_update";
      this._pendingBaseline = null;
      return false;
    }
    return true;
  }

  public acknowledgeServerNonce(serverNonce?: string): void {
    if (serverNonce && this._pendingNonce === serverNonce) {
      this._pendingNonce = null;
      this._pendingCompletion = "playback_update";
      this._pendingBaseline = null;
      this.lastCommandEmitTime = Number.NEGATIVE_INFINITY;
      this.lastStateEmitted = null;
      this.ignoreEventsFor(500);
    }
  }

  public acknowledgeCommand(acknowledgement: CommandAcknowledgement): void {
    if (this._pendingNonce !== acknowledgement.nonce) return;
    if (
      acknowledgement.status === "applied" &&
      this._pendingCompletion === "playback_update"
    ) {
      return;
    }
    this._pendingNonce = null;
    this._pendingCompletion = "playback_update";
    this._pendingBaseline = null;
    this.lastCommandEmitTime = Number.NEGATIVE_INFINITY;
    this.lastStateEmitted = null;
    this.ignoreEventsFor(500);
  }

  public shouldBlockNativeEvent(isUserInitiated: boolean = false): boolean {
    if (
      isUserInitiated &&
      this._allowUserActionsDuringIgnore &&
      this.isIgnoringNativeEvents()
    ) {
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

  public shouldDeferCanonicalFrame(
    sequence: number,
    mediaId: string | null,
    nonce?: string,
  ): boolean {
    if (!this.isAwaitingServerAck() || !this._pendingBaseline) return false;
    if (nonce && nonce === this._pendingNonce) return false;
    const sameMedia = mediaId === this._pendingBaseline.mediaId;
    if (sameMedia && sequence <= this._pendingBaseline.sequence) return true;

    this._pendingNonce = null;
    this._pendingCompletion = "playback_update";
    this._pendingBaseline = null;
    this.lastCommandEmitTime = Number.NEGATIVE_INFINITY;
    this.lastStateEmitted = null;
    this.ignoreEventsFor(500);
    return false;
  }

  public isRecentCommand(thresholdMs: number = 2000): boolean {
    return Date.now() - this.lastCommandEmitTime < thresholdMs;
  }

  public isRecentProgrammaticSeek(thresholdMs: number = 1500): boolean {
    return Date.now() - this.lastProgrammaticSeek < thresholdMs;
  }

  public clearPauseDebounce() {
    if (this.pauseDebounce) {
      clearTimeout(this.pauseDebounce);
      this.pauseDebounce = null;
    }
  }

  public isPauseDebouncePending(): boolean {
    return this.pauseDebounce !== null;
  }

  public setPauseDebounce(fn: () => void, ms: number) {
    this.clearPauseDebounce();
    this.pauseDebounce = setTimeout(() => {
      this.pauseDebounce = null;
      fn();
    }, ms);
  }

  public dispose() {
    if (this.mediaTransitionTimeout) {
      clearTimeout(this.mediaTransitionTimeout);
      this.mediaTransitionTimeout = null;
    }
    this.clearPauseDebounce();
    this._mediaTransitionId = null;
    this._mediaTransitionTimestamp = 0;
    this.ignoreNativeEventsUntil = 0;
    this._allowUserActionsDuringIgnore = false;
    this._userIsDraggingScrubber = false;
    this._pendingNonce = null;
    this._pendingNonceTimestamp = 0;
    this._pendingCompletion = "playback_update";
    this._pendingBaseline = null;
    this.lastCommandEmitTime = Number.NEGATIVE_INFINITY;
    this.lastStateEmitted = null;
    this.providerEventEpoch += 1;
  }

  public getExpectedStatus(
    fallbackStatus: string | undefined,
  ): string | undefined {
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
}
