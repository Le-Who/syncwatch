import { vi, describe, it, expect, beforeEach } from "vitest";
import React from "react";
import { applyTwitchEventProxy } from "../player-adapters";
import { PlayerMethods } from "../types";

describe("applyTwitchEventProxy", () => {
  let playerRef: React.MutableRefObject<PlayerMethods | null>;
  let realPlayerRef: React.MutableRefObject<PlayerMethods | null>;
  let handleNativePlay: any;
  let handleNativePause: any;
  let mockTwitchEl: HTMLElement;

  beforeEach(() => {
    handleNativePlay = vi.fn() as any;
    handleNativePause = vi.fn() as any;
    mockTwitchEl = document.createElement("div");

    playerRef = { current: null };
    realPlayerRef = { current: null };

    // Clear console mocks
    vi.restoreAllMocks();
  });

  it("should attach events using realPlayerRef's getInternalPlayer('twitch')", () => {
    realPlayerRef.current = {
      getInternalPlayer: vi.fn().mockReturnValue(mockTwitchEl),
    } as unknown as PlayerMethods;

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    applyTwitchEventProxy(
      playerRef,
      realPlayerRef,
      handleNativePlay,
      handleNativePause,
    );

    expect(realPlayerRef.current.getInternalPlayer).toHaveBeenCalledWith(
      "twitch",
    );
    expect(mockTwitchEl.dataset.proxyAttached).toBe("true");

    // Trigger events
    mockTwitchEl.dispatchEvent(new Event("play"));
    expect(handleNativePlay).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledWith("[TWITCH PROXY] play event fired");

    mockTwitchEl.dispatchEvent(new Event("playing"));
    expect(handleNativePlay).toHaveBeenCalledTimes(2);
    expect(logSpy).toHaveBeenCalledWith("[TWITCH PROXY] playing event fired");

    mockTwitchEl.dispatchEvent(new Event("pause"));
    expect(handleNativePause).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledWith("[TWITCH PROXY] pause event fired");
  });

  it("should fallback to playerRef.current if realPlayerRef is null", () => {
    playerRef.current = mockTwitchEl as unknown as PlayerMethods;

    applyTwitchEventProxy(
      playerRef,
      realPlayerRef,
      handleNativePlay,
      handleNativePause,
    );

    expect(mockTwitchEl.dataset.proxyAttached).toBe("true");

    mockTwitchEl.dispatchEvent(new Event("play"));
    expect(handleNativePlay).toHaveBeenCalledTimes(1);
  });

  it("should fallback to playerRef.current if getInternalPlayer is not a function", () => {
    realPlayerRef.current = {} as unknown as PlayerMethods; // No getInternalPlayer
    playerRef.current = mockTwitchEl as unknown as PlayerMethods;

    applyTwitchEventProxy(
      playerRef,
      realPlayerRef,
      handleNativePlay,
      handleNativePause,
    );

    expect(mockTwitchEl.dataset.proxyAttached).toBe("true");

    mockTwitchEl.dispatchEvent(new Event("play"));
    expect(handleNativePlay).toHaveBeenCalledTimes(1);
  });

  it("should fallback to playerRef.current if getInternalPlayer returns null", () => {
    realPlayerRef.current = {
      getInternalPlayer: vi.fn().mockReturnValue(null),
    } as unknown as PlayerMethods;
    playerRef.current = mockTwitchEl as unknown as PlayerMethods;

    applyTwitchEventProxy(
      playerRef,
      realPlayerRef,
      handleNativePlay,
      handleNativePause,
    );

    expect(realPlayerRef.current.getInternalPlayer).toHaveBeenCalledWith(
      "twitch",
    );
    expect(mockTwitchEl.dataset.proxyAttached).toBe("true");

    mockTwitchEl.dispatchEvent(new Event("play"));
    expect(handleNativePlay).toHaveBeenCalledTimes(1);
  });

  it("should not attach events twice (idempotency)", () => {
    mockTwitchEl.dataset.proxyAttached = "true";
    playerRef.current = mockTwitchEl as unknown as PlayerMethods;

    const addEventListenerSpy = vi.spyOn(mockTwitchEl, "addEventListener");

    applyTwitchEventProxy(
      playerRef,
      realPlayerRef,
      handleNativePlay,
      handleNativePause,
    );

    expect(addEventListenerSpy).not.toHaveBeenCalled();
  });

  it("should catch and log errors during proxying", () => {
    const error = new Error("Test error");
    realPlayerRef.current = {
      getInternalPlayer: () => {
        throw error;
      },
    } as unknown as PlayerMethods;

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    applyTwitchEventProxy(
      playerRef,
      realPlayerRef,
      handleNativePlay,
      handleNativePause,
    );

    expect(errorSpy).toHaveBeenCalledWith(
      "Failed to proxy twitch events",
      error,
    );
  });
});
