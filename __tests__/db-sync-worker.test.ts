/** @vitest-environment node */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Redis } from "ioredis";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { roomWithParticipants } from "./helpers/room-fixtures";

// Keep redis-actor's real cache/normalization. Only Redis and RPC transport are
// replaced, so queue membership and the persisted snapshots are observable.
class RedisTransport {
  pending = new Map<string, number>();
  rooms = new Map<string, string>();
  failedReads = new Set<string>();
  locks = new Set<string>();

  async zadd(_key: string, score: number, member: string) {
    this.pending.set(member, score);
    return 1;
  }
  async zrem(_key: string, member: string) {
    return Number(this.pending.delete(member));
  }
  // Model the transport contract for deterministic worker interleavings. The
  // companion real-Redis check validates the production Lua itself.
  async eval(
    script: string,
    keys: number,
    key: string,
    member: string,
    score: string | number,
    retry?: number | string,
  ) {
    if (keys !== 1 || key !== "pending_db_syncs")
      throw new Error("Unexpected Lua keys");
    if (script.includes("math.max")) {
      this.pending.set(
        member,
        Math.max(Number(score), (this.pending.get(member) ?? -Infinity) + 1),
      );
      return 1;
    }
    if (String(this.pending.get(member)) !== String(score)) return 0;
    if (retry === "") return Number(this.pending.delete(member));
    this.pending.set(member, Number(retry));
    return 1;
  }
  async zrangebyscore(
    _key: string,
    min: string,
    max: number | string,
    ...options: Array<string | number>
  ) {
    const limit = options.indexOf("LIMIT");
    const offset = limit === -1 ? 0 : Number(options[limit + 1]);
    const count = limit === -1 ? Infinity : Number(options[limit + 2]);
    return [...this.pending]
      .filter(
        ([, score]) =>
          score >= (min === "-inf" ? -Infinity : Number(min)) &&
          score <= (max === "+inf" ? Infinity : Number(max)),
      )
      .sort((a, b) => a[1] - b[1])
      .slice(offset, offset + count)
      .flatMap(([id, score]) =>
        options.includes("WITHSCORES") ? [id, String(score)] : [id],
      );
  }
  async get(key: string) {
    if (this.failedReads.has(key)) throw new Error("Redis read unavailable");
    return this.rooms.get(key) ?? null;
  }
  async set(
    key: string,
    value: string,
    _px?: string,
    _ttl?: number,
    nx?: string,
  ) {
    if (nx && this.locks.has(key)) return null;
    if (nx) this.locks.add(key);
    else this.rooms.set(key, value);
    return "OK";
  }
  async del(key: string) {
    return Number(this.locks.delete(key));
  }
  async expire() {
    return 1;
  }
}

const redisGlobal = globalThis as unknown as { redisClient: Redis | null };
let sync: typeof import("../lib/db-sync");
let actor: typeof import("../lib/redis-actor");
let redis: RedisTransport;
let snapshots: Array<{ name: string; version: number }>;
let failRpc: "returned" | "thrown" | null;
let rpcCode: string;
let client: SupabaseClient;

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  redis = new RedisTransport();
  redisGlobal.redisClient = redis as unknown as Redis;
  sync = await import("../lib/db-sync");
  actor = await import("../lib/redis-actor");
  snapshots = [];
  failRpc = null;
  rpcCode = "08006";
  client = {
    rpc: async (
      name: string,
      args: { p_state: { name: string; version: number } },
    ) => {
      if (name !== "sync_room_state") throw new Error("Unexpected RPC");
      if (failRpc === "thrown")
        throw { code: rpcCode, message: "RPC unavailable" };
      if (failRpc === "returned")
        return {
          data: null,
          error: { code: rpcCode, message: "RPC unavailable" },
        };
      snapshots.push(structuredClone(args.p_state));
      return { data: null, error: null };
    },
  } as unknown as SupabaseClient;
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  redisGlobal.redisClient = null;
});

async function enqueue(id = "room-one", name = "First snapshot") {
  const room = roomWithParticipants(1);
  room.id = id;
  room.name = name;
  await actor.setRedisRoom(id, room);
  sync.markRoomForSync(id);
  return room;
}

describe("database sync queue failure recovery", () => {
  it("retains a worker task after a failed room read and persists it after recovery", async () => {
    await enqueue();
    redis.failedReads.add("room_state:room-one");
    sync.startDbSyncWorker(client);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(redis.pending.has("room-one")).toBe(true);
    expect(snapshots).toEqual([]);

    redis.failedReads.clear();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(snapshots).toMatchObject([{ name: "First snapshot" }]);
    expect(redis.pending.size).toBe(0);
  });

  it.each(["returned", "thrown"] as const)(
    "keeps failed %s RPC flushes queued for a later successful flush",
    async (failure) => {
      await enqueue();
      failRpc = failure;
      await sync.flushDbSyncQueue(client);
      expect(redis.pending.has("room-one")).toBe(true);
      expect(snapshots).toEqual([]);

      failRpc = null;
      await sync.flushDbSyncQueue(client);
      expect(snapshots).toMatchObject([{ name: "First snapshot" }]);
      expect(redis.pending.size).toBe(0);
    },
  );

  it("continues flushing other rooms when one room read fails", async () => {
    await enqueue("unavailable");
    await enqueue("healthy", "Healthy snapshot");
    redis.failedReads.add("room_state:unavailable");
    await expect(sync.flushDbSyncQueue(client)).resolves.toBeUndefined();
    expect([...redis.pending.keys()]).toEqual(["unavailable"]);
    expect(snapshots).toMatchObject([{ name: "Healthy snapshot" }]);
  });

  it("acknowledges a confirmed missing room without preventing healthy rooms from syncing", async () => {
    sync.markRoomForSync("missing");
    await enqueue("healthy", "Healthy snapshot");
    await sync.flushDbSyncQueue(client);
    expect(redis.pending.size).toBe(0);
    expect(snapshots).toMatchObject([{ name: "Healthy snapshot" }]);
  });

  it("drops a confirmed missing worker room while persisting healthy rooms", async () => {
    sync.markRoomForSync("missing");
    await enqueue("healthy", "Healthy snapshot");
    sync.startDbSyncWorker(client);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(redis.pending.size).toBe(0);
    expect(snapshots).toMatchObject([{ name: "Healthy snapshot" }]);
  });

  it("retries pending work after Redis queue enumeration recovers", async () => {
    await enqueue();
    vi.spyOn(redis, "zrangebyscore").mockRejectedValueOnce(
      new Error("Redis unavailable"),
    );
    sync.startDbSyncWorker(client);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(redis.pending.has("room-one")).toBe(true);
    expect(snapshots).toEqual([]);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(redis.pending.size).toBe(0);
    expect(snapshots).toMatchObject([{ name: "First snapshot" }]);
  });

  it("leaves a persisted room retryable when Redis acknowledgement fails", async () => {
    await enqueue();
    vi.spyOn(redis, "eval").mockRejectedValueOnce(
      new Error("Redis unavailable"),
    );
    await sync.flushDbSyncQueue(client);
    expect(redis.pending.has("room-one")).toBe(true);
    expect(snapshots).toMatchObject([{ name: "First snapshot" }]);
    await sync.flushDbSyncQueue(client);
    expect(redis.pending.size).toBe(0);
    expect(snapshots).toHaveLength(2);
  });

  it("dequeues a successful local flush so repeated flushes do not duplicate RPC writes", async () => {
    redisGlobal.redisClient = null;
    await enqueue();
    await sync.flushDbSyncQueue(client);
    await sync.flushDbSyncQueue(client);
    sync.startDbSyncWorker(client);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(snapshots).toMatchObject([{ name: "First snapshot" }]);
  });

  it("backs off worker RPC failures and retries the latest room snapshot after recovery", async () => {
    const room = await enqueue();
    failRpc = "returned";
    sync.startDbSyncWorker(client);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(redis.pending.get(room.id)).toBe(1_070_000);
    expect(redis.locks.size).toBe(0);
    room.name = "Recovered snapshot";
    room.version += 1;
    await actor.setRedisRoom(room.id, room);
    failRpc = null;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(snapshots).toEqual([]);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(snapshots).toMatchObject([
      { name: "Recovered snapshot", version: 2 },
    ]);
    expect(redis.pending.size).toBe(0);
    expect(redis.locks.size).toBe(0);
  });

  it("retains locally queued state through worker RPC failure", async () => {
    redisGlobal.redisClient = null;
    await enqueue();
    failRpc = "thrown";
    sync.startDbSyncWorker(client);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(snapshots).toEqual([]);
    failRpc = null;
    await vi.advanceTimersByTimeAsync(20_000);
    expect(snapshots).toMatchObject([{ name: "First snapshot" }]);
  });

  it("retains a local dirty mark arriving while a flush persists an older snapshot", async () => {
    redisGlobal.redisClient = null;
    const room = await enqueue();
    const started = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const blockedClient = {
      rpc: async (name: string, args: unknown) => {
        started.resolve();
        await release.promise;
        return client.rpc(name, args as any);
      },
    } as unknown as SupabaseClient;
    const firstFlush = sync.flushDbSyncQueue(blockedClient);
    await started.promise;
    room.name = "Newer snapshot";
    room.version += 1;
    await actor.setRedisRoom(room.id, room);
    sync.markRoomForSync(room.id);
    release.resolve();
    await firstFlush;
    await sync.flushDbSyncQueue(client);
    await sync.flushDbSyncQueue(client);
    expect(snapshots).toMatchObject([
      { name: "First snapshot", version: 1 },
      { name: "Newer snapshot", version: 2 },
    ]);
  });

  it.each(["flush", "worker"] as const)(
    "preserves a Redis dirty mark arriving during an in-flight %s write",
    async (mode) => {
      const room = await enqueue();
      const started = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      const blockedClient = {
        rpc: async (name: string, args: unknown) => {
          started.resolve();
          await release.promise;
          return client.rpc(name, args as any);
        },
      } as unknown as SupabaseClient;
      let firstFlush: Promise<void> | undefined;
      if (mode === "worker") {
        sync.startDbSyncWorker(blockedClient);
        await vi.advanceTimersByTimeAsync(10_000);
      } else firstFlush = sync.flushDbSyncQueue(blockedClient);
      await started.promise;
      const oldScore = redis.pending.get(room.id)!;
      room.name = "Newer snapshot";
      room.version += 1;
      await actor.setRedisRoom(room.id, room);
      sync.markRoomForSync(room.id);
      expect(redis.pending.get(room.id)).toBeGreaterThan(oldScore);
      release.resolve();
      await firstFlush;
      await vi.advanceTimersByTimeAsync(0);
      expect(redis.pending.has(room.id)).toBe(true);
      await sync.flushDbSyncQueue(client);
      expect(snapshots).toMatchObject([
        { name: "First snapshot", version: 1 },
        { name: "Newer snapshot", version: 2 },
      ]);
      expect(redis.pending.size).toBe(0);
    },
  );

  it("does not overwrite a newer Redis dirty mark with an older worker write's backoff", async () => {
    const room = await enqueue();
    const started = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const blockedClient = {
      rpc: async () => {
        started.resolve();
        await release.promise;
        return {
          data: null,
          error: { code: "08006", message: "RPC unavailable" },
        };
      },
    } as unknown as SupabaseClient;
    sync.startDbSyncWorker(blockedClient);
    await vi.advanceTimersByTimeAsync(10_000);
    await started.promise;
    room.name = "Newer snapshot";
    await actor.setRedisRoom(room.id, room);
    sync.markRoomForSync(room.id);
    const newScore = redis.pending.get(room.id);
    release.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(redis.pending.get(room.id)).toBe(newScore);
    await sync.flushDbSyncQueue(client);
    expect(snapshots).toMatchObject([{ name: "Newer snapshot" }]);
  });

  it("keeps a task when another worker holds its lock and persists after release", async () => {
    await enqueue();
    redis.locks.add("db_sync_lock:room-one");
    sync.startDbSyncWorker(client);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(redis.pending.has("room-one")).toBe(true);
    expect(snapshots).toEqual([]);
    expect(redis.locks.has("db_sync_lock:room-one")).toBe(true);
    redis.locks.clear();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(snapshots).toMatchObject([{ name: "First snapshot" }]);
    expect(redis.pending.size).toBe(0);
  });

  it.each(["returned", "thrown"] as const)(
    "drops a nonretryable invalid-UUID %s RPC task and releases its lock",
    async (failure) => {
      await enqueue();
      failRpc = failure;
      rpcCode = "22P02";
      sync.startDbSyncWorker(client);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(redis.pending.size).toBe(0);
      expect(redis.locks.size).toBe(0);
      failRpc = null;
      await vi.advanceTimersByTimeAsync(80_000);
      expect(snapshots).toEqual([]);
    },
  );

  it("limits a worker tick to fifty rooms and drains the remaining room next tick", async () => {
    for (let i = 0; i < 51; i++) await enqueue(`room-${i}`, `Room ${i}`);
    sync.startDbSyncWorker(client);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(snapshots).toHaveLength(50);
    expect([...redis.pending.keys()]).toEqual(["room-50"]);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(snapshots).toHaveLength(51);
    expect(snapshots[50]).toMatchObject({ name: "Room 50" });
    expect(redis.pending.size).toBe(0);
  });
});
