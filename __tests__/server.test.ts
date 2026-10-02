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
      getRequestHandler: vi.fn().mockReturnValue(async (req: any, res: any) => {
        if (req.method === "POST" && req.url?.startsWith("/api/auth/session")) {
          const { POST } = await import("../app/api/auth/session/route");
          const request = new Request(`http://localhost${req.url}`, {
            method: req.method,
            headers: new Headers(req.headers as Record<string, string>),
            body: req,
            // Node request streams require this for a streamed body.
            duplex: "half",
          } as RequestInit);
          const response = await POST(request);
          res.statusCode = response.status;
          response.headers.forEach((value: string, name: string) =>
            res.setHeader(name, value),
          );
          res.end(await response.text());
          return;
        }
        res.statusCode = 404;
        res.end();
      }),
    }),
  };
});

// 2. Real bounded local admission, with no external Redis dependency.
vi.mock("../lib/redis-rate-limit", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../lib/redis-rate-limit")>();
  const limiter = actual.createRateLimiter({ redis: null });
  return {
    ...actual,
    checkRedisRateLimit: vi.fn(limiter.check),
    getRedisClient: vi.fn().mockReturnValue(null),
  };
});
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

const TEST_JWT_SECRET = new TextEncoder().encode(
  "default_local_secret_dont_use_in_prod",
);
const TEST_ORIGIN = "https://watch.test.example";
const tokenFor = (participantId: string) =>
  new SignJWT({ participantId })
    .setProtectedHeader({ alg: "HS256" })
    .sign(TEST_JWT_SECRET);

describe("server.ts Real Socket.IO Integration", () => {
  let clientSocket: ClientSocket;
  let viewerSocket: ClientSocket;
  let hostileSocket: ClientSocket;
  let recoverySocket: ClientSocket;
  const presenceSockets: ClientSocket[] = [];

  beforeAll(async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("JWT_SECRET", "default_local_secret_dont_use_in_prod");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", TEST_ORIGIN);
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
    vi.unstubAllEnvs();
  });

  it("normalizes the configured production origin and rejects other origins", async () => {
    const { normalizeAppOrigin, isSocketOriginAllowed } =
      await import("../lib/server-config");

    expect(normalizeAppOrigin("localhost:3000")).toBe("http://localhost:3000");
    expect(normalizeAppOrigin("https://watch.example.com/path")).toBe(
      "https://watch.example.com",
    );
    expect(
      isSocketOriginAllowed(
        "https://watch.example.com",
        "https://watch.example.com",
      ),
    ).toBe(true);
    expect(
      isSocketOriginAllowed(
        "https://evil.example.com",
        "https://watch.example.com",
      ),
    ).toBe(false);
  });

  it("admits 25 real same-NAT signed clients beyond 50 aggregate joins and isolates a noisy identity", async () => {
    const roomId = `real-nat-${crypto.randomUUID()}`;
    const friends: ClientSocket[] = [];
    try {
      for (let n = 0; n < 25; n++) {
        const response = await fetch(`${ioServerPath}/api/auth/session`, {
          method: "POST",
          headers: { origin: TEST_ORIGIN },
        });
        expect(response.status).toBe(200);
        const cookie = response.headers.get("set-cookie")!.split(";", 1)[0];
        const first = await response.json();
        const reuse = await fetch(`${ioServerPath}/api/auth/session`, {
          method: "POST",
          headers: { origin: TEST_ORIGIN, cookie },
        });
        expect(await reuse.json()).toEqual(first);
        const socket = Client(ioServerPath, {
          transports: ["websocket"],
          forceNew: true,
          extraHeaders: { cookie, origin: TEST_ORIGIN },
        });
        friends.push(socket);
        await waitForSocketEvent(socket, "connect");
      }
      const join = async (socket: ClientSocket) => {
        const snapshot = waitForSocketEvent(socket, "room_state");
        socket.emit("join_room", { roomId, nickname: "Friend" });
        return snapshot;
      };
      for (let round = 0; round < 4; round++)
        for (const socket of friends) await join(socket);
      expect(
        Object.keys((await getRedisRoom(roomId))!.participants),
      ).toHaveLength(25);
      for (let n = 4; n < 50; n++) await join(friends[0]);
      const denied = waitForSocketEvent(friends[0], "error");
      friends[0].emit("join_room", { roomId, nickname: "Noisy" });
      expect(await denied).toMatchObject({ message: "Too many join requests" });
      for (const socket of friends.slice(1))
        expect((await join(socket)).room.id).toBe(roomId);
    } finally {
      friends.forEach((socket) => socket.close());
    }
  }, 30000);

  it("issues an HTTP session through the production server, strips spoofed direct identity, and admits its cookie", async () => {
    const { checkRedisRateLimit } = await import("../lib/redis-rate-limit");
    vi.mocked(checkRedisRateLimit).mockClear();
    const response = await fetch(`${ioServerPath}/api/auth/session`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: TEST_ORIGIN,
        "x-syncwatch-client-ip": "203.0.113.77",
      },
      body: "{}",
    });
    const body = await response.json();
    const issuedCookie = response.headers.get("set-cookie")!.split(";", 1)[0];

    expect(response.status).toBe(200);
    expect(body.participantId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(checkRedisRateLimit).toHaveBeenCalledWith(
      expect.stringMatching(
        /^api:auth:(?!203\.0\.113\.77)(?:127\.0\.0\.1|::1)$/,
      ),
      1000,
      60_000,
    );

    const issuedSessionSocket = Client(ioServerPath, {
      path: "/socket.io",
      transports: ["websocket"],
      forceNew: true,
      extraHeaders: { cookie: issuedCookie, origin: TEST_ORIGIN },
    });
    presenceSockets.push(issuedSessionSocket);
    await waitForSocketEvent(issuedSessionSocket, "connect");
    expect(issuedSessionSocket.connected).toBe(true);
  });

  it("enforces production origin admission for polling and WebSocket handshakes", async () => {
    const validToken = await tokenFor("production-origin-client");
    const accepted = Client(ioServerPath, {
      path: "/socket.io",
      transports: ["polling"],
      forceNew: true,
      extraHeaders: {
        cookie: `syncwatch_session=${validToken}`,
        origin: TEST_ORIGIN,
      },
    });
    presenceSockets.push(accepted);
    await waitForSocketEvent(accepted, "connect");
    expect(accepted.connected).toBe(true);

    for (const [transport, origin] of [
      ["polling", undefined],
      ["websocket", undefined],
      ["polling", "https://evil.example"],
      ["websocket", "not an origin"],
    ] as const) {
      const rejected = Client(ioServerPath, {
        path: "/socket.io",
        transports: [transport],
        forceNew: true,
        extraHeaders: {
          cookie: `syncwatch_session=${validToken}`,
          ...(origin ? { origin } : {}),
        },
      });
      presenceSockets.push(rejected);
      await expect(
        waitForSocketEvent(rejected, "connect_error"),
      ).resolves.toBeDefined();
    }
  });

  it("admits 25 independently issued production sessions through the server path", async () => {
    vi.stubEnv("TRUST_PROXY", "true");
    const identities = new Set<string>();
    const sessions: ClientSocket[] = [];

    try {
      for (let index = 1; index <= 25; index++) {
        const response = await fetch(`${ioServerPath}/api/auth/session`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: TEST_ORIGIN,
            "x-forwarded-for": `198.51.100.${index}`,
          },
          body: "{}",
        });
        const body = await response.json();
        const cookie = response.headers.get("set-cookie")!.split(";", 1)[0];
        identities.add(body.participantId);

        const session = Client(ioServerPath, {
          path: "/socket.io",
          transports: ["websocket"],
          forceNew: true,
          extraHeaders: {
            cookie,
            origin: TEST_ORIGIN,
            "x-forwarded-for": `198.51.100.${index}`,
          },
        });
        sessions.push(session);
        await waitForSocketEvent(session, "connect");
        expect(session.connected).toBe(true);
      }
      expect(identities.size).toBe(25);
    } finally {
      sessions.forEach((session) => session.close());
      vi.stubEnv("TRUST_PROXY", "false");
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
        origin: TEST_ORIGIN,
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

  it("TC-02: Rejects a socket that has no server-issued session", async () => {
    viewerSocket = Client(ioServerPath, {
      path: "/socket.io",
      transports: ["websocket"],
      forceNew: true,
      extraHeaders: { origin: TEST_ORIGIN },
    });

    const error = await waitForSocketEvent(viewerSocket, "connect_error");

    expect(error.message).toMatch(/session|authentication/i);
  });

  it("rejects a malformed handshake without logging its auth payload", async () => {
    const loggedError = vi.spyOn(console, "error").mockImplementation(() => {});
    const rejectedToken = "malformed-handshake-token";
    const socket = Client(ioServerPath, {
      path: "/socket.io",
      transports: ["websocket"],
      forceNew: true,
      auth: {
        token: rejectedToken,
        participantId: "claimed-owner-id",
      },
      extraHeaders: { origin: TEST_ORIGIN },
    });
    presenceSockets.push(socket);

    const error = await waitForSocketEvent(socket, "connect_error");

    expect(error.message).toMatch(/session|authentication/i);
    const logged = JSON.stringify(loggedError.mock.calls);
    expect(logged).not.toContain(rejectedToken);
    expect(logged).not.toContain("claimed-owner-id");
    loggedError.mockRestore();
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
        origin: TEST_ORIGIN,
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
        origin: TEST_ORIGIN,
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
      auth: { token: await tokenFor("health-sender") },
      extraHeaders: { origin: TEST_ORIGIN },
    });
    const observer = Client(ioServerPath, {
      path: "/socket.io",
      transports: ["websocket"],
      forceNew: true,
      auth: { token: await tokenFor("health-observer") },
      extraHeaders: { origin: TEST_ORIGIN },
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
        auth: { token: await tokenFor(`friend-${index}`) },
        extraHeaders: { origin: TEST_ORIGIN },
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
          auth: { token: await tokenFor(id) },
          extraHeaders: { origin: TEST_ORIGIN },
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
