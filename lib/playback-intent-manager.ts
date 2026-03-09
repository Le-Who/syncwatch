export class PlaybackIntentManager {
  private lastCommandEmitTime: number = 0;
  private lastStateEmitted: {
    status: string;
    position: number;
    time: number;
    nonce?: string;
  } | null = null;
  private lastProgrammaticSeek: number = 0;
  private ignoreNativeEventsUntil: number = 0;
  private _userIsDraggingScrubber: boolean = false;
  private pauseDebounce: NodeJS.Timeout | null = null;

  public setUserDraggingScrubber(isDragging: boolean) {
    this._userIsDraggingScrubber = isDragging;
  }

  public isUserDraggingScrubber(): boolean {
    return this._userIsDraggingScrubber;
  }

  public markCommandEmitted(status: string, position: number, nonce: string) {
    this.lastCommandEmitTime = Date.now();
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

  public ignoreEventsFor(ms: number) {
    this.ignoreNativeEventsUntil = Date.now() + ms;
  }

  public isIgnoringNativeEvents(): boolean {
    return Date.now() < this.ignoreNativeEventsUntil;
  }

  public shouldBlockNativeEvent(): boolean {
    return this.isIgnoringNativeEvents() || this._userIsDraggingScrubber;
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

  public setPauseDebounce(fn: () => void, ms: number) {
    this.clearPauseDebounce();
    this.pauseDebounce = setTimeout(fn, ms);
  }

  public getExpectedStatus(
    fallbackStatus: string | undefined,
  ): string | undefined {
    if (this.isRecentCommand(2000) && this.lastStateEmitted !== null) {
      return this.lastStateEmitted.status;
    }
    return fallbackStatus;
  }

  public get lastStateEmittedRef() {
    return this.lastStateEmitted;
  }

  public checkAndConsumeNonce(playbackNonce?: string) {
    if (playbackNonce && this.lastStateEmitted?.nonce === playbackNonce) {
      this.ignoreEventsFor(2000);
      this.lastStateEmitted.nonce = undefined;
    }
  }
}
