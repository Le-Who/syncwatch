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

describe("server.ts Real Socket.IO Integration", () => {
  let clientSocket: ClientSocket;

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
    if (clientSocket) {
      clientSocket.close();
    }
    if (httpServer) {
      httpServer.close();
    }
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

    await new Promise<void>((resolve) => clientSocket.on("connect", resolve));

    // Act & Assert
    return new Promise<void>((resolve) => {
      clientSocket.on("room_state", (payload: any) => {
        expect(payload.room.id).toBe("test-room-1");
        expect(Object.keys(payload.room.participants)).toHaveLength(1);
        const participantId = Object.keys(payload.room.participants)[0];
        expect(payload.room.participants[participantId].role).toBe("owner");
        expect(payload.room.participants[participantId].nickname).toBe(
          "OwnerUser",
        );
        clientSocket.close();
        resolve();
      });

      clientSocket.emit("join_room", {
        roomId: "test-room-1",
        nickname: "OwnerUser",
        participantId: "user-1",
      });
    });
  });

  it("TC-02: Guest users cannot mutate state", async () => {
    // Arrange
    const guestSocket = Client(ioServerPath, {
      path: "/socket.io",
      transports: ["websocket"],
      forceNew: true,
    });

    await new Promise<void>((resolve) => guestSocket.on("connect", resolve));

    await new Promise<void>((resolve) => {
      guestSocket.on("room_state", () => resolve());
      guestSocket.emit("join_room", {
        roomId: "test-room-2",
        nickname: "GuestUser",
        participantId: "guest_123",
      });
    });

    // Act
    guestSocket.emit("command", {
      roomId: "test-room-2",
      type: "play",
      payload: { position: 10 },
      sequence: 1,
    });

    // Assert
    return new Promise<void>((resolve) => {
      guestSocket.on("error", (err: any) => {
        expect(err.message).toContain("Guest accounts cannot send commands");
        guestSocket.close();
        resolve();
      });
    });
  });

  it("TC-03: Invalid Zod command payload types are rejected immediately", async () => {
    // Arrange
    const JWT_SECRET = new TextEncoder().encode(
      "default_local_secret_dont_use_in_prod",
    );
    const token = await new SignJWT({ participantId: "user-hacker" })
      .setProtectedHeader({ alg: "HS256" })
      .sign(JWT_SECRET);

    const hostileSocket = Client(ioServerPath, {
      path: "/socket.io",
      transports: ["websocket"],
      forceNew: true,
      extraHeaders: {
        cookie: `syncwatch_session=${token}`,
      },
    });

    await new Promise<void>((resolve) => hostileSocket.on("connect", resolve));

    await new Promise<void>((resolve) => {
      hostileSocket.on("room_state", () => resolve());
      hostileSocket.emit("join_room", {
        roomId: "test-room-3",
        nickname: "Hacker",
        participantId: "user-hacker",
      });
    });

    // Act
    hostileSocket.emit("command", {
      roomId: "test-room-3",
      type: "play",
      payload: { invalidArgument: "DROP TABLE" },
      sequence: 1,
    });

    // Assert
    return new Promise<void>((resolve) => {
      hostileSocket.on("error", (err: any) => {
        expect(err.message).toContain("Invalid command payload format");
        hostileSocket.close();
        resolve();
      });
    });
  });
});
