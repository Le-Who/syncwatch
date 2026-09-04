import { renderHook, act } from "@testing-library/react";
import { useStore, useSettingsStore } from "../store";
import { roomSocketService } from "../socket";
import { vi, describe, beforeEach, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import {
  participant,
  roomWithParticipants,
} from "../../__tests__/helpers/room-fixtures";
import { PlaybackIntentManager } from "../playback-intent-manager";
import { InMemoryRoomRepository } from "../room-repository";
import { RoomCommandService } from "../room-command-service";
import { RoomEventBus } from "../room-event-bus";

const socketDouble = vi.hoisted(() => {
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

vi.mock("../socket", () => {
  return {
    roomSocketService: {
      connect: vi.fn(),
      disconnect: vi.fn(),
      sendCommand: vi.fn(),
      upgradeSession: vi.fn(),
      joinRoom: vi.fn(),
      requestRoomState: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
      onRoomEvent: vi.fn(),
      offRoomEvent: vi.fn(),
      emit: vi.fn(),
      commandQueue: [],
    },
  };
});

describe("useSettingsStore", () => {
  beforeEach(() => {
    // Reset local storage
    localStorage.clear();
  });

  it("should initialize with default settings", () => {
    const { result } = renderHook(() => useSettingsStore());
    expect(result.current.volume).toBe(0.5);
    expect(result.current.muted).toBe(true);
    expect(result.current.theaterMode).toBe(false);
  });

  it("should update volume", () => {
    const { result } = renderHook(() => useSettingsStore());
    act(() => {
      result.current.setVolume(0.5);
    });
    expect(result.current.volume).toBe(0.5);
  });

  it("should clamp volume to the safe 0..1 media range", () => {
    const { result } = renderHook(() => useSettingsStore());
    act(() => {
      result.current.setVolume(2);
    });
    expect(result.current.volume).toBe(1);

    act(() => {
      result.current.setVolume(-1);
    });
    expect(result.current.volume).toBe(0);
  });

  it("should toggle theater mode", () => {
    const { result } = renderHook(() => useSettingsStore());
    act(() => {
      result.current.toggleTheaterMode();
    });
    expect(result.current.theaterMode).toBe(true);
  });
});

describe("useStore", () => {
  beforeEach(() => {
    localStorage.clear();
    const { result } = renderHook(() => useStore());
    act(() => {
      // Clear state manually for clean runs
      useStore.setState({
        room: null,
        serverClockOffset: 0,
        isConnected: false,
        connectionEpoch: 0,
        connectionDeliveryFloor: 0,
        participantId: null,
        sessionToken: null,
        nickname: "",
        commandSequence: 1,
        lastCommandAcknowledgement: null,
        commandError: null,
      });
    });
    vi.clearAllMocks();
    socketDouble.reset();
  });

  it("should initialize with correct default state", () => {
    const { result } = renderHook(() => useStore());
    expect(result.current.isConnected).toBe(false);
    expect(result.current.room).toBeNull();
  });

  it("should call init and load from localStorage", () => {
    localStorage.setItem("nickname", "TestUser");
    localStorage.setItem("participantId", "1234");

    const { result } = renderHook(() => useStore());
    act(() => {
      result.current.init();
    });

    expect(result.current.nickname).toBe("TestUser");
    expect(result.current.participantId).toBe("1234");
  });

  it("increments the transport epoch once per connected-to-disconnected transition", () => {
    const { result } = renderHook(() => useStore());
    const room = roomWithParticipants(3);
    localStorage.setItem("sessionToken", "token");
    act(() => {
      useStore.setState({
        room,
        participantId: "p0",
        sessionToken: "token",
        commandSequence: room.sequence,
        canonicalDeliveryVersion: 7,
        isConnected: true,
        connectionEpoch: 4,
      });
      result.current.init();
    });
    const onDisconnected = vi
      .mocked(roomSocketService.on)
      .mock.calls.find(([event]) => event === "disconnected")?.[1];
    const onConnected = vi
      .mocked(roomSocketService.on)
      .mock.calls.find(([event]) => event === "connected")?.[1];

    expect(onDisconnected).toEqual(expect.any(Function));
    expect(onConnected).toEqual(expect.any(Function));
    act(() => {
      onDisconnected?.();
      onDisconnected?.();
    });
    expect(result.current.isConnected).toBe(false);
    expect(result.current.connectionEpoch).toBe(5);
    expect(result.current.connectionDeliveryFloor).toBe(7);

    act(() => {
      onConnected?.();
      onConnected?.();
    });
    expect(result.current.isConnected).toBe(true);
    expect(result.current.connectionEpoch).toBe(5);
    expect(roomSocketService.joinRoom).toHaveBeenCalledOnce();
    expect(roomSocketService.upgradeSession).toHaveBeenCalledOnce();

    act(() => onDisconnected?.());
    expect(result.current.connectionEpoch).toBe(6);
  });

  it("reduces participant lifecycle events through one exhaustive room listener", () => {
    const { result } = renderHook(() => useStore());
    act(() => {
      useStore.setState({
        room: roomWithParticipants(3, { leaderId: "p0" }),
        participantId: "p2",
      });
      result.current.init();
    });
    const onRoomEvent = vi.mocked(roomSocketService.onRoomEvent).mock
      .calls[0]?.[0];
    expect(onRoomEvent).toEqual(expect.any(Function));

    act(() => {
      onRoomEvent({ type: "participant_disconnected", participantId: "p1" });
    });
    expect(result.current.room?.participants.p1.connection).toBe(
      "reconnecting",
    );

    act(() => {
      onRoomEvent({
        type: "participant_reconnected",
        participant: { ...participant("p1", "viewer", 1), nickname: "Back" },
      });
      onRoomEvent({
        type: "participant_health",
        participantId: "p1",
        health: "buffering",
      });
      onRoomEvent({
        type: "participant_left",
        participantId: "p0",
        ownerId: "p1",
      });
    });

    expect(result.current.room?.participants.p0).toBeUndefined();
    expect(result.current.room?.leaderId).toBeNull();
    expect(result.current.room?.participants.p1).toMatchObject({
      nickname: "Back",
      role: "owner",
      connection: "connected",
      playbackHealth: "buffering",
    });
  });

  it("applies compact playback monotonically within the current media epoch", () => {
    const { result } = renderHook(() => useStore());
    const room = roomWithParticipants(3);
    room.currentMediaId = "media-a";
    room.sequence = 10;
    room.playback = {
      status: "playing",
      basePosition: 10,
      baseTimestamp: 1_000,
      rate: 1,
      updatedBy: "p0",
    };
    act(() => {
      useStore.setState({ room, participantId: "p2" });
      result.current.init();
    });
    const onRoomEvent = vi.mocked(roomSocketService.onRoomEvent).mock
      .calls[0]?.[0];

    act(() => {
      onRoomEvent({
        type: "playback_updated",
        playback: {
          mediaItemId: "media-a",
          status: "playing",
          basePosition: 20,
          baseTimestamp: 2_000,
          rate: 1,
          sequence: 12,
          updatedBy: "p1",
        },
        serverTime: 2_000,
      });
      onRoomEvent({
        type: "playback_updated",
        playback: {
          mediaItemId: "media-a",
          status: "paused",
          basePosition: 5,
          baseTimestamp: 1_500,
          rate: 1,
          sequence: 11,
          updatedBy: "p0",
        },
        serverTime: 2_100,
      });
      onRoomEvent({
        type: "playback_updated",
        playback: {
          mediaItemId: "media-a",
          status: "paused",
          basePosition: 99,
          baseTimestamp: 3_000,
          rate: 1,
          sequence: 12,
          updatedBy: "p0",
        },
        serverTime: 3_000,
      });
      onRoomEvent({
        type: "playback_updated",
        playback: {
          mediaItemId: "media-old",
          status: "paused",
          basePosition: 1,
          baseTimestamp: 4_000,
          rate: 1,
          sequence: 13,
          updatedBy: "p0",
        },
        serverTime: 4_000,
      });
      onRoomEvent({
        type: "room_state",
        room: {
          ...room,
          sequence: 11,
          playback: {
            ...room.playback,
            status: "paused",
            basePosition: 3,
          },
        },
        serverTime: 4_100,
      });
    });

    expect(result.current.room).toMatchObject({
      currentMediaId: "media-a",
      sequence: 12,
      playback: {
        status: "playing",
        basePosition: 20,
        baseTimestamp: 2_000,
        updatedBy: "p1",
      },
    });
  });

  it("enforces exactly one owner when a leave event supplies ownerId", () => {
    const { result } = renderHook(() => useStore());
    act(() => {
      useStore.setState({
        room: roomWithParticipants(3, { moderatorIds: ["p1"] }),
        participantId: "p1",
      });
      result.current.init();
    });
    const onRoomEvent = vi.mocked(roomSocketService.onRoomEvent).mock
      .calls[0]?.[0];

    act(() => {
      onRoomEvent({
        type: "participant_left",
        participantId: "p2",
        ownerId: "p1",
      });
    });

    expect(result.current.room?.participants.p1.role).toBe("owner");
    expect(result.current.room?.participants.p0.role).toBe("viewer");
    expect(
      Object.values(result.current.room?.participants ?? {}).filter(
        (participant) => participant.role === "owner",
      ),
    ).toHaveLength(1);
  });

  it("delivers one room event after connect, disconnect, and reconnect", async () => {
    const actual =
      await vi.importActual<typeof import("../socket")>("../socket");
    const service = new actual.RoomSocketService();
    const onRoomEvent = vi.fn();
    service.onRoomEvent(onRoomEvent);

    service.connect("room-a", "Friend", "p0", "token");
    service.disconnect();
    service.connect("room-a", "Friend", "p0", "token");
    socketDouble.serverEmit("participant_joined", participant("p1"));

    expect(onRoomEvent).toHaveBeenCalledOnce();
  });

  it("correlates client command envelopes with command acknowledgements", async () => {
    const actual =
      await vi.importActual<typeof import("../socket")>("../socket");
    const service = new actual.RoomSocketService();
    const onAcknowledgement = vi.fn();
    service.on("command_ack", onAcknowledgement);
    service.connect("room-a", "Friend", "p0", "token");
    socketDouble.emit.mockClear();

    const nonce = service.sendCommand("room-a", 7, "pause", {
      position: 12,
    });
    const commandCall = socketDouble.emit.mock.calls.find(
      ([event]) => event === "command",
    );
    expect(nonce).toEqual(expect.any(String));
    expect(commandCall?.[1]).toEqual({
      roomId: "room-a",
      nonce,
      clientSequence: 7,
      command: { type: "pause", payload: { position: 12 } },
    });

    const ack = {
      nonce,
      status: "rejected",
      code: "NOT_PERMITTED",
      message: "You do not have permission to perform this action.",
    };
    socketDouble.serverEmit("command_ack", ack);
    expect(onAcknowledgement).toHaveBeenCalledWith(ack);
  });

  it("requests an authoritative room snapshot without joining or sending a command", async () => {
    const actual =
      await vi.importActual<typeof import("../socket")>("../socket");
    const service = new actual.RoomSocketService();
    service.connect("room-a", "Friend", "p0", "token");
    socketDouble.emit.mockClear();

    service.requestRoomState("room-a");

    expect(socketDouble.emit).toHaveBeenCalledOnce();
    expect(socketDouble.emit).toHaveBeenCalledWith("request_room_state", {
      roomId: "room-a",
    });
  });

  it("sends participant health outside the canonical command channel", async () => {
    const actual =
      await vi.importActual<typeof import("../socket")>("../socket");
    const service = new actual.RoomSocketService();
    service.connect("room-a", "Friend", "p0", "token");
    socketDouble.emit.mockClear();

    service.sendParticipantHealth("buffering");

    expect(socketDouble.emit).toHaveBeenCalledOnce();
    expect(socketDouble.emit).toHaveBeenCalledWith("participant_health", {
      health: "buffering",
    });
    expect(
      socketDouble.emit.mock.calls.some(([event]) => event === "command"),
    ).toBe(false);
  });

  it("round-trips the player's pending nonce through the command envelope and compact playback acknowledgement", async () => {
    const actualSocket =
      await vi.importActual<typeof import("../socket")>("../socket");
    const client = new actualSocket.RoomSocketService();
    const intentManager = new PlaybackIntentManager();
    const room = roomWithParticipants(2);
    const serverEvents: any[] = [];
    const server = new RoomCommandService({
      repository: new InMemoryRoomRepository([room], () => 10_000),
      eventBus: new RoomEventBus((_roomId, event) => serverEvents.push(event)),
      now: () => 10_000,
    });
    client.onRoomEvent((event) => {
      if (event.type === "playback_updated") {
        intentManager.acknowledgeServerNonce(event.playback.lastActionNonce);
      }
    });
    client.connect(room.id, "p0", "p0", "token");
    socketDouble.emit.mockClear();

    const intentNonce = randomUUID();
    intentManager.markCommandEmitted("playing", 12, intentNonce);
    const returnedNonce = client.sendCommand(room.id, 2, "play", {
      position: 12,
      nonce: intentNonce,
    });
    const emittedEnvelope = socketDouble.emit.mock.calls.find(
      ([event]) => event === "command",
    )?.[1];

    expect(returnedNonce).toBe(intentNonce);
    expect(emittedEnvelope.nonce).toBe(intentNonce);
    expect(intentManager.isAwaitingServerAck()).toBe(true);

    const ack = await server.execute(
      { currentRoomId: room.id, currentParticipantId: "p0" },
      emittedEnvelope,
    );
    expect(ack).toMatchObject({ nonce: intentNonce, status: "applied" });
    const playbackEvent = serverEvents[0];
    expect(playbackEvent.playback.lastActionNonce).toBe(intentNonce);

    socketDouble.serverEmit("playback_updated", {
      playback: playbackEvent.playback,
      serverTime: playbackEvent.serverTime,
    });
    expect(intentManager.isAwaitingServerAck()).toBe(false);
  });

  it("stores rejected acknowledgements as visible command state", () => {
    const { result } = renderHook(() => useStore());
    act(() => {
      result.current.init();
    });
    const onAck = vi
      .mocked(roomSocketService.on)
      .mock.calls.find(([event]) => event === "command_ack")?.[1];

    expect(onAck).toEqual(expect.any(Function));
    act(() => {
      onAck?.({
        nonce: "00000000-0000-4000-8000-000000000099",
        status: "rejected",
        code: "NOT_PERMITTED",
        message: "You do not have permission to perform this action.",
      });
    });

    expect(result.current.lastCommandAcknowledgement).toMatchObject({
      status: "rejected",
      code: "NOT_PERMITTED",
    });
    expect(result.current.commandError).toBe(
      "You do not have permission to perform this action.",
    );
  });

  it("coalesces rejected acknowledgements into one authoritative snapshot request", () => {
    const { result } = renderHook(() => useStore());
    const room = roomWithParticipants(2);
    act(() => {
      result.current.init();
      useStore.setState({
        room,
        isConnected: true,
        participantId: "p0",
        nickname: "Owner",
        connectionEpoch: 4,
        connectionDeliveryFloor: 9,
        canonicalDeliveryVersion: 12,
      });
    });
    const onAck = vi
      .mocked(roomSocketService.on)
      .mock.calls.find(([event]) => event === "command_ack")?.[1];
    const onRoomEvent = vi.mocked(roomSocketService.onRoomEvent).mock
      .calls[0]?.[0];

    act(() => {
      onAck?.({
        nonce: "00000000-0000-4000-8000-000000000100",
        status: "rejected",
        code: "NOT_PERMITTED",
        message: "You no longer have permission to manage the queue.",
      });
      onAck?.({
        nonce: "00000000-0000-4000-8000-000000000101",
        status: "rejected",
        code: "NOT_PERMITTED",
        message: "You no longer have permission to manage the queue.",
      });
    });

    expect(roomSocketService.requestRoomState).toHaveBeenCalledOnce();
    expect(roomSocketService.requestRoomState).toHaveBeenCalledWith(room.id);
    expect(roomSocketService.sendCommand).not.toHaveBeenCalled();
    expect(roomSocketService.joinRoom).not.toHaveBeenCalled();
    expect(result.current.participantId).toBe("p0");
    expect(result.current.connectionEpoch).toBe(4);
    expect(result.current.connectionDeliveryFloor).toBe(9);

    act(() => {
      onRoomEvent?.({
        type: "room_state",
        room: {
          ...room,
          sequence: room.sequence + 1,
          participants: {
            ...room.participants,
            p0: { ...room.participants.p0, role: "viewer" },
          },
        },
        serverTime: 10_000,
      });
    });

    expect(result.current.room?.participants.p0.role).toBe("viewer");
    expect(result.current.room?.sequence).toBe(room.sequence + 1);
    expect(result.current.connectionEpoch).toBe(4);
    expect(result.current.connectionDeliveryFloor).toBe(9);
  });

  it("does not refresh the room after a rate-limited command acknowledgement", () => {
    const { result } = renderHook(() => useStore());
    const room = roomWithParticipants(2);
    act(() => {
      result.current.init();
      useStore.setState({ room, isConnected: true, participantId: "p0" });
    });
    const onAck = vi
      .mocked(roomSocketService.on)
      .mock.calls.find(([event]) => event === "command_ack")?.[1];

    act(() => {
      onAck?.({
        nonce: "00000000-0000-4000-8000-000000000199",
        status: "rejected",
        code: "RATE_LIMITED",
        message: "Too many commands. Please wait before trying again.",
      });
    });

    expect(result.current.lastCommandAcknowledgement).toMatchObject({
      nonce: "00000000-0000-4000-8000-000000000199",
      code: "RATE_LIMITED",
    });
    expect(roomSocketService.requestRoomState).not.toHaveBeenCalled();
  });

  it("adopts the server-issued participant id before joining", async () => {
    const { result } = renderHook(() => useStore());
    const serverParticipantId = "01890f3e-4c4d-7cc2-8d8c-123456789398";
    localStorage.setItem("participantId", "stale-local-participant");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            participantId: serverParticipantId,
            token: "server-session-token",
          }),
          { status: 200 },
        ),
      ),
    );
    act(() => result.current.init());

    await act(async () => {
      await result.current.connect("room-a", "Friend");
    });

    expect(result.current.participantId).toBe(serverParticipantId);
    expect(localStorage.getItem("participantId")).toBe(serverParticipantId);
    expect(roomSocketService.connect).toHaveBeenCalledWith(
      "room-a",
      "Friend",
      serverParticipantId,
      "server-session-token",
    );
    vi.unstubAllGlobals();
  });

  it("does not request a snapshot for rejected acknowledgements without a live room", () => {
    const { result } = renderHook(() => useStore());
    act(() => {
      result.current.init();
    });
    const onAck = vi
      .mocked(roomSocketService.on)
      .mock.calls.find(([event]) => event === "command_ack")?.[1];

    act(() => {
      onAck?.({
        nonce: "00000000-0000-4000-8000-000000000102",
        status: "rejected",
        code: "NOT_JOINED",
      });
    });

    expect(roomSocketService.requestRoomState).not.toHaveBeenCalled();
  });

  it("should update nickname and omit emitting if not connected", () => {
    const { result } = renderHook(() => useStore());

    act(() => {
      result.current.setNickname("NewName");
    });

    expect(result.current.nickname).toBe("NewName");
    expect(localStorage.getItem("nickname")).toBe("NewName");
    expect(roomSocketService.sendCommand).not.toHaveBeenCalled();
  });

  it("should emit update_nickname if connected and in a room", () => {
    const { result } = renderHook(() => useStore());

    act(() => {
      useStore.setState({
        isConnected: true,
        room: { id: "room1", sequence: 1 } as any,
      });
      result.current.setNickname("EmitName");
    });

    expect(roomSocketService.sendCommand).toHaveBeenCalledWith(
      "room1",
      2,
      "update_nickname",
      { nickname: "EmitName" },
      null,
    );
  });

  it("should handle disconnect", () => {
    const { result } = renderHook(() => useStore());
    act(() => {
      useStore.setState({ isConnected: true, room: { id: "1" } as any });
      result.current.disconnect();
    });

    expect(roomSocketService.disconnect).toHaveBeenCalled();
    expect(result.current.isConnected).toBe(false);
    expect(result.current.room).toBeNull();
  });

  it("should pass fast-path command payloads through unchanged — nonce injected upstream by emitCommand (TC-101)", () => {
    const { result } = renderHook(() => useStore());
    act(() => {
      useStore.setState({
        isConnected: true,
        room: { id: "room1", sequence: 1 } as any,
      });
      // Nonce is now injected by emitCommand (Player.tsx), not sendCommand.
      result.current.sendCommand("play", {
        position: 10,
        nonce: "upstream-nonce",
      });
    });

    expect(roomSocketService.sendCommand).toHaveBeenCalledWith(
      "room1",
      2,
      "play",
      expect.objectContaining({ position: 10, nonce: "upstream-nonce" }),
      null,
    );
  });
});
