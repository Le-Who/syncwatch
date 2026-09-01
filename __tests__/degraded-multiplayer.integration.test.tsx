import { randomUUID } from "node:crypto";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Player from "../components/Player";
import { roomWithParticipants } from "./helpers/room-fixtures";
import { InMemoryRoomRepository } from "../lib/room-repository";
import { RoomCommandService } from "../lib/room-command-service";
import { RoomEventBus } from "../lib/room-event-bus";
import type { RoomCommand } from "../lib/room-command-contract";
import type { RoomEvent } from "../lib/room-events";
import type { RoomState } from "../lib/types";
import { reduceCanonicalRoomEvent } from "../lib/room-event-reducer";
import { useSettingsStore, useStore } from "../lib/store";
import { PlaybackCoordinator } from "../lib/playback-health";

const providerCallbacks = vi.hoisted(
  () => new Map<string, Record<string, (...args: any[]) => void>>(),
);

vi.mock("next/dynamic", () => ({
  default: () =>
    function IntegrationPlayer(props: any) {
      providerCallbacks.set(props.src, {
        onLoadedMetadata: props.onLoadedMetadata,
        onWaiting: props.onWaiting,
        onPlaying: props.onPlaying,
        onPause: props.onPause,
        onSeeked: props.onSeeked,
        onEnded: props.onEnded,
      });
      return <div data-testid="integration-provider" />;
    },
}));

vi.mock("motion/react", () => ({
  motion: { div: (props: any) => <div {...props} /> },
}));

type ClientConsumer = { room: RoomState; deliveryVersion: number };

function makeRoom(provider: string, url: string): RoomState {
  const room = roomWithParticipants(3);
  room.id = "degraded-room";
  room.currentMediaId = "media-a";
  room.playlist = [
    {
      id: "media-a",
      url,
      provider,
      title: "Shared video",
      duration: 120,
      addedBy: "p0",
    },
  ];
  room.sequence = 41;
  room.version = 41;
  room.playback = {
    status: "playing",
    basePosition: 20,
    baseTimestamp: 10_000,
    rate: 1,
    updatedBy: "p0",
  };
  return room;
}

describe("degraded multiplayer through authoritative commands", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    providerCallbacks.clear();
    useSettingsStore.setState({ volume: 0.8, muted: false });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllTimers();
    vi.useRealTimers();
    useStore.setState({ room: null, isConnected: false });
  });

  it.each([
    ["youtube", "https://www.youtube.com/watch?v=dQw4w9WgXcQ"],
    ["twitch", "https://www.twitch.tv/videos/123456"],
    ["raw", "https://example.com/video.mp4"],
  ])(
    "keeps %s waiting/native fallout local across three authoritative consumers",
    async (provider, url) => {
      await runScenario(provider, url, "waiting-first");
    },
  );

  it.each([
    ["youtube", "https://www.youtube.com/watch?v=dQw4w9WgXcQ"],
    ["twitch", "https://www.twitch.tv/videos/123456"],
    ["raw", "https://example.com/video.mp4"],
  ])(
    "cancels %s deferred native pause when waiting begins before debounce",
    async (provider, url) => {
      await runScenario(provider, url, "pause-before-waiting");
    },
  );

  it("keeps the accessible reconnect badge until an equal-sequence frame is freshly delivered", async () => {
    const room = makeRoom("raw", "https://example.com/reconnect.mp4");
    useStore.setState({
      room,
      participantId: "p0",
      nickname: "p0",
      serverClockOffset: 0,
      isConnected: true,
      canonicalDeliveryVersion: 1,
      occRollbackTick: 0,
      sendCommand: () => {},
    });
    const view = render(<Player />);
    fireEvent.click(screen.getByText(/Initialize Stream Sync/i));
    act(() =>
      providerCallbacks.get(room.playlist[0].url)?.onLoadedMetadata?.(),
    );
    await act(() => vi.advanceTimersByTimeAsync(500));

    act(() => useStore.setState({ isConnected: false }));
    expect(screen.getByRole("status")).toHaveAccessibleName(/reconnecting/i);
    await act(() => vi.advanceTimersByTimeAsync(2_000));
    act(() => useStore.setState({ isConnected: true }));
    await act(() => vi.advanceTimersByTimeAsync(300));
    expect(screen.getByRole("status")).toHaveAccessibleName(/reconnecting/i);

    const current = useStore.getState();
    const fresh = reduceCanonicalRoomEvent(
      {
        room: current.room!,
        deliveryVersion: current.canonicalDeliveryVersion,
      },
      {
        type: "room_state",
        room: structuredClone(room),
        serverTime: Date.now(),
      },
    );
    act(() =>
      useStore.setState({
        room: fresh.room,
        canonicalDeliveryVersion: fresh.deliveryVersion,
      }),
    );
    await act(() => vi.advanceTimersByTimeAsync(300));

    expect(screen.getByRole("status")).toHaveAccessibleName(
      /synced|catching up/i,
    );
    view.unmount();
  });
});

async function runScenario(
  provider: string,
  url: string,
  scenario: "waiting-first" | "pause-before-waiting",
) {
  const initial = makeRoom(provider, url);
  const repository = new InMemoryRoomRepository([initial], () => Date.now());
  const consumers: ClientConsumer[] = Array.from({ length: 3 }, () => ({
    room: structuredClone(initial),
    deliveryVersion: 1,
  }));
  const authoritativeEvents: RoomEvent[] = [];
  const eventBus = new RoomEventBus((_roomId, event) => {
    authoritativeEvents.push(event);
    consumers.forEach((consumer, index) => {
      consumers[index] = reduceCanonicalRoomEvent(consumer, event);
    });
    const app = useStore.getState();
    if (app.room) {
      const reduced = reduceCanonicalRoomEvent(
        {
          room: app.room,
          deliveryVersion: app.canonicalDeliveryVersion,
        },
        event,
      );
      useStore.setState({
        room: reduced.room,
        canonicalDeliveryVersion: reduced.deliveryVersion,
      });
    }
  });
  const service = new RoomCommandService({
    repository,
    eventBus,
    now: () => Date.now(),
  });
  const pendingCommands: Promise<unknown>[] = [];
  const escapedPlaybackCommands: string[] = [];
  const sendCommand = (type: string, payload: any = {}) => {
    if (["play", "pause", "seek", "video_ended"].includes(type)) {
      escapedPlaybackCommands.push(type);
    }
    const command = { type, payload } as RoomCommand;
    pendingCommands.push(
      service.execute(
        { currentRoomId: initial.id, currentParticipantId: "p0" },
        {
          roomId: initial.id,
          clientSequence: useStore.getState().room?.sequence ?? 0,
          nonce: payload.nonce ?? randomUUID(),
          command,
        },
      ),
    );
  };
  useStore.setState({
    room: structuredClone(initial),
    participantId: "p0",
    nickname: "p0",
    serverClockOffset: 0,
    isConnected: true,
    canonicalDeliveryVersion: 1,
    occRollbackTick: 0,
    sendCommand,
  });

  const view = render(<Player />);
  fireEvent.click(screen.getByText(/Initialize Stream Sync/i));
  await act(async () => {
    await Promise.all(pendingCommands.splice(0));
  });
  const callbacks = providerCallbacks.get(url)!;
  act(() => callbacks.onLoadedMetadata?.());
  await act(async () => {
    await Promise.all(pendingCommands.splice(0));
    await vi.advanceTimersByTimeAsync(500);
  });

  const before = await repository.get(initial.id);
  expect(before).not.toBeNull();
  escapedPlaybackCommands.length = 0;
  authoritativeEvents.length = 0;

  if (scenario === "waiting-first") {
    act(() => {
      callbacks.onWaiting?.();
      callbacks.onPause?.();
      callbacks.onSeeked?.();
      callbacks.onEnded?.();
      vi.advanceTimersByTime(200);
    });
  } else {
    act(() => {
      callbacks.onPause?.();
      callbacks.onWaiting?.();
      vi.advanceTimersByTime(200);
    });
  }
  await act(async () => {
    await Promise.all(pendingCommands.splice(0));
    await vi.advanceTimersByTimeAsync(4_300);
  });

  const after = await repository.get(initial.id);
  expect(escapedPlaybackCommands).toEqual([]);
  expect(authoritativeEvents).toEqual([]);
  expect(after?.sequence).toBe(before?.sequence);
  expect(after?.playback.status).toBe("playing");
  expect(after?.playback.basePosition).toBe(20);

  for (const consumer of consumers.slice(1)) {
    expect(consumer.room.sequence).toBe(before?.sequence);
    const coordinator = new PlaybackCoordinator();
    coordinator.beginMediaEpoch("media-a");
    coordinator.acceptCanonical({
      mediaItemId: "media-a",
      status: consumer.room.playback.status,
      basePosition: consumer.room.playback.basePosition,
      baseTimestamp: consumer.room.playback.baseTimestamp,
      rate: consumer.room.playback.rate,
      sequence: consumer.room.sequence,
      updatedBy: consumer.room.playback.updatedBy,
    });
    const decision = coordinator.reconcile({
      now: 15_000,
      serverClockOffset: 0,
      currentPosition: 25,
      provider,
      duration: 120,
      isReady: true,
      health: "ready",
      recoveryMode: "none",
      previouslyAdjusting: false,
    });
    expect(decision.targetPosition).toBe(25);
    expect(decision.shouldPlay).toBe(true);
  }
  view.unmount();
}
