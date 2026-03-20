import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { PlaybackIntentManager } from "../playback-intent-manager";

describe("PlaybackIntentManager", () => {
  let manager: PlaybackIntentManager;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(10000);
    manager = new PlaybackIntentManager();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllTimers();
  });

  describe("Scrubber state", () => {
    it("should default to false", () => {
      expect(manager.isUserDraggingScrubber()).toBe(false);
    });

    it("should update scrubber state", () => {
      manager.setUserDraggingScrubber(true);
      expect(manager.isUserDraggingScrubber()).toBe(true);

      manager.setUserDraggingScrubber(false);
      expect(manager.isUserDraggingScrubber()).toBe(false);
    });
  });

  describe("Event Ignoring", () => {
    it("should not ignore native events initially", () => {
      expect(manager.isIgnoringNativeEvents()).toBe(false);
    });

    it("should ignore native events for specified time", () => {
      manager.ignoreEventsFor(2000);
      expect(manager.isIgnoringNativeEvents()).toBe(true);

      vi.advanceTimersByTime(1000);
      expect(manager.isIgnoringNativeEvents()).toBe(true);

      vi.advanceTimersByTime(1000);
      expect(manager.isIgnoringNativeEvents()).toBe(false);
    });
  });

  describe("Command Emission and Expected Status", () => {
    it("should not have recent command initially", () => {
      expect(manager.isRecentCommand()).toBe(false);
      expect(manager.lastStateEmittedRef).toBeNull();
    });

    it("should track recent commands", () => {
      manager.markCommandEmitted("playing", 10.5, "nonce123");

      expect(manager.isRecentCommand()).toBe(true);
      expect(manager.isRecentCommand(5000)).toBe(true);

      const lastState = manager.lastStateEmittedRef;
      expect(lastState).toEqual({
        status: "playing",
        position: 10.5,
        time: 10000,
        nonce: "nonce123",
      });

      vi.advanceTimersByTime(2000);
      expect(manager.isRecentCommand()).toBe(false);
      expect(manager.isRecentCommand(5000)).toBe(true);
    });

    it("should return expected status based on recent commands", () => {
      expect(manager.getExpectedStatus("fallback")).toBe("fallback");

      manager.markCommandEmitted("playing", 10.5, "nonce123");
      expect(manager.getExpectedStatus("fallback")).toBe("playing");

      vi.advanceTimersByTime(2000);
      expect(manager.getExpectedStatus("fallback")).toBe("fallback");
    });
  });

  describe("Programmatic Seeks", () => {
    it("should not have recent programmatic seek initially", () => {
      expect(manager.isRecentProgrammaticSeek()).toBe(false);
      expect(manager.isRecentSeek()).toBe(false);
    });

    it("should track programmatic seeks", () => {
      manager.markProgrammaticSeek();

      expect(manager.isRecentProgrammaticSeek()).toBe(true);
      expect(manager.isRecentSeek()).toBe(true);

      vi.advanceTimersByTime(300);
      expect(manager.isRecentProgrammaticSeek()).toBe(true);
      expect(manager.isRecentSeek()).toBe(false); // Default window is 300ms

      vi.advanceTimersByTime(1200); // Total 1500ms
      expect(manager.isRecentProgrammaticSeek()).toBe(false); // Default threshold is 1500ms
    });

    it("should respect custom thresholds for programmatic seeks", () => {
      manager.markProgrammaticSeek();
      expect(manager.isRecentProgrammaticSeek(5000)).toBe(true);

      vi.advanceTimersByTime(2000);
      expect(manager.isRecentProgrammaticSeek(5000)).toBe(true);
      expect(manager.isRecentProgrammaticSeek(1500)).toBe(false);
    });

    it("should respect custom windows for recent seeks", () => {
      manager.markProgrammaticSeek();
      expect(manager.isRecentSeek(1000)).toBe(true);

      vi.advanceTimersByTime(500);
      expect(manager.isRecentSeek(1000)).toBe(true);
      expect(manager.isRecentSeek(300)).toBe(false);
    });
  });

  describe("Media Transitions", () => {
    it("should not be in media transition initially", () => {
      expect(manager.isInMediaTransition()).toBe(false);
    });

    it("should track media transitions", () => {
      manager.setMediaTransition("media123");
      expect(manager.isInMediaTransition()).toBe(true);

      manager.clearMediaTransition("media123");
      expect(manager.isInMediaTransition()).toBe(false);
    });

    it("should only clear transition for matching mediaId", () => {
      manager.setMediaTransition("media123");
      manager.clearMediaTransition("otherMedia");
      expect(manager.isInMediaTransition()).toBe(true);
    });

    it("should timeout media transition after 10s hard timeout", () => {
      manager.setMediaTransition("media123");
      expect(manager.isInMediaTransition()).toBe(true);

      vi.advanceTimersByTime(10000);
      // Even without the auto-expiry timeout running, the manual check isInMediaTransition will return false and clear it
      vi.advanceTimersByTime(1);
      expect(manager.isInMediaTransition()).toBe(false);
    });

    it("should only hit 10s hard timeout when 8s soft timeout isn't triggered or failed", () => {
      // Setup a situation where the soft timeout of 8s somehow didn't clear the transition.
      // E.g., if another transition was started, but with a different logic/error.
      manager.setMediaTransition("media1");

      // Advance to 8 seconds - the 8s soft timeout will fire and set _mediaTransitionId to null.
      // But we want to test the 10s timeout. To do so, we bypass the 8s timeout effect
      // by setting the id back manually.
      vi.advanceTimersByTime(8000);

      // The 8s timeout fired. Let's pretend it didn't clear the ID (simulating a bug or edge case).
      // @ts-ignore
      manager._mediaTransitionId = "media1";

      // We are past 8s, so soft timeout fired.
      // Now we advance past 10s from the original timestamp.
      vi.advanceTimersByTime(2001);

      // The hard timeout block in `isInMediaTransition` should catch it
      expect(manager.isInMediaTransition()).toBe(false);
      // Verify the state is cleared
      // @ts-ignore
      expect(manager._mediaTransitionId).toBeNull();
    });

    it("should auto-clear stuck media transition after 8s", () => {
      const consoleWarnSpy = vi
        .spyOn(console, "warn")
        .mockImplementation(() => {});
      manager.setMediaTransition("media123");
      expect(manager.isInMediaTransition()).toBe(true);

      vi.advanceTimersByTime(8000);

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        "[IntentManager] Auto-clearing stuck media transition after 8s for",
        "media123",
      );
      expect(manager.isInMediaTransition()).toBe(false);

      consoleWarnSpy.mockRestore();
    });

    it("should clear existing mediaTransitionTimeout when setting a new transition", () => {
      const clearTimeoutSpy = vi.spyOn(global, "clearTimeout");
      manager.setMediaTransition("media1");
      expect(clearTimeoutSpy).not.toHaveBeenCalled();

      // Setting another transition should clear the first timeout
      manager.setMediaTransition("media2");
      expect(clearTimeoutSpy).toHaveBeenCalledTimes(1);

      clearTimeoutSpy.mockRestore();
    });

    it("should not auto-clear if the mediaId changed before the 8s timeout", () => {
      const consoleWarnSpy = vi
        .spyOn(console, "warn")
        .mockImplementation(() => {});

      manager.setMediaTransition("media1");

      // Fast forward slightly, then change to media2
      vi.advanceTimersByTime(2000);

      // This will set a new transition, clearing the old timeout, and creating a new one
      manager.setMediaTransition("media2");

      // Advance to where the first timeout would have fired if not cleared
      vi.advanceTimersByTime(6000);

      // Should still be in transition for media2
      expect(manager.isInMediaTransition()).toBe(true);
      expect(consoleWarnSpy).not.toHaveBeenCalled();

      // Advance past media2's timeout
      vi.advanceTimersByTime(2000);

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        "[IntentManager] Auto-clearing stuck media transition after 8s for",
        "media2",
      );
      expect(manager.isInMediaTransition()).toBe(false);

      consoleWarnSpy.mockRestore();
    });

    it("should gracefully handle clearMediaTransition when timeout is null", () => {
      manager.setMediaTransition("media1");

      // Remove timeout manually
      // @ts-ignore
      manager.mediaTransitionTimeout = null;

      // Shouldn't throw
      manager.clearMediaTransition("media1");

      // Verify transition is cleared
      expect(manager.isInMediaTransition()).toBe(false);
    });

    it("should not clear timeout if media id doesn't match in setTimeout", () => {
      // Test the `if (this._mediaTransitionId === mediaId)` branch in setTimeout
      manager.setMediaTransition("media1");

      // Manually set _mediaTransitionId to something else but keep the timeout running
      // @ts-ignore
      manager._mediaTransitionId = "media2";

      const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      // Advance to trigger the 8s timeout created for "media1"
      vi.advanceTimersByTime(8000);

      // Warning shouldn't be logged because IDs don't match
      expect(consoleWarnSpy).not.toHaveBeenCalled();

      // ID shouldn't be null
      // @ts-ignore
      expect(manager._mediaTransitionId).toBe("media2");

      consoleWarnSpy.mockRestore();
    });
  });

  describe("Pause Debounce", () => {
    it("should execute pause debounce callback after specified time", () => {
      const callback = vi.fn();
      manager.setPauseDebounce(callback, 1000);

      expect(callback).not.toHaveBeenCalled();

      vi.advanceTimersByTime(500);
      expect(callback).not.toHaveBeenCalled();

      vi.advanceTimersByTime(500);
      expect(callback).toHaveBeenCalledTimes(1);
    });

    it("should clear pause debounce", () => {
      const callback = vi.fn();
      manager.setPauseDebounce(callback, 1000);

      manager.clearPauseDebounce();

      vi.advanceTimersByTime(1000);
      expect(callback).not.toHaveBeenCalled();
    });

    it("should overwrite previous pause debounce", () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      manager.setPauseDebounce(callback1, 1000);
      manager.setPauseDebounce(callback2, 1000);

      vi.advanceTimersByTime(1000);

      expect(callback1).not.toHaveBeenCalled();
      expect(callback2).toHaveBeenCalledTimes(1);
    });
  });

  describe("Nonces", () => {
    it("should check and consume matching nonce", () => {
      manager.markCommandEmitted("playing", 10, "nonce123");

      manager.checkAndConsumeNonce("nonce123");

      expect(manager.isIgnoringNativeEvents()).toBe(true);
      expect(manager.lastStateEmittedRef?.nonce).toBeUndefined();
    });

    it("should not consume non-matching nonce", () => {
      manager.markCommandEmitted("playing", 10, "nonce123");

      manager.checkAndConsumeNonce("nonce456");

      expect(manager.isIgnoringNativeEvents()).toBe(false);
      expect(manager.lastStateEmittedRef?.nonce).toBe("nonce123");
    });

    it("should do nothing if playbackNonce is not provided", () => {
      manager.markCommandEmitted("playing", 10, "nonce123");

      manager.checkAndConsumeNonce(undefined);

      expect(manager.isIgnoringNativeEvents()).toBe(false);
      expect(manager.lastStateEmittedRef?.nonce).toBe("nonce123");
    });
  });

  describe("shouldBlockNativeEvent", () => {
    it("should block if ignoring native events", () => {
      expect(manager.shouldBlockNativeEvent()).toBe(false);

      manager.ignoreEventsFor(1000);
      expect(manager.shouldBlockNativeEvent()).toBe(true);

      vi.advanceTimersByTime(1000);
      expect(manager.shouldBlockNativeEvent()).toBe(false);
    });

    it("should block if user is dragging scrubber", () => {
      manager.setUserDraggingScrubber(true);
      expect(manager.shouldBlockNativeEvent()).toBe(true);

      manager.setUserDraggingScrubber(false);
      expect(manager.shouldBlockNativeEvent()).toBe(false);
    });

    it("should block if in media transition", () => {
      manager.setMediaTransition("media123");
      expect(manager.shouldBlockNativeEvent()).toBe(true);

      manager.clearMediaTransition("media123");
      expect(manager.shouldBlockNativeEvent()).toBe(false);
    });

    it("should block if multiple conditions are true", () => {
      manager.ignoreEventsFor(1000);
      manager.setUserDraggingScrubber(true);
      manager.setMediaTransition("media123");

      expect(manager.shouldBlockNativeEvent()).toBe(true);
    });
  });
});
