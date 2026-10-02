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
const providerTimelines = vi.hoisted(
  () =>
    new Map<
      string,
      { position: number; at: number; running: boolean; seeks: number[] }
    >(),
);

function setProviderClockPlaying(url: string, running: boolean) {
  const timeline = providerTimelines.get(url);
  if (!timeline) return;
  if (timeline.running) timeline.position += (Date.now() - timeline.at) / 1_000;
  timeline.at = Date.now();
  timeline.running = running;
}

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
          getCurrentTime: () => {
            const timeline = providerTimelines.get(props.src);
            return timeline
              ? timeline.position +
                  (timeline.running ? (Date.now() - timeline.at) / 1_000 : 0)
              : 20 + (Date.now() - 10_000) / 1_000;
          },
          getDuration: () => 120,
          seekTo: (position: number) => {
            const timeline = providerTimelines.get(props.src);
            if (timeline) {
              timeline.position = position;
              timeline.at = Date.now();
              timeline.seeks.push(position);
            }
          },
          setPlaybackRate: vi.fn(),
          play: vi.fn(),
          dataset: {},
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        }));
        React.useLayoutEffect(() => {
          setProviderClockPlaying(props.src, props.playing);
        }, [props.src, props.playing]);
        providerPlaying.set(props.src, props.playing);
        providerCallbacks.set(props.src, {
          onLoadedMetadata: props.onLoadedMetadata,
          onWaiting: props.onWaiting,
          onPlaying: (...args) => {
            setProviderClockPlaying(props.src, true);
            props.onPlaying(...args);
          },
          onPlay: (...args) => {
            setProviderClockPlaying(props.src, true);
            props.onPlay(...args);
          },
          onPause: (...args) => {
            setProviderClockPlaying(props.src, false);
            props.onPause(...args);
          },
          onSeeked: props.onSeeked,
          onEnded: props.onEnded,
          onError: props.onError,
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
    providerTimelines.clear();
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
    vi.restoreAllMocks();
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

  it.each([1, 3, 5, 25])(
    "commits one YouTube native Pause at seek age 1308ms for %s participants and pauses peers",
    async (participantCount) => {
      await runRecentSeekScenario("pause", participantCount);
    },
  );

  it.each([
    "resume-before-debounce",
    "resume-after-debounce",
    "resume-after-ack",
    "resume-before-ack",
  ] as const)(
    "preserves recent-seek genuine YouTube Pause→Play %s",
    async (scenario) => {
      await runRecentSeekScenario(scenario, 3);
    },
  );

  it.each([
    "waiting-first",
    "waiting-pending",
    "stale-sequence",
    "stale-media",
    "stale-epoch",
    "unauthorized",
    "twitch-phantom",
    "raw-phantom",
    "paused-seek-play",
    "resume-superseded",
    "resume-new-seek",
    "resume-media-replaced",
    "resume-provider-replaced",
    "resume-permission-revoked",
    "resume-after-waiting",
  ] as const)(
    "keeps recent-seek %s fallout from mutating playback or pausing peers",
    async (scenario) => {
      await runRecentSeekScenario(scenario, 3);
    },
  );

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

  it.each(["before-commit", "after-commit"] as const)(
    "keeps the authoritative room playing when YouTube quickly resumes %s",
    async (timing) => {
      await runScenario(
        "youtube",
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        timing === "before-commit"
          ? "quick-resume-before-commit"
          : "quick-resume-after-commit",
      );
    },
  );

  it("keeps a YouTube native pause pending across a canonical sync tick", async () => {
    await runScenario(
      "youtube",
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      "canonical-echo",
    );
  });

  it("does not restart YouTube from a stale room frame after pause is sent but before ACK", async () => {
    await runScenario(
      "youtube",
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      "delayed-pause-ack",
    );
  });

  it.each([
    ["youtube", "https://www.youtube.com/watch?v=dQw4w9WgXcQ"],
    ["twitch", "https://www.twitch.tv/videos/123456"],
    ["raw", "https://example.com/video.mp4"],
  ])(
    "emits %s eligible native pause after its debounce through the authoritative service",
    async (provider, url) => {
      await runScenario(provider, url, "eligible-pause-control");
    },
  );

  it.each([
    ["youtube", "https://www.youtube.com/watch?v=dQw4w9WgXcQ"],
    ["twitch", "https://www.twitch.tv/videos/123456"],
    ["raw", "https://example.com/video.mp4"],
  ])(
    "suppresses %s deferred native pause when waiting begins before debounce",
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

type RecentSeekScenario =
  | "pause"
  | "resume-before-debounce"
  | "resume-after-debounce"
  | "resume-after-ack"
  | "resume-before-ack"
  | "paused-seek-play"
  | "resume-superseded"
  | "resume-new-seek"
  | "resume-media-replaced"
  | "resume-provider-replaced"
  | "resume-permission-revoked"
  | "resume-after-waiting"
  | "waiting-first"
  | "waiting-pending"
  | "stale-sequence"
  | "stale-media"
  | "stale-epoch"
  | "unauthorized"
  | "twitch-phantom"
  | "raw-phantom";

async function runRecentSeekScenario(
  scenario: RecentSeekScenario,
  participantCount: number,
) {
  // Wrong branches: blanket recent-seek suppression loses a permitted intent;
  // bypassing health, event identity, permissions or other providers leaks fallout.
  const acknowledgement =
    scenario === "resume-after-ack"
      ? vi.spyOn(PlaybackIntentManager.prototype, "acknowledgeServerNonce")
      : null;
  const emittedIntent =
    scenario === "resume-before-ack"
      ? vi.spyOn(PlaybackIntentManager.prototype, "markCommandEmitted")
      : null;
  const provider =
    scenario === "twitch-phantom"
      ? "twitch"
      : scenario === "raw-phantom"
        ? "raw"
        : "youtube";
  const url =
    provider === "twitch"
      ? "https://www.twitch.tv/videos/123456"
      : provider === "raw"
        ? "https://example.com/video.mp4"
        : "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
  const initial = makeRoom(provider, url);
  initial.participants = roomWithParticipants(participantCount).participants;
  initial.currentMediaId = "00000000-0000-4000-8000-000000000001";
  initial.playlist[0].id = initial.currentMediaId;
  const nextMediaId = "00000000-0000-4000-8000-000000000002";
  initial.playlist.push({
    ...initial.playlist[0],
    id: nextMediaId,
    url: "https://www.youtube.com/watch?v=bbbbbbbbbbb",
  });
  initial.playback.basePosition = 40;
  if (scenario === "paused-seek-play") initial.playback.status = "paused";
  if (scenario === "unauthorized") initial.leaderId = "p0";
  const actor = participantCount === 1 ? "p0" : "p1";
  const timeline = {
    position: 20,
    at: 10_000,
    running: false,
    seeks: [] as number[],
  };
  providerTimelines.set(url, timeline);
  const repository = new InMemoryRoomRepository([initial], () => Date.now());
  const consumers: ClientConsumer[] = Array.from(
    { length: participantCount },
    () => ({ room: structuredClone(initial), deliveryVersion: 1 }),
  );
  const events: RoomEvent[] = [];
  const eventBus = new RoomEventBus((_roomId, event) => {
    events.push(event);
    consumers.forEach((consumer, index) => {
      consumers[index] = reduceCanonicalRoomEvent(consumer, event);
    });
    const state = useStore.getState();
    if (state.room) {
      const reduced = reduceCanonicalRoomEvent(
        { room: state.room, deliveryVersion: state.canonicalDeliveryVersion },
        event,
      );
      useStore.setState({
        room: reduced.room,
        canonicalDeliveryVersion: reduced.deliveryVersion,
      });
      if (scenario === "resume-after-ack" && event.type === "playback_updated")
        integrationSocket.serverEmit("playback_updated", {
          playback: event.playback,
          serverTime: event.serverTime,
        });
    }
  });
  const service = new RoomCommandService({
    repository,
    eventBus,
    now: () => Date.now(),
  });
  const pending: Promise<unknown>[] = [];
  const nativeCommands: { type: string; payload: any }[] = [];
  let releaseOrderedDelivery!: () => void;
  const heldPauseDelivery = new Promise<void>((resolve) => {
    releaseOrderedDelivery = resolve;
  });
  let orderedDelivery: Promise<unknown> = Promise.resolve();
  let outgoingCommandSequence = initial.sequence;
  const servicePlaybackOrder: string[] = [];
  const execute = async (
    participantId: string,
    type: string,
    payload: any = {},
  ) => {
    const room = useStore.getState().room!;
    const context = {
      currentRoomId: initial.id,
      currentParticipantId: participantId,
    };
    const envelope = {
      roomId: initial.id,
      clientSequence:
        scenario === "resume-before-ack"
          ? ++outgoingCommandSequence
          : room.sequence,
      nonce: payload.nonce ?? randomUUID(),
      command: {
        type,
        payload: {
          ...payload,
          mediaRun: room.mediaRun ?? 0,
          roomGeneration: room.generation ?? "legacy",
        },
      } as RoomCommand,
    };
    if (scenario !== "resume-before-ack")
      return service.execute(context, envelope);
    // Hold transport delivery, preserving send-time envelopes and Pause→Play
    // ordering. Real command execution and canonical publication happen on release.
    const delivery = orderedDelivery.then(async () => {
      if (type === "pause") await heldPauseDelivery;
      if (["pause", "play"].includes(type)) servicePlaybackOrder.push(type);
      const result = await service.execute(context, envelope);
      expect(result.status).toBe("applied");
      return result;
    });
    orderedDelivery = delivery;
    return delivery;
  };
  useStore.setState({
    room: structuredClone(initial),
    participantId: actor,
    nickname: actor,
    isConnected: true,
    serverClockOffset: 0,
    canonicalDeliveryVersion: 1,
    occRollbackTick: 0,
    sendCommand: (type, payload) => {
      if (["play", "pause", "seek", "video_ended"].includes(type))
        nativeCommands.push({ type, payload });
      pending.push(execute(actor, type, payload));
    },
  });
  if (scenario === "resume-after-ack")
    roomSocketService.connect(initial.id, actor, actor, null);
  const view = render(<Player />);
  fireEvent.click(
    screen.getByRole("button", { name: "Initialize Stream Sync" }),
  );
  await act(async () => {
    await Promise.all(pending.splice(0));
  });
  act(() => providerCallbacks.get(url)!.onLoadedMetadata());
  await act(async () => {
    await Promise.all(pending.splice(0));
    await vi.advanceTimersByTimeAsync(500);
  });
  expect(timeline.seeks).toEqual([scenario === "paused-seek-play" ? 40 : 40.5]);
  expect(providerPlaying.get(url)).toBe(scenario !== "paused-seek-play");
  await act(() => vi.advanceTimersByTimeAsync(1308));
  // Seek happened at 10_500; Pause arrives at 11_808, not after guard expiry.
  expect(Date.now()).toBe(11_808);
  expect(timeline.seeks).toEqual([scenario === "paused-seek-play" ? 40 : 40.5]);
  const before = (await repository.get(initial.id))!;
  nativeCommands.length = 0;
  events.length = 0;
  const callbacks = providerCallbacks.get(url)!;

  act(() => {
    if (scenario === "waiting-first") callbacks.onWaiting();
    if (scenario === "paused-seek-play") callbacks.onPlay();
    else callbacks.onPause();
  });
  if (
    ![
      "waiting-first",
      "twitch-phantom",
      "raw-phantom",
      "paused-seek-play",
    ].includes(scenario)
  )
    expect(providerPlaying.get(url)).toBe(false);
  await act(() => vi.advanceTimersByTimeAsync(149));
  expect(nativeCommands).toEqual([]);
  expect(events).toEqual([]);
  if (scenario === "waiting-pending") act(() => callbacks.onWaiting());
  if (scenario === "resume-before-debounce") {
    act(() => providerCallbacks.get(url)!.onPlay());
    expect(providerPlaying.get(url)).toBe(true);
    expect(timeline.running).toBe(true);
  }
  if (scenario === "stale-sequence" || scenario === "stale-media") {
    await act(async () => {
      const acknowledgement = await execute(
        "p0",
        scenario === "stale-media" ? "set_media" : "seek",
        scenario === "stale-media" ? { itemId: nextMediaId } : { position: 45 },
      );
      expect(acknowledgement.status).toBe("applied");
    });
    // The retained callback is stale too, independently of the pending debounce.
    act(() => callbacks.onPause());
  }
  if (scenario === "stale-epoch") {
    // Retry advances the provider epoch while preserving the media ID/sequence.
    vi.spyOn(console, "error").mockImplementation(() => {});
    act(() => callbacks.onError(new Error("provider unavailable")));
    fireEvent.click(screen.getByRole("button", { name: /retry video/i }));
    act(() => {
      callbacks.onLoadedMetadata();
      callbacks.onPause();
    });
  }
  const beforeDebounce = (await repository.get(initial.id))!;
  const eventCountBeforeDebounce = events.length;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
    if (scenario !== "resume-before-ack") await Promise.all(pending.splice(0));
  });
  if (
    [
      "resume-after-debounce",
      "resume-after-ack",
      "resume-before-ack",
      "resume-superseded",
      "resume-new-seek",
      "resume-media-replaced",
      "resume-provider-replaced",
      "resume-permission-revoked",
      "resume-after-waiting",
    ].includes(scenario)
  ) {
    expect(nativeCommands.map(({ type }) => type)).toEqual(["pause"]);
    if (acknowledgement) {
      const pauseNonce = nativeCommands[0].payload.nonce;
      const index = acknowledgement.mock.calls.findIndex(
        ([nonce]) => nonce === pauseNonce,
      );
      expect(index).toBeGreaterThanOrEqual(0);
      const manager = acknowledgement.mock.contexts[
        index
      ] as PlaybackIntentManager;
      expect(manager.isAwaitingServerAck()).toBe(false);
    }
    if (scenario === "resume-superseded") {
      await act(async () => {
        expect(await execute("p0", "seek", { position: 45 })).toMatchObject({
          status: "applied",
        });
      });
    }
    if (scenario === "resume-new-seek") {
      // A later canonical paused seek must not inherit the earlier native intent.
      timeline.position = 0;
      timeline.at = Date.now();
      await act(() => vi.advanceTimersByTimeAsync(792));
      expect(timeline.seeks).toEqual([40.5, 41.808]);
    }
    if (
      scenario === "resume-media-replaced" ||
      scenario === "resume-permission-revoked"
    ) {
      await act(async () => {
        expect(
          await execute(
            "p0",
            scenario === "resume-media-replaced"
              ? "set_media"
              : "request_leader",
            scenario === "resume-media-replaced" ? { itemId: nextMediaId } : {},
          ),
        ).toMatchObject({ status: "applied" });
        await Promise.all(pending.splice(0));
      });
    }
    if (scenario === "resume-provider-replaced") {
      vi.spyOn(console, "error").mockImplementation(() => {});
      act(() =>
        providerCallbacks.get(url)!.onError(new Error("provider unavailable")),
      );
      fireEvent.click(screen.getByRole("button", { name: /retry video/i }));
    }
    if (scenario === "resume-after-waiting")
      act(() => providerCallbacks.get(url)!.onWaiting());
    await act(() => vi.advanceTimersByTimeAsync(1));
    if (scenario === "resume-before-ack") {
      // Seek at 10_500; Pause at 11_808; Play at 11_959: seek age 1459ms.
      expect(Date.now()).toBe(11_959);
      expect(useStore.getState().room).toMatchObject({
        sequence: before.sequence,
        playback: { status: "playing" },
      });
      expect((await repository.get(initial.id))!.sequence).toBe(
        before.sequence,
      );
      expect(events).toEqual([]);
      expect(servicePlaybackOrder).toEqual([]);
      const manager = emittedIntent!.mock.contexts.at(
        -1,
      ) as PlaybackIntentManager;
      expect(manager.isAwaitingServerAck()).toBe(true);
      expect(manager.lastStateEmittedRef?.nonce).toBe(
        nativeCommands[0].payload.nonce,
      );
      expect(providerPlaying.get(url)).toBe(false);
      expect(timeline.running).toBe(false);
      expect(timeline.position).toBe(41.808);
    }
    act(() =>
      providerCallbacks
        .get(
          scenario === "resume-media-replaced" ? initial.playlist[1].url : url,
        )!
        .onPlay(),
    );
    await act(async () => {
      if (scenario === "resume-before-ack") {
        expect(nativeCommands.map(({ type }) => type)).toEqual([
          "pause",
          "play",
        ]);
        expect(providerPlaying.get(url)).toBe(true);
        expect(timeline.running).toBe(true);
        expect(useStore.getState().room?.sequence).toBe(before.sequence);
        releaseOrderedDelivery();
      }
      await Promise.all(pending.splice(0));
    });
  }
  const after = (await repository.get(initial.id))!;
  const blockedResume = [
    "resume-superseded",
    "resume-new-seek",
    "resume-media-replaced",
    "resume-provider-replaced",
    "resume-permission-revoked",
    "resume-after-waiting",
  ].includes(scenario);
  if (scenario === "pause") {
    // Hand-derived: one Pause changes playing→paused and increments sequence once.
    expect(nativeCommands).toEqual([
      {
        type: "pause",
        payload: expect.objectContaining({
          fromNative: true,
          position: 41.808,
        }),
      },
    ]);
    expect(after.sequence).toBe(before.sequence + 1);
    expect(after.playback.status).toBe("paused");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "playback_updated",
      playback: { status: "paused", sequence: before.sequence + 1 },
    });
    for (const consumer of consumers) {
      expect(consumer.room.sequence).toBe(before.sequence + 1);
      expect(consumer.room.playback.status).toBe("paused");
    }
  } else if (
    scenario === "resume-after-debounce" ||
    scenario === "resume-after-ack" ||
    scenario === "resume-before-ack"
  ) {
    expect(nativeCommands.map(({ type }) => type)).toEqual(["pause", "play"]);
    expect(after.sequence).toBe(before.sequence + 2);
    expect(after.playback.status).toBe("playing");
    expect(
      events.map(
        (event) => event.type === "playback_updated" && event.playback.status,
      ),
    ).toEqual(["paused", "playing"]);
    if (scenario === "resume-before-ack") {
      expect(servicePlaybackOrder).toEqual(["pause", "play"]);
      for (const consumer of consumers) {
        expect(consumer.room.sequence).toBe(before.sequence + 2);
        expect(consumer.room.playback.status).toBe("playing");
      }
    }
  } else if (blockedResume) {
    expect(nativeCommands.map(({ type }) => type)).toEqual(["pause"]);
    expect(after.playback.status).toBe("paused");
    if (scenario === "resume-superseded" || scenario === "resume-new-seek") {
      expect(after.sequence).toBe(
        before.sequence + (scenario === "resume-superseded" ? 2 : 1),
      );
      expect(after.playback.basePosition).toBe(
        scenario === "resume-superseded" ? 45 : 41.808,
      );
      expect(events).toHaveLength(scenario === "resume-superseded" ? 2 : 1);
    }
    if (scenario === "resume-media-replaced")
      expect(after.currentMediaId).toBe(nextMediaId);
    if (scenario === "resume-permission-revoked")
      expect(after.leaderId).toBe("p0");
  } else {
    expect(nativeCommands).toEqual([]);
    expect(events).toHaveLength(eventCountBeforeDebounce);
    expect(after.sequence).toBe(beforeDebounce.sequence);
    expect(after.playback).toEqual(beforeDebounce.playback);
    // A direct unauthorized command must also be rejected by the real service.
    if (scenario === "unauthorized") {
      expect(await execute(actor, "pause", { position: 41.808 })).toMatchObject(
        { status: "rejected", code: "NOT_PERMITTED" },
      );
      expect((await repository.get(initial.id))!.sequence).toBe(
        before.sequence,
      );
    }
  }

  // Healthy friends apply the delivered canonical state through the production sync hook.
  const healthy: HealthyClientObservation[] = [];
  const healthyView = render(
    <>
      {consumers.slice(1).map((_consumer, index) => (
        <HealthyPlaybackConsumer
          key={index}
          provider={provider}
          onReady={(observation) => {
            healthy.push(observation);
          }}
        />
      ))}
    </>,
  );
  await act(() => vi.advanceTimersByTimeAsync(500));
  for (const observation of healthy)
    expect(observation.playing).toBe(
      scenario !== "pause" && scenario !== "paused-seek-play" && !blockedResume,
    );
  expect(nativeCommands).toHaveLength(
    scenario === "pause" || blockedResume
      ? 1
      : scenario === "resume-after-debounce" ||
          scenario === "resume-after-ack" ||
          scenario === "resume-before-ack"
        ? 2
        : 0,
  );
  if (
    [
      "resume-before-debounce",
      "resume-after-debounce",
      "resume-after-ack",
      "resume-before-ack",
    ].includes(scenario)
  )
    expect(providerPlaying.get(url)).toBe(true);
  if (scenario === "pause") {
    expect(timeline.running).toBe(false);
    expect(timeline.position).toBe(41.808);
  }
  if (scenario === "resume-before-ack") {
    // Pause freezes at 41.808; Play resumes at 11_959; 500ms later it is 42.308.
    expect(timeline.running).toBe(true);
    expect(timeline.position + (Date.now() - timeline.at) / 1_000).toBeCloseTo(
      42.308,
      5,
    );
    expect(nativeCommands.map(({ payload }) => payload.position)).toEqual([
      41.808, 41.808,
    ]);
    for (const client of healthy) {
      expect(client.position).toBeCloseTo(42.308, 5);
      expect(client.seekActions).toEqual([42.308]);
    }
  }
  expect((await repository.get(initial.id))!.sequence).toBe(after.sequence);
  healthyView.unmount();
  view.unmount();
  if (scenario === "resume-after-ack") roomSocketService.disconnect();
}

async function runScenario(
  provider: string,
  url: string,
  scenario:
    | "waiting-first"
    | "eligible-pause-control"
    | "pause-before-waiting"
    | "quick-resume-before-commit"
    | "quick-resume-after-commit"
    | "canonical-echo"
    | "delayed-pause-ack",
) {
  const setMediaTransition = vi.spyOn(
    PlaybackIntentManager.prototype,
    "setMediaTransition",
  );
  const pauseDebounces: { delayMs: number; runs: number }[] = [];
  const setPauseDebounce = PlaybackIntentManager.prototype.setPauseDebounce;
  vi.spyOn(
    PlaybackIntentManager.prototype,
    "setPauseDebounce",
  ).mockImplementation(function (
    this: PlaybackIntentManager,
    callback,
    delayMs,
  ) {
    const observation = { delayMs, runs: 0 };
    pauseDebounces.push(observation);
    // Keep production timer ownership; only observe its actual invocation.
    setPauseDebounce.call(
      this,
      () => {
        observation.runs += 1;
        callback();
      },
      delayMs,
    );
  });
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
  let releaseDelayedPause: (() => void) | undefined;
  const delayedPause = new Promise<void>((resolve) => {
    releaseDelayedPause = resolve;
  });
  const sendCommand = (type: string, payload: any = {}) => {
    if (["play", "pause", "seek", "video_ended"].includes(type)) {
      escapedPlaybackCommands.push(type);
    }
    const command = {
      type,
      payload: {
        ...payload,
        mediaRun: useStore.getState().room?.mediaRun ?? 0,
        roomGeneration: useStore.getState().room?.generation ?? "legacy",
      },
    } as RoomCommand;
    pendingCommands.push(
      (async () => {
        if (scenario === "delayed-pause-ack" && type === "pause") {
          await delayedPause;
        }
        return service.execute(
          { currentRoomId: initial.id, currentParticipantId: "p0" },
          {
            roomId: initial.id,
            clientSequence: useStore.getState().room?.sequence ?? 0,
            nonce: payload.nonce ?? randomUUID(),
            command,
          },
        );
      })(),
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
  act(() => providerCallbacks.get(url)!.onLoadedMetadata?.());
  await act(async () => {
    await Promise.all(pendingCommands.splice(0));
    await vi.advanceTimersByTimeAsync(3_100);
  });

  escapedPlaybackCommands.length = 0;
  authoritativeEvents.length = 0;

  if (scenario === "canonical-echo" || scenario === "delayed-pause-ack") {
    // The next canonical sync tick is at 14_500 ms; place it inside debounce.
    await act(() => vi.advanceTimersByTimeAsync(1_300));
  }

  const before = await repository.get(initial.id);
  expect(before).not.toBeNull();
  const callbacks = providerCallbacks.get(url)!;
  // Capture the real Player-owned manager without changing its guards.
  const intentManager = setMediaTransition.mock
    .contexts[0] as PlaybackIntentManager;
  expect(intentManager).toBeInstanceOf(PlaybackIntentManager);
  expect({
    playing: providerPlaying.get(url),
    canonicalStatus: useStore.getState().room?.playback.status,
    pendingControl: intentManager.isAwaitingServerAck(),
    expectedStatus: intentManager.getExpectedStatus(before?.playback.status),
    inMediaTransition: intentManager.isInMediaTransition(),
    ignoringNativeEvents: intentManager.isIgnoringNativeEvents(),
    recentProgrammaticSeek: intentManager.isRecentProgrammaticSeek(2_500),
    recentCommand: intentManager.isRecentCommand(2_500),
    draggingScrubber: intentManager.isUserDraggingScrubber(),
  }).toEqual({
    playing: true,
    canonicalStatus: "playing",
    pendingControl: false,
    expectedStatus: "playing",
    inMediaTransition: false,
    ignoringNativeEvents: false,
    recentProgrammaticSeek: false,
    recentCommand: false,
    draggingScrubber: false,
  });

  if (scenario === "waiting-first") {
    act(() => {
      callbacks.onWaiting?.();
      callbacks.onPause?.();
      callbacks.onSeeked?.();
      callbacks.onEnded?.();
      vi.advanceTimersByTime(200);
    });
  } else {
    const deferredEpoch = intentManager.currentProviderEventEpoch();
    act(() => {
      callbacks.onPause?.();
      if (scenario === "quick-resume-before-commit") callbacks.onPlay?.();
    });
    expect(providerPlaying.get(url)).toBe(
      scenario === "quick-resume-before-commit",
    );
    expect(pauseDebounces).toEqual([{ delayMs: 150, runs: 0 }]);
    if (scenario === "quick-resume-after-commit") {
      act(() => callbacks.onPlay?.());
    }
    if (scenario === "canonical-echo" || scenario === "delayed-pause-ack") {
      await act(() => vi.advanceTimersByTimeAsync(100));
      expect(providerPlaying.get(url)).toBe(false);
      expect(escapedPlaybackCommands).toEqual([]);
    }
    await act(() =>
      vi.advanceTimersByTimeAsync(
        scenario === "canonical-echo" || scenario === "delayed-pause-ack"
          ? 49
          : 149,
      ),
    );
    expect(pauseDebounces).toEqual([{ delayMs: 150, runs: 0 }]);
    expect(escapedPlaybackCommands).toEqual([]);
    expect(authoritativeEvents).toEqual([]);

    if (scenario === "pause-before-waiting") {
      act(() => callbacks.onWaiting?.());
      expect(screen.getByLabelText("Local buffering")).toBeInTheDocument();
      // Only local health changes before the callback: its epoch, media,
      // sequence, and expected playing status must still permit emission.
      expect(intentManager.currentProviderEventEpoch()).toBe(deferredEpoch);
      expect(useStore.getState().room).toMatchObject({
        currentMediaId: before?.currentMediaId,
        sequence: before?.sequence,
        playback: { status: "playing" },
      });
      expect(intentManager.isAwaitingServerAck()).toBe(false);
      expect(intentManager.getExpectedStatus("playing")).toBe("playing");
      expect(pauseDebounces).toEqual([{ delayMs: 150, runs: 0 }]);
    }

    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(pauseDebounces).toEqual([
      {
        delayMs: 150,
        runs: scenario.startsWith("quick-resume") ? 0 : 1,
      },
    ]);
  }
  if (scenario === "delayed-pause-ack") {
    expect(escapedPlaybackCommands).toEqual(["pause"]);
    expect(intentManager.isAwaitingServerAck()).toBe(true);
    expect(useStore.getState().room?.playback.status).toBe("playing");
    // The scheduled retry reaches reconciliation while the old canonical
    // frame is still current and RoomCommandService has not executed Pause.
    await act(() => vi.advanceTimersByTimeAsync(300));
    expect(providerPlaying.get(url)).toBe(false);
    expect(escapedPlaybackCommands).toEqual(["pause"]);
    releaseDelayedPause?.();
  }
  await act(async () => {
    await Promise.all(pendingCommands.splice(0));
    await vi.advanceTimersByTimeAsync(0);
  });
  const after = await repository.get(initial.id);
  if (
    scenario === "eligible-pause-control" ||
    scenario === "canonical-echo" ||
    scenario === "delayed-pause-ack"
  ) {
    expect(escapedPlaybackCommands).toEqual(["pause"]);
    expect(after?.sequence).toBe((before?.sequence ?? 0) + 1);
    expect(after?.playback.status).toBe("paused");
    view.unmount();
    return;
  }
  if (scenario.startsWith("quick-resume")) {
    expect(escapedPlaybackCommands).toEqual([]);
    expect(authoritativeEvents).toEqual([]);
    expect(after?.sequence).toBe(before?.sequence);
    expect(after?.playback.status).toBe("playing");
    for (const consumer of consumers.slice(1)) {
      expect(consumer.room.playback.status).toBe("playing");
    }
    view.unmount();
    return;
  }
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
