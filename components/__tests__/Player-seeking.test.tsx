import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Player from "../Player";
import { roomWithParticipants } from "../../__tests__/helpers/room-fixtures";
import { useSettingsStore, useStore } from "@/lib/store";

const providers = vi.hoisted(() => new Map<string, any>());
const callbacks = vi.hoisted(() => new Map<string, any>());

vi.mock("@/lib/store", () => ({
  useStore: vi.fn(),
  useSettingsStore: vi.fn(),
}));

// Keep Player's command, permission, and reconciliation paths real. Only the
// external iframe is replaced with a seekable provider boundary.
vi.mock("next/dynamic", async () => {
  const React = await import("react");
  return {
    default: () =>
      function ProviderBoundary(props: any) {
        React.useImperativeHandle(props.ref, () => providers.get(props.src));
        callbacks.set(props.src, props);
        return null;
      },
  };
});

const firstId = "00000000-0000-4000-8000-000000000001";
const secondId = "00000000-0000-4000-8000-000000000002";
const firstUrl = "https://www.twitch.tv/videos/123456";
const secondUrl = "https://www.twitch.tv/videos/654321";

function providerAt(position: number, duration: number) {
  return {
    position,
    duration,
    paused: true,
    dataset: {},
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    getCurrentTime() {
      return this.position;
    },
    getDuration() {
      return this.duration;
    },
    seekTo(position: number) {
      this.position = position;
      // Twitch pauses when scrubbing, including programmatic seeks.
      this.paused = true;
    },
    play() {
      this.paused = false;
    },
    setPlaybackRate: vi.fn(),
  };
}

function mountPlayer({
  position = 20,
  duration = 120,
  playing = false,
  canControl = true,
  providerName = "twitch",
  url = firstUrl,
} = {}) {
  const room = roomWithParticipants(2, {
    leaderId: canControl ? null : "p0",
  });
  room.currentMediaId = firstId;
  room.playlist = [
    {
      id: firstId,
      url,
      provider: providerName,
      title: "First video",
      duration,
      addedBy: "p0",
    },
  ];
  room.playback = {
    status: playing ? "playing" : "paused",
    basePosition: position,
    baseTimestamp: Date.now(),
    rate: 1,
    updatedBy: "p0",
  };
  const sendCommand = vi.fn();
  const state = {
    room,
    participantId: canControl ? "p0" : "p1",
    sendCommand,
    serverClockOffset: 0,
    occRollbackTick: 0,
    connectionEpoch: 0,
    connectionDeliveryFloor: 0,
    canonicalDeliveryVersion: 0,
    isConnected: true,
    setLocalPlaybackHealth: vi.fn(),
  };
  (useStore as any).mockImplementation((selector: any) => selector(state));
  (useStore as any).getState = () => state;
  const provider = providerAt(position, duration);
  providers.set(url, provider);
  const view = render(<Player />);
  fireEvent.click(screen.getByText(/Initialize Stream Sync/i));
  act(() => callbacks.get(url).onLoadedMetadata());
  provider.paused = !playing;
  sendCommand.mockClear();
  return { ...view, provider, state, sendCommand };
}

function pointer(target: Element | Document, type: string, clientX: number) {
  fireEvent(target, new MouseEvent(type, { bubbles: true, clientX }));
}

function startDrag() {
  const slider = screen.getByRole("slider", { name: "Playback position" });
  vi.spyOn(slider, "getBoundingClientRect").mockReturnValue(
    new DOMRect(0, 0, 200, 10),
  );
  pointer(slider, "pointerdown", 100);
}

function pressArrow(code: string, shiftKey = false) {
  fireEvent.keyDown(window, { code, key: code, shiftKey });
}

describe("Player keyboard seeks", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    providers.clear();
    callbacks.clear();
    (useSettingsStore as any).mockReturnValue({
      volume: 0.8,
      muted: false,
      theaterMode: false,
      setVolume: vi.fn(),
      setMuted: vi.fn(),
      toggleTheaterMode: vi.fn(),
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("seeks forward from the current time when provider duration is unknown", () => {
    const { provider, sendCommand } = mountPlayer({ duration: 0 });

    pressArrow("ArrowRight");

    expect(provider.position).toBe(25);
    expect(sendCommand).toHaveBeenCalledExactlyOnceWith(
      "seek",
      expect.objectContaining({ position: 25 }),
    );
  });

  it.each([
    { position: 118, code: "ArrowRight", shift: false, target: 120 },
    { position: 3, code: "ArrowLeft", shift: false, target: 0 },
    { position: 20, code: "ArrowRight", shift: true, target: 30 },
    { position: 20, code: "ArrowLeft", shift: true, target: 10 },
  ])(
    "bounds $code at $target (shift=$shift)",
    ({ position, code, shift, target }) => {
      const { provider, sendCommand } = mountPlayer({ position });

      pressArrow(code, shift);

      expect(provider.position).toBe(target);
      expect(sendCommand).toHaveBeenCalledExactlyOnceWith(
        "seek",
        expect.objectContaining({ position: target }),
      );
      expect(provider.paused).toBe(true);
    },
  );

  it("resumes a playing Twitch provider after keyboard seek pauses it", () => {
    const { provider, sendCommand } = mountPlayer({ playing: true });

    pressArrow("ArrowRight");

    expect(provider.position).toBe(25);
    expect(provider.paused).toBe(false);
    expect(sendCommand).toHaveBeenCalledExactlyOnceWith(
      "play",
      expect.objectContaining({ position: 25, forceSeek: true }),
    );
  });

  it("leaves the provider and room unchanged for a viewer while another participant leads", () => {
    const { provider, sendCommand } = mountPlayer({ canControl: false });

    pressArrow("ArrowRight");

    expect(provider.position).toBe(20);
    expect(sendCommand).not.toHaveBeenCalled();
  });

  it("does not clamp the next media to the previous media's duration", () => {
    const { state, rerender, sendCommand } = mountPlayer({ duration: 20 });
    const nextProvider = providerAt(40, 0);
    providers.set(secondUrl, nextProvider);
    state.room.currentMediaId = secondId;
    state.room.mediaRun = (state.room.mediaRun ?? 0) + 1;
    state.room.playlist.push({
      id: secondId,
      url: secondUrl,
      provider: "twitch",
      title: "Second video",
      duration: 0,
      addedBy: "p0",
    });
    state.room.playback.basePosition = 40;
    rerender(<Player />);
    act(() => callbacks.get(secondUrl).onLoadedMetadata());
    sendCommand.mockClear();

    pressArrow("ArrowRight");

    expect(nextProvider.position).toBe(45);
    expect(sendCommand).toHaveBeenCalledExactlyOnceWith(
      "seek",
      expect.objectContaining({ position: 45 }),
    );
  });

  it("releases native-event suppression after a pointer drag is cancelled", () => {
    const url = "https://example.com/video.mp4";
    const { provider, sendCommand } = mountPlayer({ providerName: "raw", url });
    act(() => vi.advanceTimersByTime(2_000));
    startDrag();
    pointer(document, "pointercancel", 100);
    pointer(document, "pointerup", 100);

    expect(provider.position).toBe(20);
    expect(sendCommand).not.toHaveBeenCalled();
    act(() => callbacks.get(url).onPlay());

    expect(sendCommand).toHaveBeenCalledExactlyOnceWith(
      "play",
      expect.objectContaining({ position: 20, fromNative: true }),
    );
  });

  it("cancels a drag when control is revoked without moving the local provider", () => {
    const url = "https://example.com/video.mp4";
    const { provider, state, rerender, sendCommand } = mountPlayer({
      providerName: "raw",
      url,
    });
    startDrag();
    state.participantId = "p1";
    state.room.leaderId = "p0";
    rerender(<Player />);

    pointer(document, "pointerup", 100);

    expect(provider.position).toBe(20);
    expect(sendCommand).not.toHaveBeenCalled();
  });

  it.each(["different media", "same-media replay"])(
    "abandons the previous drag on a %s epoch and releases the new provider guard",
    (transition) => {
      const url = "https://example.com/video.mp4";
      const { provider, state, rerender, sendCommand } = mountPlayer({
        providerName: "raw",
        url,
      });
      startDrag();
      const nextUrl =
        transition === "different media" ? "https://example.com/next.mp4" : url;
      const nextId = transition === "different media" ? secondId : firstId;
      const nextProvider = providerAt(40, 120);
      providers.set(nextUrl, nextProvider);
      state.room.currentMediaId = nextId;
      state.room.mediaRun = (state.room.mediaRun ?? 0) + 1;
      if (transition === "different media") {
        state.room.playlist.push({
          id: nextId,
          url: nextUrl,
          provider: "raw",
          title: "Next clip",
          duration: 120,
          addedBy: "p0",
        });
      }
      state.room.playback.basePosition = 40;
      rerender(<Player />);
      act(() => callbacks.get(nextUrl).onLoadedMetadata());
      sendCommand.mockClear();

      pointer(document, "pointerup", 100);

      expect(provider.position).toBe(20);
      expect(nextProvider.position).toBe(40);
      expect(sendCommand).not.toHaveBeenCalled();
      act(() => vi.advanceTimersByTime(2_000));
      act(() => callbacks.get(nextUrl).onPlay());
      expect(sendCommand).toHaveBeenCalledExactlyOnceWith(
        "play",
        expect.objectContaining({ position: 40, fromNative: true }),
      );
    },
  );
});
