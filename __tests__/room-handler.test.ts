/**
 * @vitest-environment node
 */
import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type Mock,
} from "vitest";
import {
  createEmptyRoom,
  normalizeRoomState,
  registerRoomHandlers,
  sanitizeRoom,
} from "../lib/room-handler";
import * as redisRateLimit from "../lib/redis-rate-limit";
import * as redisActor from "../lib/redis-actor";
import * as redisLua from "../lib/redis-lua";
import * as dbSync from "../lib/db-sync";
import { Server, Socket } from "socket.io";
import { SignJWT } from "jose";
import { PARTICIPANT_GRACE_MS } from "../lib/participant-lifecycle";
import { RoomEventBus } from "../lib/room-event-bus";

vi.mock("../lib/redis-rate-limit", () => ({
  checkRedisRateLimit: vi.fn(),
  getRedisClient: vi.fn(),
}));

vi.mock("../lib/redis-actor", () => ({
  getRedisRoom: vi.fn(),
  setRedisRoomCAS: vi.fn(),
  publishRoomEvent: vi.fn().mockResolvedValue(true),
  pubClient: vi.fn().mockReturnValue(null),
}));

vi.mock("../lib/db-sync", () => ({
  persistRoomState: vi.fn(),
  loadRoomFromDB: vi.fn(),
  isSystemDegraded: vi.fn().mockResolvedValue(false),
  markRoomForSync: vi.fn(),
}));

vi.mock("../lib/room-logic", async () => {
  const actual =
    await vi.importActual<typeof import("../lib/room-logic")>(
      "../lib/room-logic",
    );
  return actual;
});

vi.mock("../lib/redis-lua", () => ({
  executeFastMutation: vi.fn().mockResolvedValue({
    success: false,
    error: "REDIS_REQUIRED",
  }),
}));

describe("Room Handler Security & Auth Boundary", () => {
  let mockIo: Partial<Server>;
  let mockSocket: any;
  let socketEventHandlers: Record<string, Function>;
  let roomEmit: Mock<(event: string, payload: any) => void>;
  let joiningSocketRoomEmit: Mock<(event: string, payload: any) => void>;
  let roomExcept: Mock<
    (excludedSocketId: string) => {
      emit: (event: string, payload: any) => void;
    }
  >;

  beforeEach(() => {
    vi.clearAllMocks();
    (redisRateLimit.checkRedisRateLimit as any).mockResolvedValue(true);

    socketEventHandlers = {};

    roomEmit = vi.fn();
    joiningSocketRoomEmit = vi.fn();
    roomExcept = vi.fn((excludedSocketId: string) => ({
      emit: (event: string, payload: any) => {
        roomEmit(event, payload);
        if (excludedSocketId !== "mock-socket-id") {
          joiningSocketRoomEmit(event, payload);
        }
      },
    }));
    mockIo = {
      to: vi.fn().mockReturnValue({
        emit: (event: string, payload: any) => {
          roomEmit(event, payload);
          joiningSocketRoomEmit(event, payload);
        },
        except: roomExcept,
      }),
    };

    mockSocket = {
      id: "mock-socket-id",
      data: { participantId: "fallback_mock-socket-id" },
      handshake: { headers: {}, address: "127.0.0.1" },
      join: vi.fn(),
      emit: vi.fn(),
      on: vi.fn((event, handler) => {
        socketEventHandlers[event] = handler;
      }),
      to: vi.fn().mockReturnValue({ emit: vi.fn() }),
    };

    // Initialize handlers
    registerRoomHandlers(mockIo as Server, mockSocket as Socket, null);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const upgradeToken = (participantId: string, nickname: string) =>
    new SignJWT({ participantId, nickname })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode("default_local_secret_dont_use_in_prod"));

  it("transfers the upgrading socket and removes the replacement identity after final grace without leaking connection IDs", async () => {
    const roomId = "upgrade-connection-room";
    const fallbackId = "fallback-upgrade";
    const accountId = "account-upgrade";
    let storedRoom = createEmptyRoom(roomId, "Upgrade Room");
    storedRoom.participants[fallbackId] = {
      id: fallbackId,
      nickname: "Fallback",
      role: "owner",
      joinedAt: 1,
      lastSeen: 1,
      connection: "connected",
      playbackHealth: "idle",
      readyMediaId: null,
    };
    (redisActor.getRedisRoom as any).mockImplementation(async () =>
      structuredClone(storedRoom),
    );
    (redisActor.setRedisRoomCAS as any).mockImplementation(
      async (_roomId: string, nextRoom: any) => {
        storedRoom = structuredClone(nextRoom);
        return true;
      },
    );

    mockSocket.data.participantId = fallbackId;
    await socketEventHandlers.join_room({ roomId, nickname: "Fallback" });
    roomEmit.mockClear();
    await socketEventHandlers.command({
      roomId,
      type: "upgrade_session",
      payload: { token: await upgradeToken(accountId, "Account") },
      sequence: 2,
    });

    expect(storedRoom.participants[fallbackId]).toBeUndefined();
    expect(storedRoom.participants[accountId].connectionIds).toEqual([
      mockSocket.id,
    ]);
    const upgradeSnapshot = roomEmit.mock.calls.find(
      ([event]) => event === "room_state",
    )?.[1].room;
    expect(
      upgradeSnapshot.participants[accountId].connectionIds,
    ).toBeUndefined();

    vi.useFakeTimers();
    socketEventHandlers.disconnect();
    await vi.advanceTimersByTimeAsync(0);
    expect(storedRoom.participants[accountId].connection).toBe("reconnecting");

    await vi.advanceTimersByTimeAsync(PARTICIPANT_GRACE_MS);
    expect(storedRoom.participants[accountId]).toBeUndefined();
    expect(
      roomEmit.mock.calls.filter(
        ([event, payload]) =>
          event === "participant_left" && payload.participantId === accountId,
      ),
    ).toHaveLength(1);
  });

  it("merges the upgrading socket into an existing target identity and sanitizes the Redis event", async () => {
    const roomId = "upgrade-existing-target-room";
    const fallbackId = "fallback-existing";
    const accountId = "account-existing";
    let storedRoom = createEmptyRoom(roomId, "Existing Target Room");
    storedRoom.participants[fallbackId] = {
      id: fallbackId,
      nickname: "Fallback",
      role: "owner",
      joinedAt: 1,
      lastSeen: 1,
      connection: "connected",
      connectionIds: ["secondary-fallback-socket"],
      playbackHealth: "idle",
      readyMediaId: null,
    };
    storedRoom.participants[accountId] = {
      id: accountId,
      nickname: "Account",
      role: "viewer",
      joinedAt: 2,
      lastSeen: 2,
      connection: "connected",
      connectionIds: ["existing-target-socket"],
      playbackHealth: "idle",
      readyMediaId: null,
    };
    (redisActor.getRedisRoom as any).mockImplementation(async () =>
      structuredClone(storedRoom),
    );
    (redisActor.setRedisRoomCAS as any).mockImplementation(
      async (_roomId: string, nextRoom: any) => {
        storedRoom = structuredClone(nextRoom);
        return true;
      },
    );

    mockSocket.data.participantId = fallbackId;
    await socketEventHandlers.join_room({ roomId, nickname: "Fallback" });
    (redisActor.pubClient as any).mockReturnValue({ publish: vi.fn() });
    await socketEventHandlers.command({
      roomId,
      type: "upgrade_session",
      payload: { token: await upgradeToken(accountId, "Signed Account") },
      sequence: 2,
    });

    expect(storedRoom.participants[fallbackId]).toMatchObject({
      role: "owner",
      connection: "connected",
      connectionIds: ["secondary-fallback-socket"],
    });
    expect(storedRoom.participants[accountId]).toMatchObject({
      nickname: "Signed Account",
      role: "viewer",
      connection: "connected",
      connectionIds: ["existing-target-socket", mockSocket.id],
    });
    const stateUpdate = roomEmit.mock.calls.find(
      ([event]) => event === "room_state",
    )?.[1];
    expect(
      stateUpdate.room.participants[accountId].connectionIds,
    ).toBeUndefined();
  });

  it("commits an existing-target upgrade after one CAS conflict before changing socket identity once", async () => {
    const roomId = "upgrade-transaction-retry-room";
    const sourceId = "fallback-transaction-source";
    const targetId = "account-transaction-target";
    let storedRoom = createEmptyRoom(roomId, "Transactional Upgrade Room");
    storedRoom.participants[sourceId] = {
      id: sourceId,
      nickname: "Source",
      role: "owner",
      joinedAt: 1,
      lastSeen: 1,
      connection: "connected",
      playbackHealth: "idle",
      readyMediaId: null,
    };
    storedRoom.participants[targetId] = {
      id: targetId,
      nickname: "Existing Target",
      role: "viewer",
      joinedAt: 2,
      lastSeen: 2,
      connection: "connected",
      connectionIds: [],
      playbackHealth: "idle",
      readyMediaId: null,
    };
    (redisActor.getRedisRoom as any).mockImplementation(async () =>
      structuredClone(storedRoom),
    );
    (redisActor.setRedisRoomCAS as any).mockImplementation(
      async (_roomId: string, nextRoom: any) => {
        storedRoom = structuredClone(nextRoom);
        return true;
      },
    );
    mockSocket.data.participantId = sourceId;
    await socketEventHandlers.join_room({ roomId, nickname: "Source" });

    const candidates: any[] = [];
    let commandCasCalls = 0;
    (redisActor.setRedisRoomCAS as any).mockImplementation(
      async (_roomId: string, nextRoom: any) => {
        commandCasCalls++;
        candidates.push(structuredClone(nextRoom));
        if (commandCasCalls === 1) return false;
        storedRoom = structuredClone(nextRoom);
        return true;
      },
    );
    mockSocket.emit.mockClear();

    await socketEventHandlers.command({
      roomId,
      type: "upgrade_session",
      payload: { token: await upgradeToken(targetId, "Committed Target") },
      sequence: 2,
    });

    expect(commandCasCalls).toBe(2);
    expect(candidates).toHaveLength(2);
    for (const candidate of candidates) {
      expect(candidate.participants[sourceId]).toBeUndefined();
      expect(candidate.participants[targetId].connectionIds).toEqual([
        mockSocket.id,
      ]);
      expect(
        Object.values(candidate.participants).flatMap(
          (participant: any) => participant.connectionIds ?? [],
        ),
      ).toEqual([mockSocket.id]);
    }
    expect(storedRoom.participants[sourceId]).toBeUndefined();
    expect(storedRoom.participants[targetId]).toMatchObject({
      nickname: "Committed Target",
      role: "owner",
      connectionIds: [mockSocket.id],
    });
    expect(mockSocket.data.participantId).toBe(targetId);
    expect(
      mockSocket.emit.mock.calls.filter(
        ([event]: any[]) => event === "session_upgraded",
      ),
    ).toEqual([["session_upgraded", { participantId: targetId }]]);

    vi.useFakeTimers();
    socketEventHandlers.disconnect();
    await vi.advanceTimersByTimeAsync(0);
    expect(storedRoom.participants[targetId].connection).toBe("reconnecting");
    await vi.advanceTimersByTimeAsync(PARTICIPANT_GRACE_MS);
    expect(storedRoom.participants[targetId]).toBeUndefined();
    expect(
      roomEmit.mock.calls.filter(
        ([event, payload]) =>
          event === "participant_left" && payload.participantId === targetId,
      ),
    ).toHaveLength(1);
  });

  it("keeps a committed session upgrade applied when remote publication fails", async () => {
    const roomId = "upgrade-publication-failure-room";
    const sourceId = "fallback-publication-source";
    const targetId = "account-publication-target";
    let storedRoom = createEmptyRoom(roomId, "Publication Failure Room");
    storedRoom.participants[sourceId] = {
      id: sourceId,
      nickname: "Source",
      role: "owner",
      joinedAt: 1,
      lastSeen: 1,
      connection: "connected",
      connectionIds: [mockSocket.id],
      playbackHealth: "idle",
      readyMediaId: null,
    };
    (redisActor.getRedisRoom as any).mockImplementation(async () =>
      structuredClone(storedRoom),
    );
    (redisActor.setRedisRoomCAS as any).mockImplementation(
      async (_roomId: string, nextRoom: any) => {
        storedRoom = structuredClone(nextRoom);
        return true;
      },
    );
    const publish = vi.fn().mockRejectedValue(new Error("redis unavailable"));
    const eventBus = new RoomEventBus(
      (eventRoomId, event) => {
        if (event.type === "room_state") {
          mockIo.to?.(eventRoomId).emit("room_state", {
            room: event.room,
            serverTime: event.serverTime,
          });
        }
      },
      { publish },
    );
    socketEventHandlers = {};
    registerRoomHandlers(
      mockIo as Server,
      mockSocket as Socket,
      null,
      eventBus,
    );

    mockSocket.data.participantId = sourceId;
    await socketEventHandlers.join_room({ roomId, nickname: "Source" });
    mockSocket.emit.mockClear();
    roomEmit.mockClear();

    await socketEventHandlers.command({
      roomId,
      type: "upgrade_session",
      payload: { token: await upgradeToken(targetId, "Committed Target") },
      sequence: 2,
    });

    expect(storedRoom.participants[sourceId]).toBeUndefined();
    expect(storedRoom.participants[targetId].connectionIds).toContain(
      mockSocket.id,
    );
    expect(mockSocket.data.participantId).toBe(targetId);
    expect(
      mockSocket.emit.mock.calls.filter(
        ([event]: any[]) => event === "session_upgraded",
      ),
    ).toEqual([["session_upgraded", { participantId: targetId }]]);
    const acknowledgements = mockSocket.emit.mock.calls
      .filter(([event]: any[]) => event === "command_ack")
      .map(([, acknowledgement]: any[]) => acknowledgement);
    expect(acknowledgements).toHaveLength(1);
    expect(acknowledgements[0]).toMatchObject({ status: "applied" });
    expect(
      roomEmit.mock.calls.filter(([event]: any[]) => event === "room_state"),
    ).toHaveLength(1);
    expect(
      mockSocket.emit.mock.calls.filter(([event]: any[]) => event === "error"),
    ).toEqual([]);
  });

  it("keeps the source identity authoritative when every upgrade CAS attempt conflicts", async () => {
    const roomId = "upgrade-transaction-failure-room";
    const sourceId = "fallback-failed-source";
    const targetId = "account-never-committed";
    let storedRoom = createEmptyRoom(roomId, "Failed Upgrade Room");
    storedRoom.participants[sourceId] = {
      id: sourceId,
      nickname: "Source",
      role: "owner",
      joinedAt: 1,
      lastSeen: 1,
      connection: "connected",
      playbackHealth: "idle",
      readyMediaId: null,
    };
    (redisActor.getRedisRoom as any).mockImplementation(async () =>
      structuredClone(storedRoom),
    );
    (redisActor.setRedisRoomCAS as any).mockImplementation(
      async (_roomId: string, nextRoom: any) => {
        storedRoom = structuredClone(nextRoom);
        return true;
      },
    );
    mockSocket.data.participantId = sourceId;
    await socketEventHandlers.join_room({ roomId, nickname: "Source" });

    (redisActor.setRedisRoomCAS as any).mockResolvedValue(false);
    (redisActor.setRedisRoomCAS as any).mockClear();
    vi.spyOn(Math, "random").mockReturnValue(0);
    mockSocket.emit.mockClear();
    await socketEventHandlers.command({
      roomId,
      type: "upgrade_session",
      payload: { token: await upgradeToken(targetId, "Never Committed") },
      sequence: 2,
    });

    expect(redisActor.setRedisRoomCAS).toHaveBeenCalledTimes(10);
    expect(mockSocket.data.participantId).toBe(sourceId);
    expect(storedRoom.participants[sourceId]).toMatchObject({
      role: "owner",
      connection: "connected",
      connectionIds: [mockSocket.id],
    });
    expect(storedRoom.participants[targetId]).toBeUndefined();
    expect(
      mockSocket.emit.mock.calls.filter(
        ([event]: any[]) => event === "session_upgraded",
      ),
    ).toHaveLength(0);
    const acknowledgements = mockSocket.emit.mock.calls
      .filter(([event]: any[]) => event === "command_ack")
      .map(([, acknowledgement]: any[]) => acknowledgement);
    expect(acknowledgements).toHaveLength(1);
    expect(acknowledgements[0]).toMatchObject({
      status: "rejected",
      code: "CONTENTION",
      message: "System busy acquiring room lock. Try again.",
    });
    expect(mockSocket.emit).toHaveBeenCalledWith("error", {
      message: "System busy acquiring room lock. Try again.",
    });
  });

  it("retries a same-identity upgrade without duplicating ownership or success events", async () => {
    const roomId = "upgrade-same-identity-room";
    const participantId = "same-identity";
    let storedRoom = createEmptyRoom(roomId, "Same Identity Room");
    storedRoom.participants[participantId] = {
      id: participantId,
      nickname: "Before",
      role: "owner",
      joinedAt: 1,
      lastSeen: 1,
      connection: "connected",
      playbackHealth: "idle",
      readyMediaId: null,
    };
    (redisActor.getRedisRoom as any).mockImplementation(async () =>
      structuredClone(storedRoom),
    );
    (redisActor.setRedisRoomCAS as any).mockImplementation(
      async (_roomId: string, nextRoom: any) => {
        storedRoom = structuredClone(nextRoom);
        return true;
      },
    );
    mockSocket.data.participantId = participantId;
    await socketEventHandlers.join_room({ roomId, nickname: "Before" });

    let commandCasCalls = 0;
    (redisActor.setRedisRoomCAS as any).mockImplementation(
      async (_roomId: string, nextRoom: any) => {
        commandCasCalls++;
        if (commandCasCalls === 1) return false;
        storedRoom = structuredClone(nextRoom);
        return true;
      },
    );
    mockSocket.emit.mockClear();
    await socketEventHandlers.command({
      roomId,
      type: "upgrade_session",
      payload: { token: await upgradeToken(participantId, "After") },
      sequence: 2,
    });

    expect(commandCasCalls).toBe(2);
    expect(Object.keys(storedRoom.participants)).toEqual([participantId]);
    expect(storedRoom.participants[participantId]).toMatchObject({
      nickname: "After",
      connectionIds: [mockSocket.id],
    });
    expect(mockSocket.data.participantId).toBe(participantId);
    expect(
      mockSocket.emit.mock.calls.filter(
        ([event]: any[]) => event === "session_upgraded",
      ),
    ).toEqual([["session_upgraded", { participantId }]]);
  });

  it("broadcasts the repaired owner when joining an ownerless room promotes another participant", async () => {
    const roomId = "ownerless-recovery-room";
    let storedRoom = createEmptyRoom(roomId, "Ownerless Room");
    storedRoom.participants.moderator = {
      id: "moderator",
      nickname: "Moderator",
      role: "moderator",
      joinedAt: 1,
      lastSeen: 1,
      connection: "connected",
      connectionIds: ["moderator-socket"],
      playbackHealth: "idle",
      readyMediaId: null,
    };
    (redisActor.getRedisRoom as any).mockImplementation(async () =>
      structuredClone(storedRoom),
    );
    (redisActor.setRedisRoomCAS as any).mockImplementation(
      async (_roomId: string, nextRoom: any) => {
        storedRoom = structuredClone(nextRoom);
        return true;
      },
    );

    mockSocket.data.participantId = "new-viewer";
    await socketEventHandlers.join_room({ roomId, nickname: "New Viewer" });

    expect(storedRoom.participants.moderator.role).toBe("owner");
    const repairedSnapshot = roomEmit.mock.calls.find(
      ([event]) => event === "room_state",
    )?.[1].room;
    expect(repairedSnapshot.participants.moderator.role).toBe("owner");
    expect(
      Object.values(repairedSnapshot.participants).filter(
        (participant: any) => participant.role === "owner",
      ),
    ).toHaveLength(1);
    expect(roomExcept).toHaveBeenCalledWith(mockSocket.id);
    expect(
      mockSocket.emit.mock.calls.filter(
        ([event]: any[]) => event === "room_state",
      ),
    ).toHaveLength(1);
    expect(
      joiningSocketRoomEmit.mock.calls.filter(
        ([event]: any[]) => event === "room_state",
      ),
    ).toHaveLength(0);
    expect(
      roomEmit.mock.calls.filter(([event]) => event === "room_state"),
    ).toHaveLength(1);
  });

  it("TC-U02: Fallback users command passes socket validation (Guest concept removed)", async () => {
    // ==========================================
    // ARRANGE: Setup an established room and a Fallback user
    // ==========================================
    const roomId = "test-room-auth";
    const fallbackId = "fallback_123";

    const mockRoom = createEmptyRoom(roomId, "Auth Room");
    mockRoom.participants[fallbackId] = {
      id: fallbackId,
      nickname: "Fallback123",
      role: "viewer",
      joinedAt: 0,
      lastSeen: Date.now(),
      connection: "connected",
      playbackHealth: "idle",
      readyMediaId: null,
    };

    (redisActor.getRedisRoom as any).mockResolvedValue(mockRoom);
    (redisActor.setRedisRoomCAS as any).mockResolvedValue(true);

    // Simulate join_room to set current keys
    mockSocket.data.participantId = fallbackId;
    await socketEventHandlers["join_room"]({ roomId, nickname: "Fallback123" });

    // Ensure mock room was fetched and the user successfully joined
    expect(mockSocket.join).toHaveBeenCalledWith(roomId);

    // ==========================================
    // ACT: Fallback attempts a slow-path mutation (e.g. add_item)
    // ==========================================
    const payload = {
      roomId,
      type: "add_item",
      payload: { url: "http://example.com" },
      sequence: 1,
    };

    // Clear emit logs to isolate command response
    mockSocket.emit.mockClear();

    await socketEventHandlers["command"](payload);

    // ==========================================
    // ASSERT: Payload must not be rejected at the socket layer.
    // It should proceed to Lua/Queue checks (which are mocked).
    // ==========================================
    expect(mockSocket.emit).not.toHaveBeenCalledWith(
      "error",
      expect.anything(),
    );
  });

  it("does not reject playback commands through the global websocket command rate limit", async () => {
    const roomId = "test-room-playback-rate-limit";
    const participantId = "mod-123";

    const mockRoom = createEmptyRoom(roomId, "Playback Room");
    mockRoom.participants[participantId] = {
      id: participantId,
      nickname: "Mod",
      role: "moderator",
      joinedAt: 0,
      lastSeen: Date.now(),
      connection: "connected",
      connectionIds: [mockSocket.id],
      playbackHealth: "idle",
      readyMediaId: null,
    };
    mockRoom.currentMediaId = "media-1";
    mockRoom.playlist = [
      {
        id: "media-1",
        url: "https://example.com/video.mp4",
        provider: "direct",
        title: "Video",
        duration: 120,
        addedBy: "Mod",
      },
    ];

    (redisActor.getRedisRoom as any).mockResolvedValue(mockRoom);
    (redisActor.setRedisRoomCAS as any).mockResolvedValue(true);
    (redisRateLimit.checkRedisRateLimit as any).mockResolvedValue(true);

    mockSocket.data.participantId = participantId;
    await socketEventHandlers["join_room"]({ roomId, nickname: "Mod" });
    mockSocket.emit.mockClear();

    await socketEventHandlers["command"]({
      roomId,
      type: "pause",
      payload: { position: 10 },
      sequence: 2,
    });

    expect(mockSocket.emit).not.toHaveBeenCalledWith("error", {
      message: "Rate limit exceeded",
    });
    expect(redisRateLimit.checkRedisRateLimit).not.toHaveBeenCalledWith(
      expect.stringContaining("ws:command:"),
      expect.any(Number),
      expect.any(Number),
    );
  });

  it.each([
    ["v7", "01890f3e-4c4d-7cc2-8d8c-123456789301"],
    ["v8", "01890f3e-4c4d-8cc2-8d8c-123456789301"],
    ["nil", "00000000-0000-0000-0000-000000000000"],
  ])(
    "preserves an accepted %s nonce during degraded rejection",
    async (_kind, nonce) => {
      (dbSync.isSystemDegraded as any).mockResolvedValueOnce(true);
      mockSocket.emit.mockClear();

      await socketEventHandlers.command({
        roomId: "degraded-room",
        nonce,
        clientSequence: 1,
        command: { type: "pause", payload: { position: 10 } },
      });

      expect(mockSocket.emit).toHaveBeenCalledWith(
        "command_ack",
        expect.objectContaining({
          nonce,
          status: "rejected",
          message: "System is degraded, try again later.",
        }),
      );
    },
  );

  it("enforces the command size limit in UTF-8 bytes and preserves the nonce", async () => {
    const nonce = "01890f3e-4c4d-7cc2-8d8c-123456789305";
    mockSocket.emit.mockClear();

    await socketEventHandlers.command({
      roomId: "multibyte-room",
      nonce,
      clientSequence: 1,
      command: {
        type: "send_chat",
        payload: { message: "😀".repeat(13_000) },
      },
    });

    const acknowledgements = mockSocket.emit.mock.calls.filter(
      ([event]: any[]) => event === "command_ack",
    );
    expect(acknowledgements).toHaveLength(1);
    expect(acknowledgements[0]?.[1]).toMatchObject({
      nonce,
      status: "rejected",
      message: "Payload too large. Request rejected.",
    });
  });

  it.each([
    ["v7", "01890f3e-4c4d-7cc2-8d8c-123456789302"],
    ["v8", "01890f3e-4c4d-8cc2-8d8c-123456789302"],
    ["nil", "00000000-0000-0000-0000-000000000000"],
  ])(
    "preserves an accepted %s nonce during oversized rejection",
    async (_kind, nonce) => {
      mockSocket.emit.mockClear();

      await socketEventHandlers.command({
        roomId: "oversized-room",
        nonce,
        clientSequence: 1,
        command: {
          type: "send_chat",
          payload: { message: "x".repeat(50_001) },
        },
      });

      expect(mockSocket.emit).toHaveBeenCalledWith(
        "command_ack",
        expect.objectContaining({
          nonce,
          status: "rejected",
          message: "Payload too large. Request rejected.",
        }),
      );
    },
  );

  it.each([
    ["v7", "01890f3e-4c4d-7cc2-8d8c-123456789303"],
    ["v8", "01890f3e-4c4d-8cc2-8d8c-123456789303"],
    ["nil", "00000000-0000-0000-0000-000000000000"],
  ])(
    "preserves an accepted %s nonce when command serialization throws",
    async (_kind, nonce) => {
      const command: Record<string, unknown> = {
        roomId: "circular-room",
        nonce,
        clientSequence: 1,
        command: { type: "pause", payload: { position: 10 } },
      };
      command.circular = command;
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      mockSocket.emit.mockClear();

      await socketEventHandlers.command(command);

      const acknowledgements = mockSocket.emit.mock.calls.filter(
        ([event]: any[]) => event === "command_ack",
      );
      expect(acknowledgements).toHaveLength(1);
      expect(acknowledgements[0]?.[1]).toMatchObject({
        nonce,
        status: "rejected",
      });
      errorSpy.mockRestore();
    },
  );

  it("preserves a valid nonce when a custom serializer throws", async () => {
    const nonce = "01890f3e-4c4d-7cc2-8d8c-123456789304";
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockSocket.emit.mockClear();

    await socketEventHandlers.command({
      roomId: "throwing-room",
      nonce,
      clientSequence: 1,
      command: { type: "pause", payload: { position: 10 } },
      toJSON() {
        throw new Error("serializer-failed");
      },
    });

    const acknowledgements = mockSocket.emit.mock.calls.filter(
      ([event]: any[]) => event === "command_ack",
    );
    expect(acknowledgements).toHaveLength(1);
    expect(acknowledgements[0]?.[1]).toMatchObject({
      nonce,
      status: "rejected",
    });
    errorSpy.mockRestore();
  });

  it.each([
    ["missing", undefined],
    ["invalid", "not-a-uuid"],
  ])(
    "uses invalid for a %s nonce on an early degraded rejection",
    async (_label, nonce) => {
      (dbSync.isSystemDegraded as any).mockResolvedValueOnce(true);
      mockSocket.emit.mockClear();

      await socketEventHandlers.command({
        roomId: "degraded-room",
        ...(nonce === undefined ? {} : { nonce }),
        clientSequence: 1,
        command: { type: "pause", payload: { position: 10 } },
      });

      expect(mockSocket.emit).toHaveBeenCalledWith(
        "command_ack",
        expect.objectContaining({ nonce: "invalid", status: "rejected" }),
      );
    },
  );

  it("rejects non-leader fast playback commands in the websocket Redis fallback", async () => {
    const roomId = "test-room-leader-fast-fallback";
    const leaderId = "leader-123";
    const viewerId = "viewer-123";

    let storedRoom = createEmptyRoom(roomId, "Leader Room");
    storedRoom.participants[leaderId] = {
      id: leaderId,
      nickname: "Leader",
      role: "viewer",
      joinedAt: 0,
      lastSeen: Date.now(),
      connection: "connected",
      connectionIds: ["leader-socket"],
      playbackHealth: "idle",
      readyMediaId: null,
    };
    storedRoom.participants[viewerId] = {
      id: viewerId,
      nickname: "Viewer",
      role: "viewer",
      joinedAt: 0,
      lastSeen: Date.now(),
      connection: "connected",
      connectionIds: [mockSocket.id],
      playbackHealth: "idle",
      readyMediaId: null,
    };
    storedRoom.leaderId = leaderId;
    storedRoom.playback.status = "paused";
    storedRoom.playback.basePosition = 12;

    (redisActor.getRedisRoom as any).mockImplementation(async () =>
      JSON.parse(JSON.stringify(storedRoom)),
    );
    (redisActor.setRedisRoomCAS as any).mockImplementation(
      async (_roomId: string, nextRoom: any) => {
        storedRoom = JSON.parse(JSON.stringify(nextRoom));
        return true;
      },
    );
    (redisLua.executeFastMutation as any).mockResolvedValue({
      success: false,
      error: "REDIS_REQUIRED",
    });

    mockSocket.data.participantId = viewerId;
    await socketEventHandlers["join_room"]({ roomId, nickname: "Viewer" });
    expect(mockSocket.join).toHaveBeenCalledWith(roomId);
    mockSocket.emit.mockClear();

    await socketEventHandlers["command"]({
      roomId,
      type: "play",
      payload: { position: 44, forceSeek: true },
      sequence: 2,
    });

    expect(mockSocket.emit).toHaveBeenCalledWith("error", {
      message: "You do not have permission to perform this action.",
    });
    expect(storedRoom.playback.status).toBe("paused");
    expect(storedRoom.playback.basePosition).toBe(12);
  });
});

describe("room state normalization", () => {
  it("maps legacy buffering state and absent runtime fields to canonical defaults", () => {
    const room = normalizeRoomState({
      id: "legacy-room",
      name: "Legacy Room",
      settings: { autoplayNext: true, looping: false },
      participants: {
        viewer: {
          id: "viewer",
          nickname: "Viewer",
          role: "viewer",
          lastSeen: 10,
        },
      },
      playlist: [],
      currentMediaId: null,
      playback: {
        status: "buffering",
        basePosition: 5,
        baseTimestamp: 10,
        rate: 1,
        updatedBy: "viewer",
      },
      version: 1,
      sequence: 1,
      lastActivity: 10,
    });

    expect(room.playback.status).toBe("paused");
    expect(room.chat).toEqual([]);
    expect(room.leaderId).toBeNull();
    expect(room.flashbacks).toEqual({});
    expect(room.participants.viewer.connection).toBe("connected");
    expect(room.participants.viewer.playbackHealth).toBe("idle");
    expect(room.participants.viewer.readyMediaId).toBeNull();
  });

  it("normalizes legacy state before emitting a sanitized snapshot", () => {
    const room = sanitizeRoom({
      id: "legacy-snapshot",
      name: "Legacy Snapshot",
      settings: { autoplayNext: true, looping: false },
      participants: {},
      playlist: [],
      currentMediaId: null,
      playback: {
        status: "buffering",
        basePosition: 0,
        baseTimestamp: 1,
        rate: 1,
        updatedBy: "system",
      },
      version: 1,
      sequence: 1,
      lastActivity: 1,
    } as any);

    expect(room.playback.status).toBe("paused");
    expect(room.chat).toEqual([]);
    expect(room.leaderId).toBeNull();
    expect(room.flashbacks).toEqual({});
  });

  it("bounds server-only nonce and connection identity histories", () => {
    const room = normalizeRoomState({
      id: "bounded-runtime-state",
      participants: {
        viewer: {
          id: "viewer",
          connectionIds: [
            "",
            "x".repeat(129),
            ...Array.from({ length: 40 }, (_, index) => `socket-${index}`),
          ],
        },
      },
      processedCommandNonces: Array.from(
        { length: 300 },
        (_, index) => `nonce-${index}`,
      ),
    });

    expect(room.processedCommandNonces).toHaveLength(256);
    expect(room.processedCommandNonces?.[0]).toBe("nonce-44");
    expect(room.participants.viewer.connectionIds).toHaveLength(32);
    expect(room.participants.viewer.connectionIds?.[0]).toBe("socket-8");
    expect(
      room.participants.viewer.connectionIds?.every(
        (connectionId) => connectionId.length > 0 && connectionId.length <= 128,
      ),
    ).toBe(true);
  });

  it("keeps the newest occurrence when normalized server-only histories are deduplicated", () => {
    const repeatedConnectionId = "newest-active-socket";
    const repeatedNonce = "newest-command-nonce";
    const room = normalizeRoomState({
      id: "deduplicated-runtime-state",
      participants: {
        viewer: {
          id: "viewer",
          connectionIds: [
            repeatedConnectionId,
            ...Array.from({ length: 40 }, (_, index) => `socket-${index}`),
            repeatedConnectionId,
          ],
        },
      },
      processedCommandNonces: [
        repeatedNonce,
        ...Array.from({ length: 300 }, (_, index) => `nonce-${index}`),
        repeatedNonce,
      ],
    });

    expect(room.participants.viewer.connectionIds).toHaveLength(32);
    expect(room.participants.viewer.connectionIds?.at(-1)).toBe(
      repeatedConnectionId,
    );
    expect(room.participants.viewer.connectionIds?.[0]).toBe("socket-9");
    expect(room.processedCommandNonces).toHaveLength(256);
    expect(room.processedCommandNonces?.at(-1)).toBe(repeatedNonce);
    expect(room.processedCommandNonces?.[0]).toBe("nonce-45");
  });
});
