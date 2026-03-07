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

// Capture Socket.io Server instance and its connection listener
const { connectionContext } = vi.hoisted(() => ({
  connectionContext: { listener: null as Function | null },
}));

vi.mock("socket.io", () => {
  return {
    Server: class MockServer {
      constructor() {}
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

import "../server"; // This executes the top-level code and registers the connection listener

describe("server.ts Socket Handlers", () => {
  let mockSocket: any;
  let socketListeners: Record<string, Function> = {};

  beforeEach(() => {
    socketListeners = {};
    mockSocket = {
      id: "mock_socket_id",
      join: vi.fn(),
      emit: vi.fn(),
      to: vi.fn().mockReturnValue({ emit: vi.fn() }),
      on: (event: string, callback: Function) => {
        socketListeners[event] = callback;
      },
    };

    // Trigger connection
    if (connectionContext.listener) {
      connectionContext.listener(mockSocket);
    }
  });

  it("should handle join_room and create a new room", async () => {
    expect(socketListeners["join_room"]).toBeDefined();

    // Trigger join_room
    await socketListeners["join_room"]({
      roomId: "test-room",
      nickname: "Test User",
      participantId: "user-1",
      sessionToken: "token-1",
    });

    expect(mockSocket.join).toHaveBeenCalledWith("test-room");
    expect(mockSocket.emit).toHaveBeenCalledWith(
      "room_state",
      expect.any(Object),
    );
    expect(mockSocket.to).toHaveBeenCalledWith("test-room");

    // Check payload of emit
    const emitCall = mockSocket.emit.mock.calls.find(
      (call: any) => call[0] === "room_state",
    );
    expect(emitCall).toBeDefined();
    const payload = emitCall[1];
    expect(payload.room.id).toBe("test-room");
    expect(payload.room.participants["user-1"].nickname).toBe("Test User");
    expect(payload.room.participants["user-1"].role).toBe("owner"); // First to join is owner
  });

  it("should handle command: play", async () => {
    // Join room first
    await socketListeners["join_room"]({
      roomId: "test-room-2",
      nickname: "Test User",
      participantId: "user-1",
      sessionToken: "token-1",
    });

    // Clear previous emits
    mockSocket.emit.mockClear();

    // Trigger command play
    await socketListeners["command"]({
      roomId: "test-room-2",
      type: "play",
      payload: { position: 10 },
      sequence: 1,
      sessionToken: "token-1",
    });

    // We don't check broadcast here as it's not implemented directly in command without state change sync
    // Wait, the server.ts relies on the fact that participants can query state or it persists.
    // Let's verify no error was emitted
    const errorCall = mockSocket.emit.mock.calls.find(
      (call: any) => call[0] === "error",
    );
    expect(errorCall).toBeUndefined();
  });

  it("should reject invalid session tokens", async () => {
    await socketListeners["join_room"]({
      roomId: "test-room-3",
      nickname: "Test User",
      participantId: "user-1",
      sessionToken: "token-1",
    });

    mockSocket.emit.mockClear();

    // Send command with wrong token
    await socketListeners["command"]({
      roomId: "test-room-3",
      type: "play",
      payload: { position: 10 },
      sequence: 1,
      sessionToken: "INVALID",
    });

    const errorCall = mockSocket.emit.mock.calls.find(
      (call: any) => call[0] === "error",
    );
    expect(errorCall).toBeDefined();
    expect(errorCall[1].message).toBe("Unauthorized command. Invalid session.");
  });
});
