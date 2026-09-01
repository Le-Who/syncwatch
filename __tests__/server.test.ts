/**
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { Server as NetServer } from "http";
import Client, { Socket as ClientSocket } from "socket.io-client";
import { AddressInfo } from "net";
import { SignJWT } from "jose";
import { PARTICIPANT_GRACE_MS } from "../lib/participant-lifecycle";
import { getRedisRoom } from "../lib/redis-actor";

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
vi.mock("../lib/room-logic", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/room-logic")>();
  return {
    ...actual,
    applySlowCommand: vi.fn().mockReturnValue(true),
  };
});

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

const waitForCondition = async (
  condition: () => boolean,
  timeoutMs: number = 2000,
) => {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() >= deadline) {
      throw new Error("Timeout waiting for socket state convergence");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

const delay = (durationMs: number) =>
  new Promise((resolve) => setTimeout(resolve, durationMs));

describe("server.ts Real Socket.IO Integration", () => {
  let clientSocket: ClientSocket;
  let viewerSocket: ClientSocket;
  let hostileSocket: ClientSocket;
  let recoverySocket: ClientSocket;
  const presenceSockets: ClientSocket[] = [];

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
    if (viewerSocket) viewerSocket.close();
    if (hostileSocket) hostileSocket.close();
    if (recoverySocket) recoverySocket.close();
    presenceSockets.forEach((socket) => socket.close());
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

  it("TC-02: Fallback UUID users can mutate state (Guest concept removed)", async () => {
    // Arrange: Create Socket connection without a token
    viewerSocket = Client(ioServerPath, {
      path: "/socket.io",
      transports: ["websocket"],
      forceNew: true,
      auth: { participantId: "fallback_123" },
    });

    await waitForSocketEvent(viewerSocket, "connect");

    // Arrange: Join the room (Precondition)
    const roomStatePromise = waitForSocketEvent(viewerSocket, "room_state");
    viewerSocket.emit("join_room", {
      roomId: "test-room-2",
      nickname: "FallbackUser",
      participantId: "fallback_123",
    });
    await roomStatePromise;

    // Act: Attempt to mutate state via command
    // We shouldn't get an error, but instead a room_state or state update via redis.
    // For this test, just ensuring the command doesn't emit an error is enough to prove the firewall is gone.
    const errorPromise = waitForSocketEvent(viewerSocket, "error", 500).catch(
      () => "NO_ERROR_THROWN",
    );

    viewerSocket.emit("command", {
      roomId: "test-room-2",
      type: "play",
      payload: { position: 10 },
      sequence: 1,
    });

    const errResult = await errorPromise;

    // Assert: We expect NO_ERROR_THROWN, meaning the command was accepted and processed or queued.
    expect(errResult).toBe("NO_ERROR_THROWN");
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

  it("publishes participant-local health without changing room playback", async () => {
    const sender = Client(ioServerPath, {
      path: "/socket.io",
      transports: ["websocket"],
      forceNew: true,
      auth: { participantId: "health-sender" },
    });
    const observer = Client(ioServerPath, {
      path: "/socket.io",
      transports: ["websocket"],
      forceNew: true,
      auth: { participantId: "health-observer" },
    });
    presenceSockets.push(sender, observer);
    await Promise.all([
      waitForSocketEvent(sender, "connect"),
      waitForSocketEvent(observer, "connect"),
    ]);
    const senderRoom = waitForSocketEvent(sender, "room_state");
    sender.emit("join_room", {
      roomId: "participant-health-room",
      nickname: "Sender",
    });
    await senderRoom;
    const observerRoom = waitForSocketEvent(observer, "room_state");
    observer.emit("join_room", {
      roomId: "participant-health-room",
      nickname: "Observer",
    });
    await observerRoom;

    const observed = waitForSocketEvent(observer, "participant_health");
    sender.emit("participant_health", { health: "buffering" });

    await expect(observed).resolves.toEqual({
      participantId: "health-sender",
      health: "buffering",
    });
    await expect(
      getRedisRoom("participant-health-room"),
    ).resolves.toMatchObject({
      sequence: 1,
      playback: { status: "paused", basePosition: 0 },
      participants: {
        "health-sender": { playbackHealth: "buffering" },
      },
    });
  });

  it("TC-05: Five clients observe every later join and converge without Redis", async () => {
    const participantSets = Array.from({ length: 5 }, () => new Set<string>());
    const joinedEventCounts = Array.from({ length: 5 }, () => 0);
    const roomId = "test-room-five-participants";

    for (let index = 0; index < 5; index++) {
      const socket = Client(ioServerPath, {
        path: "/socket.io",
        transports: ["websocket"],
        forceNew: true,
        auth: { participantId: `friend-${index}` },
      });
      presenceSockets.push(socket);
      socket.on("room_state", ({ room }) => {
        participantSets[index] = new Set(Object.keys(room.participants));
      });
      socket.on("participant_joined", (participant) => {
        participantSets[index].add(participant.id);
        joinedEventCounts[index]++;
      });

      await waitForSocketEvent(socket, "connect");
      const roomState = waitForSocketEvent(socket, "room_state");
      socket.emit("join_room", {
        roomId,
        nickname: `Friend ${index}`,
        participantId: `friend-${index}`,
      });
      await roomState;
    }

    await waitForCondition(() =>
      participantSets.every((set) => set.size === 5),
    );

    expect(participantSets.map((set) => [...set].sort())).toEqual(
      Array.from({ length: 5 }, () => [
        "friend-0",
        "friend-1",
        "friend-2",
        "friend-3",
        "friend-4",
      ]),
    );
    expect(joinedEventCounts).toEqual([5, 4, 3, 2, 1]);
  });

  it(
    "TC-06: Secondary disconnect preserves a shared identity until the final socket starts grace once",
    async () => {
      const roomId = "test-room-shared-participant-connections";
      const participantId = "shared-friend";
      const connectAndJoin = async (id: string, nickname: string) => {
        const socket = Client(ioServerPath, {
          path: "/socket.io",
          transports: ["websocket"],
          forceNew: true,
          auth: { participantId: id },
        });
        presenceSockets.push(socket);
        await waitForSocketEvent(socket, "connect");
        const roomState = waitForSocketEvent(socket, "room_state");
        socket.emit("join_room", { roomId, nickname, participantId: id });
        await roomState;
        return socket;
      };

      const primary = await connectAndJoin(participantId, "Shared Friend");
      const secondary = await connectAndJoin(participantId, "Shared Friend");
      const observer = await connectAndJoin("shared-observer", "Observer");
      let disconnectEvents = 0;
      let leaveEvents = 0;
      const lifecycleOrder: string[] = [];
      observer.on("participant_disconnected", ({ participantId: id }) => {
        if (id === participantId) {
          disconnectEvents++;
          lifecycleOrder.push("disconnected");
        }
      });
      observer.on("participant_left", ({ participantId: id }) => {
        if (id === participantId) {
          leaveEvents++;
          lifecycleOrder.push("left");
        }
      });
      observer.on("participant_joined", ({ id }) => {
        if (id === participantId) lifecycleOrder.push("joined");
      });

      secondary.close();
      await delay(100);

      expect(disconnectEvents).toBe(0);
      expect(leaveEvents).toBe(0);

      await delay(PARTICIPANT_GRACE_MS + 100);
      const snapshotPromise = waitForSocketEvent(observer, "room_state");
      observer.emit("join_room", {
        roomId,
        nickname: "Observer",
        participantId: "shared-observer",
      });
      const snapshot = await snapshotPromise;

      expect(snapshot.room.participants[participantId]).toMatchObject({
        connection: "connected",
      });
      expect(disconnectEvents).toBe(0);
      expect(leaveEvents).toBe(0);

      const finalDisconnect = waitForSocketEvent(
        observer,
        "participant_disconnected",
      );
      primary.close();
      await finalDisconnect;
      await delay(100);

      expect(disconnectEvents).toBe(1);
      expect(leaveEvents).toBe(0);

      await waitForCondition(
        () => leaveEvents === 1,
        PARTICIPANT_GRACE_MS + 2_000,
      );
      const removedSnapshotPromise = waitForSocketEvent(observer, "room_state");
      observer.emit("join_room", {
        roomId,
        nickname: "Observer",
        participantId: "shared-observer",
      });
      const removedSnapshot = await removedSnapshotPromise;

      expect(removedSnapshot.room.participants[participantId]).toBeUndefined();
      expect(leaveEvents).toBe(1);

      const freshJoinEvent = waitForSocketEvent(observer, "participant_joined");
      await connectAndJoin(participantId, "Shared Friend Returned");
      const freshParticipant = await freshJoinEvent;

      expect(freshParticipant).toMatchObject({
        id: participantId,
        role: "viewer",
        connection: "connected",
      });
      expect(lifecycleOrder).toEqual(["disconnected", "left", "joined"]);
      expect(leaveEvents).toBe(1);
    },
    PARTICIPANT_GRACE_MS * 2 + 10_000,
  );
});
