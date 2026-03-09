import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { registerRoomHandlers, createEmptyRoom } from "../lib/room-handler";
import * as redisRateLimit from "../lib/redis-rate-limit";
import * as redisActor from "../lib/redis-actor";
import { Server, Socket } from "socket.io";

vi.mock("../lib/redis-rate-limit", () => ({
  checkRedisRateLimit: vi.fn(),
  getRedisClient: vi.fn(),
}));

vi.mock("../lib/redis-actor", () => ({
  getRedisRoom: vi.fn(),
  setRedisRoomCAS: vi.fn(),
  publishRoomEvent: vi.fn(),
  pubClient: vi.fn().mockReturnValue(null),
}));

vi.mock("../lib/db-sync", () => ({
  persistRoomState: vi.fn(),
  loadRoomFromDB: vi.fn(),
  isSystemDegraded: vi.fn().mockResolvedValue(false),
}));

vi.mock("../lib/redis-lua", () => ({
  executeFastMutation: vi.fn(),
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
      data: { participantId: "guest_mock-socket-id" },
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

  it("TC-U02: Guest accounts rejected on slow path commands (Privilege Escalation Prevention)", async () => {
    // ==========================================
    // ARRANGE: Setup an established room and a Guest user
    // ==========================================
    const roomId = "test-room-auth";
    const guestId = "guest_123";

    const mockRoom = createEmptyRoom(roomId, "Auth Room");
    mockRoom.participants[guestId] = {
      id: guestId,
      nickname: "Guest123",
      role: "guest",
      lastSeen: Date.now(),
    };

    (redisActor.getRedisRoom as any).mockResolvedValue(mockRoom);
    (redisActor.setRedisRoomCAS as any).mockResolvedValue(true);

    // Simulate join_room to set current keys
    mockSocket.data.participantId = guestId;
    await socketEventHandlers["join_room"]({ roomId, nickname: "Guest123" });

    // Ensure mock room was fetched and the user successfully joined
    expect(mockSocket.join).toHaveBeenCalledWith(roomId);

    // ==========================================
    // ACT: Guest attempts an unauthorized slow-path mutation (e.g. skip track / add_item)
    // ==========================================
    const payload = {
      roomId,
      type: "add_item",
      payload: { url: "http://malicious.com" },
      sequence: 1,
    };

    // Clear emit logs to isolate command response
    mockSocket.emit.mockClear();

    await socketEventHandlers["command"](payload);

    // ==========================================
    // ASSERT: Payload must be rejected purely on role boundaries without reaching Redis queues
    // ==========================================
    expect(mockSocket.emit).toHaveBeenCalledWith("error", {
      message: "Unauthorized command. Guest accounts cannot send commands.",
    });
  });
});
