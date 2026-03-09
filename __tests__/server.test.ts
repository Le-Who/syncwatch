/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { Server as NetServer } from "http";
import Client, { Socket as ClientSocket } from "socket.io-client";
import { AddressInfo } from "net";
import { SignJWT } from "jose";

// 1. Mock Next.js to bypass heavy build compilation
vi.mock("next", () => {
  return {
    default: () => ({
      prepare: vi.fn().mockResolvedValue(true),
      getRequestHandler: vi.fn().mockReturnValue(vi.fn()),
    }),
  };
});

// 2. Mock external persistence and rate limiting
vi.mock("../lib/redis-rate-limit", () => ({
  checkRedisRateLimit: vi.fn().mockResolvedValue(true),
  getRedisClient: vi.fn().mockReturnValue(null),
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn().mockReturnValue({}),
}));
vi.mock("../lib/redis-queue", () => ({
  pushSlowCommand: vi.fn().mockResolvedValue(true),
}));

// We force Redis fallback to in-memory mode for these tests by mocking getRedisClient to null.

let ioServerPath = "";
let httpServer: NetServer;

// 3. Intercept HTTP server creation to force ephemeral port instead of :3000
vi.mock("http", async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    createServer: (handler: any) => {
      const server = actual.createServer(handler);
      httpServer = server;
      const originalListen = server.listen.bind(server);
      server.listen = (...args: any[]) => {
        // Force listen on ephemeral port 0
        return originalListen(0, args[1]);
      };
      return server;
    },
  };
});

// 4. Test Utility for AAA compliant assertions
const waitForSocketEvent = (
  socket: ClientSocket,
  event: string,
  timeoutMs: number = 2000,
): Promise<any> => {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout waiting for socket event: ${event}`));
    }, timeoutMs);

    socket.once(event, (data?: any) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
};

describe("server.ts Real Socket.IO Integration", () => {
  let clientSocket: ClientSocket;
  let guestSocket: ClientSocket;
  let hostileSocket: ClientSocket;
  let recoverySocket: ClientSocket;

  beforeAll(async () => {
    // Import server.ts to trigger app.prepare().then(...)
    await import("../server");

    // Wait for the server to actually start listening
    await new Promise<void>((resolve) => {
      if (httpServer && httpServer.listening) {
        resolve();
      } else if (httpServer) {
        httpServer.on("listening", resolve);
      } else {
        // Fallback polling if httpServer isn't captured immediately
        const interval = setInterval(() => {
          if (httpServer && httpServer.listening) {
            clearInterval(interval);
            resolve();
          }
        }, 50);
      }
    });

    const port = (httpServer.address() as AddressInfo).port;
    ioServerPath = `http://localhost:${port}`;
  });

  afterAll(() => {
    if (clientSocket) clientSocket.close();
    if (guestSocket) guestSocket.close();
    if (hostileSocket) hostileSocket.close();
    if (recoverySocket) recoverySocket.close();
    if (httpServer) httpServer.close();
  });

  it("TC-01: Connects and joins a room, establishing owner role", async () => {
    // Arrange
    const JWT_SECRET = new TextEncoder().encode(
      "default_local_secret_dont_use_in_prod",
    );
    const token = await new SignJWT({ participantId: "user-1" })
      .setProtectedHeader({ alg: "HS256" })
      .sign(JWT_SECRET);

    clientSocket = Client(ioServerPath, {
      path: "/socket.io",
      transports: ["websocket"],
      forceNew: true,
      extraHeaders: {
        cookie: `syncwatch_session=${token}`,
      },
    });

    await waitForSocketEvent(clientSocket, "connect");

    // Arrange: Prepare to capture the async response
    const roomStatePromise = waitForSocketEvent(clientSocket, "room_state");

    // Act
    clientSocket.emit("join_room", {
      roomId: "test-room-1",
      nickname: "OwnerUser",
      participantId: "user-1",
    });

    const payload = await roomStatePromise;

    // Assert
    expect(payload.room.id).toBe("test-room-1");
    expect(Object.keys(payload.room.participants)).toHaveLength(1);

    const participantId = Object.keys(payload.room.participants)[0];
    const participant = payload.room.participants[participantId];

    expect(participantId).toBe("user-1");
    expect(participant.role).toBe("owner");
    expect(participant.nickname).toBe("OwnerUser");
  });

  it("TC-02: Guest users cannot mutate state", async () => {
    // Arrange: Create Socket connection
    guestSocket = Client(ioServerPath, {
      path: "/socket.io",
      transports: ["websocket"],
      forceNew: true,
    });

    await waitForSocketEvent(guestSocket, "connect");

    // Arrange: Join the room (Precondition)
    const roomStatePromise = waitForSocketEvent(guestSocket, "room_state");
    guestSocket.emit("join_room", {
      roomId: "test-room-2",
      nickname: "GuestUser",
      participantId: "guest_123",
    });
    await roomStatePromise;

    // Arrange: Prepare to capture the expected error event
    const errorPromise = waitForSocketEvent(guestSocket, "error");

    // Act: Attempt to mutate state via command
    guestSocket.emit("command", {
      roomId: "test-room-2",
      type: "play",
      payload: { position: 10 },
      sequence: 1,
    });

    const err = await errorPromise;

    // Assert: Check the error payload
    expect(err).toBeDefined();
    expect(err.message).toContain("Guest accounts cannot send commands");
  });

  it("TC-03: Invalid Zod command payload types are rejected immediately", async () => {
    // Arrange: Setup malicious authenticated client
    const JWT_SECRET = new TextEncoder().encode(
      "default_local_secret_dont_use_in_prod",
    );
    const token = await new SignJWT({ participantId: "user-hacker" })
      .setProtectedHeader({ alg: "HS256" })
      .sign(JWT_SECRET);

    hostileSocket = Client(ioServerPath, {
      path: "/socket.io",
      transports: ["websocket"],
      forceNew: true,
      extraHeaders: {
        cookie: `syncwatch_session=${token}`,
      },
    });

    await waitForSocketEvent(hostileSocket, "connect");

    // Arrange: Join room (Precondition)
    const roomStatePromise = waitForSocketEvent(hostileSocket, "room_state");
    hostileSocket.emit("join_room", {
      roomId: "test-room-3",
      nickname: "Hacker",
      participantId: "user-hacker",
    });
    await roomStatePromise;

    // Arrange: Capture the expected error event
    const errorPromise = waitForSocketEvent(hostileSocket, "error");

    // Act: Dispatch structurally malformed command
    hostileSocket.emit("command", {
      roomId: "test-room-3",
      type: "play",
      payload: { invalidArgument: "DROP TABLE" },
      sequence: 1,
    });

    const err = await errorPromise;

    // Assert: Ensure Zod parsing blocked the payload
    expect(err).toBeDefined();
    expect(err.message).toContain("Invalid command payload format");
  });

  it("TC-04: Existing session token recovers owner privileges upon reconnection", async () => {
    // Arrange: Setup recovered socket with earlier valid token
    const JWT_SECRET = new TextEncoder().encode(
      "default_local_secret_dont_use_in_prod",
    );
    // Use the same participantId to simulate recovery
    const token = await new SignJWT({ participantId: "user-1" })
      .setProtectedHeader({ alg: "HS256" })
      .sign(JWT_SECRET);

    recoverySocket = Client(ioServerPath, {
      path: "/socket.io",
      transports: ["websocket"],
      forceNew: true,
      extraHeaders: {
        cookie: `syncwatch_session=${token}`,
      },
    });

    await waitForSocketEvent(recoverySocket, "connect");

    // Arrange: Prepare to capture room state event
    const roomStatePromise = waitForSocketEvent(recoverySocket, "room_state");

    // Act: Rejoin the same room using the recovered socket
    recoverySocket.emit("join_room", {
      roomId: "test-room-1", // Re-joining the same room created in TC-01
      nickname: "OwnerUserRecovered",
      participantId: "user-1",
    });

    const payload = await roomStatePromise;

    // Assert: Verify server maintained state associations
    expect(payload.room.id).toBe("test-room-1");
    const participant = payload.room.participants["user-1"];
    expect(participant).toBeDefined();
    expect(participant.role).toBe("owner"); // Should remain owner
    expect(participant.nickname).toBe("OwnerUserRecovered"); // Should update nickname
  });
});
