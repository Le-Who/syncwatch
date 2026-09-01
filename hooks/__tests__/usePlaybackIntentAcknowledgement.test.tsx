import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useStore } from "@/lib/store";
import { PlaybackIntentManager } from "@/lib/playback-intent-manager";
import { roomSocketService } from "@/lib/socket";
import type { CommandAcknowledgement } from "@/lib/room-command-contract";
import { usePlaybackIntentAcknowledgement } from "../usePlaybackIntentAcknowledgement";

const socketDouble = vi.hoisted(() => {
  const handlers = new Map<string, Set<(payload?: unknown) => void>>();
  const socket = {
    connected: false,
    on: vi.fn((event: string, listener: (payload?: unknown) => void) => {
      const listeners = handlers.get(event) ?? new Set();
      listeners.add(listener);
      handlers.set(event, listeners);
      return socket;
    }),
    off: vi.fn((event: string, listener: (payload?: unknown) => void) => {
      handlers.get(event)?.delete(listener);
      return socket;
    }),
    emit: vi.fn(),
    connect: vi.fn(() => {
      socket.connected = true;
      return socket;
    }),
    disconnect: vi.fn(() => {
      socket.connected = false;
      return socket;
    }),
    serverEmit(event: string, payload?: unknown) {
      for (const listener of handlers.get(event) ?? []) listener(payload);
    },
    reset() {
      handlers.clear();
      socket.connected = false;
      socket.on.mockClear();
      socket.off.mockClear();
      socket.emit.mockClear();
      socket.connect.mockClear();
      socket.disconnect.mockClear();
    },
  };
  return socket;
});

vi.mock("socket.io-client", () => ({
  io: vi.fn(() => socketDouble),
}));

const SLOW_NONCE = "00000000-0000-4000-8000-000000000201";
const FAST_NONCE = "00000000-0000-4000-8000-000000000202";
const OTHER_NONCE = "00000000-0000-4000-8000-000000000299";

function deliverAcknowledgements(
  ...acknowledgements: CommandAcknowledgement[]
) {
  act(() => {
    for (const acknowledgement of acknowledgements) {
      socketDouble.serverEmit("command_ack", acknowledgement);
    }
  });
}

function deliverAcknowledgement(acknowledgement: CommandAcknowledgement) {
  deliverAcknowledgements(acknowledgement);
}

function deliverPlaybackUpdate(nonce: string, status = "playing") {
  act(() => {
    socketDouble.serverEmit("playback_updated", {
      playback: {
        mediaItemId: "media-1",
        status,
        basePosition: 12,
        baseTimestamp: 1_000,
        rate: 1,
        sequence: 2,
        updatedBy: "participant-1",
        lastActionNonce: nonce,
      },
      serverTime: 1_000,
    });
  });
}

describe("usePlaybackIntentAcknowledgement", () => {
  let manager: PlaybackIntentManager;

  beforeEach(() => {
    roomSocketService.disconnect();
    socketDouble.reset();
    roomSocketService.connect("room-a", "Friend", "participant-1", null);
    manager = new PlaybackIntentManager();
    useStore.setState({ lastCommandAcknowledgement: null });
    useStore.getState().init();
  });

  afterEach(() => {
    cleanup();
    roomSocketService.disconnect();
    vi.useRealTimers();
  });

  it("completes an applied slow intent only for its exact acknowledgement nonce", () => {
    renderHook(() => usePlaybackIntentAcknowledgement(manager));
    manager.markCommandEmitted(
      "video_ended",
      undefined,
      SLOW_NONCE,
      "command_ack",
    );

    deliverAcknowledgement({ nonce: OTHER_NONCE, status: "applied" });
    expect(manager.isAwaitingServerAck()).toBe(true);

    deliverAcknowledgement({ nonce: SLOW_NONCE, status: "applied" });
    expect(manager.isAwaitingServerAck()).toBe(false);
    expect(manager.getExpectedStatus("paused")).toBe("paused");
  });

  it("completes an ignored playback no-op from its correlated acknowledgement", () => {
    renderHook(() => usePlaybackIntentAcknowledgement(manager));
    manager.markCommandEmitted("paused", 12, FAST_NONCE, "playback_update");

    deliverAcknowledgement({
      nonce: FAST_NONCE,
      status: "ignored",
      code: "NO_CHANGE",
    });

    expect(manager.isAwaitingServerAck()).toBe(false);
    expect(manager.getExpectedStatus("paused")).toBe("paused");
  });

  it("completes a rejected intent, including retryable contention", () => {
    renderHook(() => usePlaybackIntentAcknowledgement(manager));
    manager.markCommandEmitted("playing", 12, FAST_NONCE, "playback_update");

    deliverAcknowledgement({
      nonce: FAST_NONCE,
      status: "rejected",
      code: "CONTENTION",
    });

    expect(manager.isAwaitingServerAck()).toBe(false);
    expect(manager.getExpectedStatus("paused")).toBe("paused");
  });

  it.each([
    [
      "applied slow",
      "video_ended",
      "command_ack",
      { nonce: SLOW_NONCE, status: "applied" },
    ],
    [
      "ignored no-op",
      "paused",
      "playback_update",
      { nonce: SLOW_NONCE, status: "ignored", code: "NO_CHANGE" },
    ],
    [
      "rejected contention",
      "playing",
      "playback_update",
      { nonce: SLOW_NONCE, status: "rejected", code: "CONTENTION" },
    ],
  ] as const)(
    "does not lose exact %s ACK N when unrelated ACK M follows in one tick",
    (_label, status, completion, acknowledgement) => {
      renderHook(() => usePlaybackIntentAcknowledgement(manager));
      manager.markCommandEmitted(status, 12, SLOW_NONCE, completion);

      deliverAcknowledgements(acknowledgement, {
        nonce: OTHER_NONCE,
        status: "applied",
      });

      expect(manager.isAwaitingServerAck()).toBe(false);
      expect(manager.getExpectedStatus("paused")).toBe("paused");
      expect(useStore.getState().lastCommandAcknowledgement?.nonce).toBe(
        OTHER_NONCE,
      );
    },
  );

  it("keeps an unrelated ACK pending until the exact ACK arrives later in the same tick", () => {
    renderHook(() => usePlaybackIntentAcknowledgement(manager));
    manager.markCommandEmitted(
      "video_ended",
      undefined,
      SLOW_NONCE,
      "command_ack",
    );

    deliverAcknowledgements(
      { nonce: OTHER_NONCE, status: "applied" },
      { nonce: SLOW_NONCE, status: "applied" },
    );

    expect(manager.isAwaitingServerAck()).toBe(false);
  });

  it("does not let an old ACK clear a newer overwritten intent", () => {
    renderHook(() => usePlaybackIntentAcknowledgement(manager));
    manager.markCommandEmitted(
      "video_ended",
      undefined,
      SLOW_NONCE,
      "command_ack",
    );
    manager.markCommandEmitted(
      "update_duration",
      undefined,
      FAST_NONCE,
      "command_ack",
    );

    deliverAcknowledgement({ nonce: SLOW_NONCE, status: "applied" });
    expect(manager.isAwaitingServerAck()).toBe(true);

    deliverAcknowledgement({ nonce: FAST_NONCE, status: "applied" });
    expect(manager.isAwaitingServerAck()).toBe(false);
  });

  it("consumes playback_updated before a later ACK even when sync gates would block polling", () => {
    renderHook(() => usePlaybackIntentAcknowledgement(manager));
    manager.markCommandEmitted("buffering", 12, FAST_NONCE, "playback_update");

    deliverPlaybackUpdate(FAST_NONCE, "buffering");
    expect(manager.isAwaitingServerAck()).toBe(false);

    deliverAcknowledgement({ nonce: FAST_NONCE, status: "applied" });
    expect(manager.isAwaitingServerAck()).toBe(false);
  });

  it("keeps an applied fast ACK pending until RoomSocketService delivers playback_updated", () => {
    renderHook(() => usePlaybackIntentAcknowledgement(manager));
    manager.markCommandEmitted("playing", 12, FAST_NONCE, "playback_update");

    deliverAcknowledgement({ nonce: FAST_NONCE, status: "applied" });
    expect(manager.isAwaitingServerAck()).toBe(true);

    deliverPlaybackUpdate(FAST_NONCE);
    expect(manager.isAwaitingServerAck()).toBe(false);
  });

  it("uses authoritative paused status immediately after an exact seek playback update", () => {
    vi.useFakeTimers();
    renderHook(() => usePlaybackIntentAcknowledgement(manager));
    manager.markCommandEmitted("playing", 44, FAST_NONCE, "playback_update");

    deliverPlaybackUpdate(OTHER_NONCE, "paused");
    expect(manager.isAwaitingServerAck()).toBe(true);
    expect(manager.getExpectedStatus("paused")).toBe("playing");

    deliverPlaybackUpdate(FAST_NONCE, "paused");
    expect(manager.isAwaitingServerAck()).toBe(false);
    expect(manager.getExpectedStatus("paused")).toBe("paused");
    expect(manager.isIgnoringNativeEvents()).toBe(true);

    vi.advanceTimersByTime(250);
    deliverPlaybackUpdate(FAST_NONCE, "paused");
    vi.advanceTimersByTime(250);
    expect(manager.isIgnoringNativeEvents()).toBe(false);
  });

  it("does not lose exact nonce N when a rapid unrelated playback update M follows", () => {
    const acknowledgeServerNonce = vi.spyOn(manager, "acknowledgeServerNonce");
    renderHook(() => usePlaybackIntentAcknowledgement(manager));
    manager.markCommandEmitted("playing", 12, FAST_NONCE, "playback_update");

    deliverPlaybackUpdate(FAST_NONCE);
    deliverPlaybackUpdate(OTHER_NONCE);

    expect(acknowledgeServerNonce.mock.calls).toEqual([
      [FAST_NONCE],
      [OTHER_NONCE],
    ]);
    expect(manager.isAwaitingServerAck()).toBe(false);
  });

  it("completes duplicate ACK and playback paths once", () => {
    vi.useFakeTimers();
    renderHook(() => usePlaybackIntentAcknowledgement(manager));
    manager.markCommandEmitted("playing", 12, FAST_NONCE, "playback_update");

    deliverAcknowledgement({ nonce: FAST_NONCE, status: "applied" });
    expect(manager.isAwaitingServerAck()).toBe(true);

    deliverPlaybackUpdate(FAST_NONCE);
    expect(manager.isAwaitingServerAck()).toBe(false);
    expect(manager.isIgnoringNativeEvents()).toBe(true);

    vi.advanceTimersByTime(250);
    deliverPlaybackUpdate(FAST_NONCE);
    deliverAcknowledgement({ nonce: FAST_NONCE, status: "applied" });
    vi.advanceTimersByTime(250);
    expect(manager.isIgnoringNativeEvents()).toBe(false);
  });

  it("removes its room event listener on unmount", () => {
    const { unmount } = renderHook(() =>
      usePlaybackIntentAcknowledgement(manager),
    );
    manager.markCommandEmitted("playing", 12, FAST_NONCE, "playback_update");

    unmount();
    deliverPlaybackUpdate(FAST_NONCE);

    expect(manager.isAwaitingServerAck()).toBe(true);
  });

  it("mounts, unmounts, and remounts with exactly one ACK callback", () => {
    const acknowledgeCommand = vi.spyOn(manager, "acknowledgeCommand");
    const first = renderHook(() => usePlaybackIntentAcknowledgement(manager));
    first.unmount();
    renderHook(() => usePlaybackIntentAcknowledgement(manager));
    manager.markCommandEmitted(
      "video_ended",
      undefined,
      SLOW_NONCE,
      "command_ack",
    );

    deliverAcknowledgement({ nonce: SLOW_NONCE, status: "applied" });

    expect(acknowledgeCommand).toHaveBeenCalledTimes(1);
    expect(manager.isAwaitingServerAck()).toBe(false);
  });
});
