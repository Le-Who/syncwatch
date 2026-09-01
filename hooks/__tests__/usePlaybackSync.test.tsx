import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePlaybackSync } from "../usePlaybackSync";
import { PlaybackHealthController } from "../../lib/playback-health";
import { PlaybackIntentManager } from "../../lib/playback-intent-manager";
import { useStore } from "../../lib/store";
import type { PlayerMethods } from "../../lib/types";
import { roomWithParticipants } from "../../__tests__/helpers/room-fixtures";

describe("usePlaybackSync", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(18_000);
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("applies long-stall recovery to the current canonical time and cleans its timer", async () => {
    const room = roomWithParticipants(3);
    room.currentMediaId = "media-a";
    room.playlist = [
      {
        id: "media-a",
        url: "https://www.youtube.com/watch?v=aaaaaaaaaaa",
        provider: "youtube",
        title: "A",
        duration: 120,
        addedBy: "p0",
      },
    ];
    room.sequence = 12;
    room.playback = {
      status: "playing",
      basePosition: 10,
      baseTimestamp: 10_000,
      rate: 1,
      updatedBy: "p0",
    };
    useStore.setState({
      room,
      serverClockOffset: 0,
      isConnected: true,
    });
    const healthController = new PlaybackHealthController();
    healthController.set("buffering", 10_000);
    healthController.set("ready", 18_000);
    const intentManager = new PlaybackIntentManager();
    const performProgrammaticSeek = vi.fn();
    const setPlaying = vi.fn();
    const setPlaybackRate = vi.fn();
    const realPlayerRef = {
      current: { setPlaybackRate },
    } as React.RefObject<PlayerMethods | null>;
    const playerRef = {
      current: null,
    } as React.RefObject<PlayerMethods | null>;

    const view = renderHook(() =>
      usePlaybackSync({
        realPlayerRef,
        playerRef,
        getAccurateTime: () => 10,
        getPlaying: () => false,
        setPlaying,
        getIsReady: () => true,
        getSeeking: () => false,
        getIsConnected: () => true,
        intentManager,
        healthController,
        performProgrammaticSeek,
        getCurrentMedia: () => ({ provider: "youtube" }),
        getDuration: () => 120,
      }),
    );

    await act(() => vi.advanceTimersByTimeAsync(500));

    expect(performProgrammaticSeek).toHaveBeenCalledOnce();
    expect(performProgrammaticSeek).toHaveBeenCalledWith(18.5, true);
    expect(setPlaying).toHaveBeenCalledWith(true);
    expect(setPlaybackRate).toHaveBeenCalledWith(1);

    view.unmount();
    const callsAfterUnmount = performProgrammaticSeek.mock.calls.length;
    await act(() => vi.advanceTimersByTimeAsync(5_000));
    expect(performProgrammaticSeek).toHaveBeenCalledTimes(callsAfterUnmount);
    healthController.dispose();
    intentManager.dispose();
  });
});
