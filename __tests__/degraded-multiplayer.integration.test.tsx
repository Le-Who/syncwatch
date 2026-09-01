import { randomUUID } from "node:crypto";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
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
import { PlaybackHealthController } from "../lib/playback-health";
import { PlaybackIntentManager } from "../lib/playback-intent-manager";
import { usePlaybackSync } from "../hooks/usePlaybackSync";
import type { PlayerMethods } from "../lib/types";
import { roomSocketService } from "../lib/socket";

const providerCallbacks = vi.hoisted(
  () => new Map<string, Record<string, (...args: any[]) => void>>(),
);
const providerPlaying = vi.hoisted(() => new Map<string, boolean>());

const integrationSocket = vi.hoisted(() => {
  const handlers = new Map<string, Set<(payload?: any) => void>>();
  const socket = {
    connected: false,
    on: vi.fn((event: string, listener: (payload?: any) => void) => {
      const listeners = handlers.get(event) ?? new Set();
      listeners.add(listener);
      handlers.set(event, listeners);
      return socket;
    }),
    off: vi.fn((event: string, listener: (payload?: any) => void) => {
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
    serverEmit(event: string, payload?: any) {
      if (event === "connect") socket.connected = true;
      if (event === "disconnect") socket.connected = false;
      for (const listener of handlers.get(event) ?? []) listener(payload);
    },
  };
  return socket;
});

vi.mock("socket.io-client", () => ({ io: vi.fn(() => integrationSocket) }));

vi.mock("next/dynamic", async () => {
  const React = await import("react");
  return {
    default: () =>
      React.forwardRef(function IntegrationPlayer(props: any, ref) {
        React.useImperativeHandle(ref, () => ({
          getCurrentTime: () => 20 + (Date.now() - 10_000) / 1_000,
          getDuration: () => 120,
          seekTo: vi.fn(),
          setPlaybackRate: vi.fn(),
          play: vi.fn(),
          dataset: {},
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        }));
        providerPlaying.set(props.src, props.playing);
        providerCallbacks.set(props.src, {
          onLoadedMetadata: props.onLoadedMetadata,
          onWaiting: props.onWaiting,
          onPlaying: props.onPlaying,
          onPause: props.onPause,
          onSeeked: props.onSeeked,
          onEnded: props.onEnded,
        });
        return <div data-testid="integration-provider" />;
      }),
  };
});

vi.mock("motion/react", () => ({
  motion: { div: (props: any) => <div {...props} /> },
}));

type ClientConsumer = { room: RoomState; deliveryVersion: number };
type HealthyClientObservation = {
  position: number;
  playing: boolean;
  seekActions: number[];
};

function HealthyPlaybackConsumer({
  provider,
  onReady,
}: {
  provider: string;
  onReady: (observation: HealthyClientObservation) => void;
}) {
  const observation = useRef<HealthyClientObservation>({
    position: 20,
    playing: true,
    seekActions: [],
  });
  const [healthController] = useState(() => {
    const controller = new PlaybackHealthController();
    controller.set("ready");
    return controller;
  });
  const [intentManager] = useState(() => new PlaybackIntentManager());
  const realPlayerRef = useRef<PlayerMethods | null>({
    setPlaybackRate: vi.fn(),
  });
  const playerRef = useRef<PlayerMethods | null>(null);

  usePlaybackSync({
    realPlayerRef,
    playerRef,
    getAccurateTime: () => observation.current.position,
    getPlaying: () => observation.current.playing,
    setPlaying: (playing) => {
      observation.current.playing = playing;
    },
    getIsReady: () => true,
    getSeeking: () => false,
    getIsConnected: () => useStore.getState().isConnected,
    getConnectionEpoch: () => useStore.getState().connectionEpoch,
    getCanonicalDeliveryVersion: () =>
      useStore.getState().canonicalDeliveryVersion,
    intentManager,
    healthController,
    performProgrammaticSeek: (position) => {
      observation.current.position = position;
      observation.current.seekActions.push(position);
    },
    getCurrentMedia: () => ({ provider }),
    getDuration: () => 120,
  });

  useLayoutEffect(() => onReady(observation.current), [onReady]);
  useEffect(
    () => () => {
      healthController.dispose();
      intentManager.dispose();
    },
    [healthController, intentManager],
  );
  return null;
}

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
    providerPlaying.clear();
    localStorage.clear();
    integrationSocket.emit.mockClear();
    useSettingsStore.setState({ volume: 0.8, muted: false });
    useStore.setState({
      room: null,
      isConnected: false,
      connectionEpoch: 0,
      connectionDeliveryFloor: 0,
      canonicalDeliveryVersion: 0,
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllTimers();
    vi.useRealTimers();
    useStore.setState({
      room: null,
      isConnected: false,
      connectionEpoch: 0,
      connectionDeliveryFloor: 0,
      canonicalDeliveryVersion: 0,
    });
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

  it("keeps reconnecting across a sub-interval socket pulse until a fresh equal-sequence room frame", async () => {
    const room = makeRoom("raw", "https://example.com/reconnect.mp4");
    localStorage.setItem("participantId", "p0");
    localStorage.setItem("nickname", "p0");
    useStore.getState().init();
    useStore.setState({
      room,
      participantId: "p0",
      nickname: "p0",
      serverClockOffset: 0,
      isConnected: false,
      connectionEpoch: 0,
      connectionDeliveryFloor: 0,
      canonicalDeliveryVersion: 1,
      occRollbackTick: 0,
      sendCommand: () => {},
    });
    roomSocketService.connect(room.id, "p0", "p0", null);
    integrationSocket.serverEmit("connect");
    expect(useStore.getState().isConnected).toBe(true);
    const view = render(<Player />);
    fireEvent.click(screen.getByText(/Initialize Stream Sync/i));
    act(() =>
      providerCallbacks.get(room.playlist[0].url)?.onLoadedMetadata?.(),
    );
    await act(() => vi.advanceTimersByTimeAsync(500));
    integrationSocket.emit.mockClear();

    act(() => {
      integrationSocket.serverEmit("disconnect");
      integrationSocket.serverEmit("disconnect");
      integrationSocket.serverEmit("connect");
      integrationSocket.serverEmit("connect");
    });
    expect(useStore.getState()).toMatchObject({
      isConnected: true,
      connectionEpoch: 1,
      connectionDeliveryFloor: 1,
      canonicalDeliveryVersion: 1,
    });
    expect(screen.getByRole("status")).toHaveAccessibleName(/reconnecting/i);
    await act(() => vi.advanceTimersByTimeAsync(2_000));
    expect(screen.getByRole("status")).toHaveAccessibleName(/reconnecting/i);
    expect(
      integrationSocket.emit.mock.calls.filter(
        ([event]) => event === "participant_health",
      ),
    ).toHaveLength(1);

    const deliveryBeforeStale = useStore.getState().canonicalDeliveryVersion;
    act(() => {
      integrationSocket.serverEmit("room_state", {
        room: { ...structuredClone(room), sequence: room.sequence - 1 },
        serverTime: Date.now(),
      });
    });
    expect(useStore.getState().canonicalDeliveryVersion).toBe(
      deliveryBeforeStale,
    );
    await act(() => vi.advanceTimersByTimeAsync(300));
    expect(screen.getByRole("status")).toHaveAccessibleName(/reconnecting/i);

    act(() => {
      integrationSocket.serverEmit("room_state", {
        room: structuredClone(room),
        serverTime: Date.now(),
      });
    });
    expect(useStore.getState().canonicalDeliveryVersion).toBe(
      deliveryBeforeStale + 1,
    );
    await act(() => vi.advanceTimersByTimeAsync(300));

    expect(screen.getByRole("status")).toHaveAccessibleName(
      /synced|catching up/i,
    );
    expect(
      integrationSocket.emit.mock.calls.filter(
        ([event]) => event === "participant_health",
      ),
    ).toHaveLength(1);
    view.unmount();
    roomSocketService.disconnect();
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
  let callbacks = providerCallbacks.get(url)!;
  act(() => callbacks.onLoadedMetadata?.());
  await act(async () => {
    await Promise.all(pendingCommands.splice(0));
    await vi.advanceTimersByTimeAsync(3_100);
  });

  escapedPlaybackCommands.length = 0;
  authoritativeEvents.length = 0;

  if (scenario === "pause-before-waiting") {
    const controlBefore = await repository.get(initial.id);
    act(() => callbacks.onPause?.());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(160);
      await Promise.all(pendingCommands.splice(0));
    });
    const controlAfter = await repository.get(initial.id);
    expect(escapedPlaybackCommands).toEqual(["pause"]);
    expect(controlAfter?.sequence).toBe((controlBefore?.sequence ?? 0) + 1);
    expect(controlAfter?.playback.status).toBe("paused");

    await act(async () => {
      await service.execute(
        { currentRoomId: initial.id, currentParticipantId: "p0" },
        {
          roomId: initial.id,
          clientSequence: controlAfter?.sequence ?? 0,
          nonce: randomUUID(),
          command: {
            type: "play",
            payload: {
              position: 20 + (Date.now() - 10_000) / 1_000,
            },
          },
        },
      );
      callbacks.onPlaying?.();
    });
    await act(() => vi.advanceTimersByTimeAsync(600));
    callbacks = providerCallbacks.get(url)!;
    escapedPlaybackCommands.length = 0;
    authoritativeEvents.length = 0;
  }

  const before = await repository.get(initial.id);
  expect(before).not.toBeNull();

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
    await vi.advanceTimersByTimeAsync(0);
  });
  if (scenario === "pause-before-waiting") {
    expect(providerPlaying.get(url)).toBe(false);
  }

  const after = await repository.get(initial.id);
  expect(escapedPlaybackCommands).toEqual([]);
  expect(authoritativeEvents).toEqual([]);
  expect(screen.getByLabelText("Local buffering")).toBeInTheDocument();
  expect(after?.sequence).toBe(before?.sequence);
  expect(after?.playback.status).toBe("playing");
  expect(after?.playback.basePosition).toBe(before?.playback.basePosition);

  for (const consumer of consumers.slice(1)) {
    expect(consumer.room.sequence).toBe(before?.sequence);
    expect(consumer.room.playback.status).toBe("playing");
  }

  vi.setSystemTime(14_500);
  const healthyClients: HealthyClientObservation[] = [];
  const healthyView = render(
    <>
      <HealthyPlaybackConsumer
        provider={provider}
        onReady={(client) => {
          healthyClients.push(client);
        }}
      />
      <HealthyPlaybackConsumer
        provider={provider}
        onReady={(client) => {
          healthyClients.push(client);
        }}
      />
    </>,
  );
  expect(healthyClients.map((client) => client.position)).toEqual([20, 20]);
  await act(() => vi.advanceTimersByTimeAsync(500));
  for (const client of healthyClients) {
    expect(client.seekActions).toHaveLength(1);
    expect(client.seekActions[0]).toBeCloseTo(25, 5);
    expect(client.position).toBeCloseTo(25, 5);
    expect(client.playing).toBe(true);
  }
  healthyView.unmount();
  view.unmount();
}
