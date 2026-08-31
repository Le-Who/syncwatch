import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createEmptyRoom,
  normalizeRoomState,
  registerRoomHandlers,
} from "../lib/room-handler";
import * as redisRateLimit from "../lib/redis-rate-limit";
import * as redisActor from "../lib/redis-actor";
import * as redisLua from "../lib/redis-lua";
import { Server, Socket } from "socket.io";

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

  beforeEach(() => {
    vi.clearAllMocks();
    (redisRateLimit.checkRedisRateLimit as any).mockResolvedValue(true);

    socketEventHandlers = {};

    mockIo = {
      to: vi.fn().mockReturnValue({ emit: vi.fn() }),
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
    vi.restoreAllMocks();
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
      message: "Unauthorized operation.",
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
});
