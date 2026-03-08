import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock NEXT.js
vi.mock("next", () => {
  return {
    default: () => ({
      prepare: vi.fn().mockResolvedValue(true),
      getRequestHandler: vi.fn().mockReturnValue(vi.fn()),
    }),
  };
});

// Mock http
vi.mock("http", () => {
  return {
    default: {
      createServer: vi.fn().mockReturnValue({ listen: vi.fn() }),
      Server: class MockNetServer {},
    },
    createServer: vi.fn().mockReturnValue({ listen: vi.fn() }),
    Server: class MockNetServer {},
  };
});

// Mock Redis Rate Limit & Queue to prevent hitting Redis in unit tests
vi.mock("../lib/redis-rate-limit", () => {
  return {
    checkRedisRateLimit: vi.fn().mockResolvedValue(true),
    getRedisClient: vi.fn().mockReturnValue(null),
  };
});

// Mock Supabase
vi.mock("@supabase/supabase-js", () => {
  return {
    createClient: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnThis(),
      upsert: vi.fn().mockResolvedValue({}),
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null }),
      delete: vi.fn().mockReturnThis(),
      in: vi.fn().mockResolvedValue({}),
      order: vi.fn().mockReturnThis(),
    }),
  };
});

// Mock Redis Lua Fast Mutation
vi.mock("../lib/redis-lua", () => {
  return {
    executeFastMutation: vi.fn().mockResolvedValue({
      success: true,
      state: { id: "mock_room", participants: {} },
    }),
  };
});

// Capture Socket.io Server instance and its connection listener
const { connectionContext } = vi.hoisted(() => ({
  connectionContext: {
    listener: null as Function | null,
    middleware: null as Function | null,
  },
}));

vi.mock("socket.io", () => {
  return {
    Server: class MockServer {
      constructor() {}
      use(middleware: Function) {
        connectionContext.middleware = middleware;
      }
      on(event: string, callback: any) {
        if (event === "connection") {
          connectionContext.listener = callback;
        }
      }
      to() {
        return { emit: vi.fn() };
      }
      emit() {}
    },
  };
});

vi.mock("../lib/redis-queue", () => {
  return {
    pushSlowCommand: vi.fn().mockResolvedValue(true),
  };
});

import "../server"; // This executes the top-level code and registers the connection listener

describe("server.ts Socket Handlers", () => {
  let mockSocket: any;
  let socketListeners: Record<string, Function> = {};

  beforeEach(async () => {
    socketListeners = {};
    mockSocket = {
      id: "mock_socket_id",
      data: {}, // Initialize data property so tests can assign participantId without throwing a TypeError
      request: { headers: { cookie: "" } },
      handshake: {
        headers: { "x-forwarded-for": "127.0.0.1" },
        address: "127.0.0.1",
      },
      join: vi.fn(),
      emit: vi.fn(),
      to: vi.fn().mockReturnValue({ emit: vi.fn() }),
      on: (event: string, callback: Function) => {
        socketListeners[event] = callback;
      },
    };

    // Run custom auth logic middleware sequentially to prep the mock socket, then trigger connection
    if (connectionContext.middleware) {
      await new Promise<void>((resolve, reject) => {
        connectionContext.middleware!(mockSocket, (err?: Error) => {
          if (err) return reject(err);
          resolve();
        });
      });
    }

    // Trigger connection
    if (connectionContext.listener) {
      connectionContext.listener(mockSocket);
    }
  });

  it("should handle join_room and create a new room", async () => {
    expect(socketListeners["join_room"]).toBeDefined();

    mockSocket.data = { participantId: "user-1" };
    // Trigger join_room
    await socketListeners["join_room"]({
      roomId: "123e4567-e89b-12d3-a456-426614174000",
      nickname: "Test User",
      participantId: "user-1",
      sessionToken: "token-1",
    });

    expect(mockSocket.join).toHaveBeenCalledWith(
      "123e4567-e89b-12d3-a456-426614174000",
    );
    expect(mockSocket.emit).toHaveBeenCalledWith(
      "room_state",
      expect.any(Object),
    );

    // Check payload of emit
    const emitCall = mockSocket.emit.mock.calls.find(
      (call: any) => call[0] === "room_state",
    );
    expect(emitCall).toBeDefined();
    const payload = emitCall[1];
    expect(payload.room.id).toBe("123e4567-e89b-12d3-a456-426614174000");
    expect(payload.room.participants["user-1"].nickname).toBe("Test User");
    expect(payload.room.participants["user-1"].role).toBe("owner"); // First to join is owner
  });

  it("should handle command: play", async () => {
    mockSocket.data = { participantId: "user-1" };
    // Join room first
    await socketListeners["join_room"]({
      roomId: "test-room-2",
      nickname: "Test User",
      participantId: "user-1",
    });

    // Clear previous emits
    mockSocket.emit.mockClear();

    // Trigger command play
    await socketListeners["command"]({
      roomId: "test-room-2",
      type: "play",
      payload: { position: 10 },
      sequence: 1,
    });

    // Verify no error was emitted
    const errorCall = mockSocket.emit.mock.calls.find(
      (call: any) => call[0] === "error",
    );
    expect(errorCall).toBeUndefined();
  });

  it("should reject guest session commands", async () => {
    mockSocket.data = { participantId: "guest_socket_id" };
    await socketListeners["join_room"]({
      roomId: "test-room-3",
      nickname: "Guest User",
      participantId: "guest_socket_id",
    });

    mockSocket.emit.mockClear();

    // Send command with guest token
    await socketListeners["command"]({
      roomId: "test-room-3",
      type: "play",
      payload: { position: 10 },
      sequence: 1,
    });

    const errorCall = mockSocket.emit.mock.calls.find(
      (call: any) => call[0] === "error",
    );
    expect(errorCall).toBeDefined();
    expect(errorCall[1].message).toBe(
      "Unauthorized command. Guest accounts cannot send commands.",
    );
  });
});
