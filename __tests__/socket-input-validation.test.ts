/** @vitest-environment node */
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Server, Socket } from "socket.io";
import type { SupabaseClient } from "@supabase/supabase-js";
import { handleConnectionEvents } from "../lib/socket/connection";
import { InMemoryRoomRepository } from "../lib/room-repository";
import { RoomEventBus } from "../lib/room-event-bus";
import { getRedisRoom, setRedisRoomCAS } from "../lib/redis-actor";
import { persistRoomState } from "../lib/db-sync";
import { PARTICIPANT_GRACE_MS } from "../lib/participant-lifecycle";
import type { RoomState } from "../lib/types";
import type { SocketContext } from "../lib/socket/context";

vi.mock("../lib/redis-rate-limit", () => ({
  checkRedisRateLimit: async () => true,
  getRedisClient: () => null,
}));
vi.mock("../lib/redis-actor", () => ({
  getRedisRoom: vi.fn((id: string) => repository.get(id)),
  setRedisRoomCAS: vi.fn((id: string, room: RoomState, version: number) =>
    repository.compareAndSet(id, version, room),
  ),
  pubClient: () => null,
}));
vi.mock("../lib/db-sync", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/db-sync")>()),
  isSystemDegraded: async () => false,
  persistRoomState: vi.fn(),
}));

let repository: InMemoryRoomRepository;

function connect(database: unknown = null, participantId = "participant") {
  const handlers = new Map<string, (...args: any[]) => any>();
  const messages: Array<{ event: string; payload: any }> = [];
  const rooms = new Set<string>();
  const forward = vi.fn();
  const context: SocketContext = {
    currentRoomId: null,
    currentParticipantId: null,
  };
  const socket = {
    id: randomUUID(),
    data: { participantId },
    handshake: { headers: {}, address: "test-client" },
    on: (event: string, callback: (...args: any[]) => any) =>
      handlers.set(event, callback),
    emit: (event: string, payload: any) => messages.push({ event, payload }),
    join: (roomId: string) => rooms.add(roomId),
    to: () => ({ emit: forward }),
  };
  handleConnectionEvents(
    {} as Server,
    socket as unknown as Socket,
    database as SupabaseClient | null,
    context,
    new RoomEventBus(() => {}),
  );
  return {
    context,
    messages,
    rooms,
    forward,
    socketId: socket.id,
    receive: (event: string, ...args: unknown[]) =>
      Promise.resolve().then(() => handlers.get(event)!(...args)),
  };
}

function databaseResult(result: unknown | (() => Promise<unknown>)) {
  const read = typeof result === "function" ? result : async () => result;
  return {
    from: () => ({
      select: () => ({ eq: () => ({ single: read, maybeSingle: read }) }),
    }),
  };
}

beforeEach(() => {
  repository = new InMemoryRoomRepository();
  vi.clearAllMocks();
  vi.mocked(getRedisRoom)
    .mockReset()
    .mockImplementation((id) => repository.get(id));
  vi.mocked(setRedisRoomCAS)
    .mockReset()
    .mockImplementation((id, room, version) =>
      repository.compareAndSet(id, version, room),
    );
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("socket input boundaries", () => {
  it.each(
    [
      null,
      undefined,
      {},
      { emoji: null },
      { emoji: { invalid: true } },
      { emoji: ["🔥"] },
      { emoji: "x".repeat(50_001) },
      { emoji: "" },
    ].map((payload) => ({ payload })),
  )(
    "ignores malformed reaction $payload instead of relaying it",
    async ({ payload }) => {
      const client = connect();
      await client.receive("join_room", { roomId: "room" });
      await expect(
        client.receive("reaction", payload),
      ).resolves.toBeUndefined();
      expect(client.forward).not.toHaveBeenCalled();
    },
  );

  it.each(["🔥", "😂", "💖", "👀", "🤯", "💯"])(
    "relays the supported reaction %s",
    async (emoji) => {
      const client = connect();
      await client.receive("join_room", { roomId: "room" });
      await client.receive("reaction", { emoji });
      expect(client.forward).toHaveBeenCalledExactlyOnceWith("reaction", {
        emoji,
      });
    },
  );

  it.each(
    [
      null,
      undefined,
      [],
      "room",
      {},
      { roomId: null },
      { roomId: "" },
      { roomId: "x".repeat(129) },
      { roomId: "room", nickname: { name: "bad" } },
      { roomId: "room", nickname: "x".repeat(51) },
    ].map((payload) => ({ payload })),
  )(
    "rejects invalid join input $payload before creating room state",
    async ({ payload }) => {
      const client = connect();
      await expect(
        client.receive("join_room", payload),
      ).resolves.toBeUndefined();
      expect(client.messages.some(({ event }) => event === "error")).toBe(true);
      expect(client.rooms.size).toBe(0);
      expect(setRedisRoomCAS).not.toHaveBeenCalled();
      expect(persistRoomState).not.toHaveBeenCalled();
    },
  );

  it.each(
    [null, undefined, [], {}, { roomId: 12 }].map((payload) => ({ payload })),
  )(
    "ignores malformed snapshot request $payload without throwing",
    async ({ payload }) => {
      const client = connect();
      await client.receive("join_room", { roomId: "room" });
      client.messages.length = 0;
      await expect(
        client.receive("request_room_state", payload),
      ).resolves.toBeUndefined();
      expect(client.messages).toEqual([]);
    },
  );

  it.each([{}, "x".repeat(65)])(
    "keeps optional snapshot correlation bounded for joins and refreshes",
    async (snapshotRequestId) => {
      const client = connect();
      await client.receive("join_room", { roomId: "room", snapshotRequestId });
      await client.receive("request_room_state", {
        roomId: "room",
        snapshotRequestId,
      });
      const snapshots = client.messages.filter(
        ({ event }) => event === "room_state",
      );
      expect(snapshots).toHaveLength(2);
      expect(
        snapshots.every(
          ({ payload }) => payload.snapshotRequestId === undefined,
        ),
      ).toBe(true);
    },
  );

  it("echoes valid snapshot correlation and permits same-room repeat joins", async () => {
    const client = connect();
    await client.receive("join_room", { roomId: "room", nickname: "Friend" });
    await client.receive("join_room", {
      roomId: "room",
      nickname: "Friend",
      snapshotRequestId: "request-2",
    });
    expect(client.messages.at(-1)).toMatchObject({
      event: "room_state",
      payload: { snapshotRequestId: "request-2" },
    });
    const room = (await repository.get("room"))!;
    expect(room.participants.participant.connectionIds).toHaveLength(1);
    expect(client.rooms).toEqual(new Set(["room"]));
  });

  it.each([
    [123],
    [123, "invalid"],
    [NaN, vi.fn()],
    [Infinity, vi.fn()],
    ["123", vi.fn()],
  ])(
    "ignores malformed ping arguments %j without throwing",
    async (...args) => {
      const client = connect();
      await expect(
        client.receive("ping_time", ...args),
      ).resolves.toBeUndefined();
      if (typeof args[1] === "function") expect(args[1]).not.toHaveBeenCalled();
    },
  );

  it("returns server time and the original finite client time to a valid ping", async () => {
    const client = connect();
    const callback = vi.fn();
    await client.receive("ping_time", 123, callback);
    expect(callback).toHaveBeenCalledWith(expect.any(Number), 123);
  });
});

describe("single room per connection", () => {
  it("rejects a second room and disconnects the original participant", async () => {
    vi.useFakeTimers();
    const client = connect();
    await client.receive("join_room", { roomId: "first" });
    await client.receive("join_room", { roomId: "second" });
    expect(client.context.currentRoomId).toBe("first");
    expect(client.rooms).toEqual(new Set(["first"]));
    expect(await repository.get("second")).toBeNull();
    expect(client.messages.at(-1)?.event).toBe("error");
    await client.receive("disconnect");
    await vi.advanceTimersByTimeAsync(PARTICIPANT_GRACE_MS + 1);
    expect((await repository.get("first"))!.participants).toEqual({});
  });

  it("reserves the first room while database hydration is pending", async () => {
    let resume!: (result: unknown) => void;
    const read = new Promise((resolve) => (resume = resolve));
    const client = connect(databaseResult(() => read));
    const first = client.receive("join_room", { roomId: "first" });
    await vi.waitFor(() => expect(getRedisRoom).toHaveBeenCalledWith("first"));
    const second = client.receive("join_room", { roomId: "second" });
    resume({ data: null, error: null });
    await Promise.all([first, second]);
    expect(client.context.currentRoomId).toBe("first");
    expect(client.rooms).toEqual(new Set(["first"]));
    expect(await repository.get("second")).toBeNull();
  });
});

describe("connection storage failures", () => {
  it("ignores health reads that finish after disconnect so grace still expires", async () => {
    vi.useFakeTimers();
    const client = connect();
    await client.receive("join_room", { roomId: "room" });
    let resume!: () => void;
    const pendingRead = new Promise<void>((resolve) => (resume = resolve));
    vi.mocked(getRedisRoom).mockImplementationOnce(async (roomId) => {
      await pendingRead;
      return repository.get(roomId);
    });
    const health = client.receive("participant_health", { health: "ready" });
    await vi.advanceTimersByTimeAsync(0);
    await client.receive("disconnect");
    await vi.advanceTimersByTimeAsync(5000);
    resume();
    await health;
    await vi.advanceTimersByTimeAsync(PARTICIPANT_GRACE_MS - 5000 + 1);
    expect((await repository.get("room"))!.participants).toEqual({});
  });

  it.each([
    { data: null, error: { code: "503", message: "database unavailable" } },
    { data: { state: null }, error: null },
    { data: { state: [] }, error: null },
  ])(
    "does not replace a failed durable read with an empty room: %j",
    async (result) => {
      const client = connect(databaseResult(result));
      await expect(
        client.receive("join_room", { roomId: "saved" }),
      ).resolves.toBeUndefined();
      expect(await repository.get("saved")).toBeNull();
      expect(client.context.currentRoomId).toBeNull();
      expect(client.messages.map(({ event }) => event)).toEqual(["error"]);
      expect(setRedisRoomCAS).not.toHaveBeenCalled();
      expect(persistRoomState).not.toHaveBeenCalled();
    },
  );

  it("creates a new room only after an absent database row is confirmed", async () => {
    const client = connect(databaseResult({ data: null, error: null }));
    await client.receive("join_room", { roomId: "new-room" });
    expect(client.context.currentRoomId).toBe("new-room");
    expect(
      (await repository.get("new-room"))!.participants.participant.role,
    ).toBe("owner");
    expect(client.messages.map(({ event }) => event)).toEqual(["room_state"]);
  });

  it("contains thrown database transport failures and allows a later join", async () => {
    const read = vi
      .fn()
      .mockRejectedValueOnce(new Error("transport failed"))
      .mockResolvedValue({ data: null, error: null });
    const client = connect(databaseResult(read));
    await expect(
      client.receive("join_room", { roomId: "saved" }),
    ).resolves.toBeUndefined();
    expect(await repository.get("saved")).toBeNull();
    await client.receive("join_room", { roomId: "retry" });
    expect(client.context.currentRoomId).toBe("retry");
  });

  it.each(["participant_health", "request_room_state"])(
    "contains cache read failures during %s",
    async (event) => {
      const client = connect();
      await client.receive("join_room", { roomId: "room" });
      vi.mocked(getRedisRoom).mockRejectedValueOnce(new Error("cache offline"));
      await expect(
        client.receive(
          event,
          event === "participant_health"
            ? { health: "ready" }
            : { roomId: "room" },
        ),
      ).resolves.toBeUndefined();
      expect(console.error).toHaveBeenCalled();
    },
  );

  it("contains asynchronous disconnect cache failures", async () => {
    const client = connect();
    await client.receive("join_room", { roomId: "room" });
    vi.mocked(getRedisRoom).mockRejectedValueOnce(new Error("cache offline"));
    await client.receive("disconnect");
    await vi.waitFor(() => expect(console.error).toHaveBeenCalled());
  });

  it("contains asynchronous grace-cleanup cache failures", async () => {
    vi.useFakeTimers();
    const client = connect();
    await client.receive("join_room", { roomId: "room" });
    await client.receive("disconnect");
    await vi.advanceTimersByTimeAsync(0);
    vi.mocked(getRedisRoom).mockRejectedValueOnce(new Error("cache offline"));
    await vi.advanceTimersByTimeAsync(PARTICIPANT_GRACE_MS + 1);
    expect(console.error).toHaveBeenCalled();
  });
});

describe("retained disconnect cleanup", () => {
  beforeEach(() => vi.useFakeTimers());

  async function roomWithViewer() {
    const owner = connect(null, "owner");
    const viewer = connect(null, "viewer");
    await owner.receive("join_room", { roomId: "room" });
    await viewer.receive("join_room", { roomId: "room" });
    return { owner, viewer };
  }

  async function expectOwnerHandoff() {
    const room = (await repository.get("room"))!;
    expect(room.participants.owner).toBeUndefined();
    expect(room.participants.viewer.role).toBe("owner");
    expect(vi.getTimerCount()).toBe(0);
  }

  it("retries a failed disconnect read and eventually hands off ownership", async () => {
    const { owner } = await roomWithViewer();
    vi.mocked(getRedisRoom).mockRejectedValueOnce(new Error("cache offline"));
    await owner.receive("disconnect");
    await vi.advanceTimersByTimeAsync(10_000);
    expect((await repository.get("room"))!.participants.owner.connection).toBe(
      "reconnecting",
    );
    await vi.advanceTimersByTimeAsync(PARTICIPANT_GRACE_MS + 1);
    await expectOwnerHandoff();
  });

  it("retries a failed grace read and eventually hands off ownership", async () => {
    const { owner } = await roomWithViewer();
    await owner.receive("disconnect");
    await vi.advanceTimersByTimeAsync(0);
    vi.mocked(getRedisRoom).mockRejectedValueOnce(new Error("cache offline"));
    await vi.advanceTimersByTimeAsync(PARTICIPANT_GRACE_MS + 10_000);
    await expectOwnerHandoff();
  });

  it("retains grace when the disconnect CAS commits but its response fails", async () => {
    const { owner } = await roomWithViewer();
    vi.mocked(setRedisRoomCAS).mockImplementationOnce(
      async (id, room, version) => {
        await repository.compareAndSet(id, version, room);
        throw new Error("lost CAS reply");
      },
    );
    await owner.receive("disconnect");
    await vi.advanceTimersByTimeAsync(PARTICIPANT_GRACE_MS + 10_000);
    await expectOwnerHandoff();
  });

  it.each(["disconnect", "grace"])(
    "retains %s cleanup after more than one CAS round conflicts",
    async (phase) => {
      const { owner } = await roomWithViewer();
      if (phase === "grace") {
        await owner.receive("disconnect");
        await vi.advanceTimersByTimeAsync(0);
      }
      for (let index = 0; index < 6; index++)
        vi.mocked(setRedisRoomCAS).mockResolvedValueOnce(false);
      if (phase === "disconnect") await owner.receive("disconnect");
      await vi.advanceTimersByTimeAsync(PARTICIPANT_GRACE_MS + 20_000);
      await expectOwnerHandoff();
    },
  );

  it("removes only the dead socket after a failed read and permits a sibling's later departure", async () => {
    const owner = connect(null, "owner");
    const sibling = connect(null, "owner");
    const viewer = connect(null, "viewer");
    await owner.receive("join_room", { roomId: "room" });
    await sibling.receive("join_room", { roomId: "room" });
    await viewer.receive("join_room", { roomId: "room" });
    vi.mocked(getRedisRoom).mockRejectedValueOnce(new Error("cache offline"));
    await owner.receive("disconnect");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(
      (await repository.get("room"))!.participants.owner.connectionIds,
    ).toEqual([sibling.socketId]);
    expect((await repository.get("room"))!.participants.owner.connection).toBe(
      "connected",
    );
    await sibling.receive("disconnect");
    await vi.advanceTimersByTimeAsync(PARTICIPANT_GRACE_MS + 1);
    await expectOwnerHandoff();
  });

  it("preserves a newer reconnect when the original disconnect read recovers", async () => {
    const { owner } = await roomWithViewer();
    vi.mocked(getRedisRoom).mockRejectedValueOnce(new Error("cache offline"));
    await owner.receive("disconnect");
    await vi.advanceTimersByTimeAsync(0);
    const replacement = connect(null, "owner");
    await replacement.receive("join_room", { roomId: "room" });
    await vi.advanceTimersByTimeAsync(PARTICIPANT_GRACE_MS + 10_000);
    expect((await repository.get("room"))!.participants.owner).toMatchObject({
      role: "owner",
      connection: "connected",
      connectionIds: [replacement.socketId],
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("reschedules grace when a newer departure moved its deadline", async () => {
    const { owner } = await roomWithViewer();
    await owner.receive("disconnect");
    await vi.advanceTimersByTimeAsync(5000);
    const room = (await repository.get("room"))!;
    const next = structuredClone(room);
    next.participants.owner.lastSeen = Date.now();
    next.version++;
    await repository.compareAndSet(room.id, room.version, next);
    await vi.advanceTimersByTimeAsync(PARTICIPANT_GRACE_MS - 5000 + 1);
    expect((await repository.get("room"))!.participants.owner).toBeDefined();
    await vi.advanceTimersByTimeAsync(5000);
    await expectOwnerHandoff();
  });

  it("keeps one unreferenced retry timer for duplicate disconnect work", async () => {
    const { owner } = await roomWithViewer();
    const timers = vi.spyOn(globalThis, "setTimeout");
    vi.mocked(getRedisRoom).mockRejectedValue(new Error("cache offline"));
    await owner.receive("disconnect");
    await vi.advanceTimersByTimeAsync(0);
    for (let index = 0; index < 5; index++) await owner.receive("disconnect");
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(1);
    const scheduled = timers.mock.results.filter(
      (entry) => entry.type === "return",
    );
    expect(scheduled.length).toBeGreaterThan(0);
    expect(
      scheduled.every((entry) => !(entry.value as NodeJS.Timeout).hasRef()),
    ).toBe(true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(vi.getTimerCount()).toBe(1);
    expect(vi.mocked(getRedisRoom).mock.calls.length).toBeLessThan(30);
  });
});
