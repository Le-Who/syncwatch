/** @vitest-environment node */
import { randomUUID } from "node:crypto";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  flushDbSyncQueue,
  markRoomForSync,
  startDbSyncWorker,
} from "../../lib/db-sync";
import { setRedisRoom } from "../../lib/redis-actor";
import { getRedisClient } from "../../lib/redis-rate-limit";
import { roomWithParticipants } from "../helpers/room-fixtures";

// Worker/flush enumerate a global queue. Opt in only against a disposable Redis
// database; ordinary REDIS_URL integration runs must not acknowledge shared work.
const redis =
  process.env.SYNCWATCH_TEST_DB_SYNC_REDIS === "1" && process.env.REDIS_URL
    ? getRedisClient()
    : null;
const rooms: string[] = [];

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function database(
  write: (state: { name: string }) => Promise<{ error: unknown }>,
) {
  return {
    rpc: async (_name: string, args: { p_state: { name: string } }) =>
      write(args.p_state),
  } as unknown as SupabaseClient;
}

async function fixture(name = "Initial") {
  const room = roomWithParticipants(1);
  room.id = randomUUID();
  room.name = name;
  rooms.push(room.id);
  await setRedisRoom(room.id, room);
  markRoomForSync(room.id);
  // markRoomForSync intentionally does not await its Redis write. PING is a
  // barrier on the same connection, so the test observes its completed mark.
  await redis!.ping();
  return room;
}

function workerTick(client: SupabaseClient) {
  // Run one actual scheduled callback and await all its real Redis commands.
  // Timer cadence is covered by the default worker tests; no Redis API is mocked.
  const schedule = vi.spyOn(globalThis, "setInterval");
  const timer = startDbSyncWorker(client);
  if (timer) clearInterval(timer);
  const callback = schedule.mock.calls.at(-1)![0] as () => Promise<void>;
  schedule.mockRestore();
  vi.setSystemTime(1_010_000);
  return callback();
}

describe.skipIf(!redis)("real Redis persistence queue acknowledgements", () => {
  beforeAll(async () => {
    await redis!.ping();
    expect(
      await redis!.zcard("pending_db_syncs"),
      "Use an empty disposable Redis database",
    ).toBe(0);
  });
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    vi.setSystemTime(1_000_000);
  });
  afterEach(async () => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    if (rooms.length) {
      await redis!.zrem("pending_db_syncs", ...rooms);
      await redis!.del(
        ...rooms.flatMap((id) => [`room_state:${id}`, `db_sync_lock:${id}`]),
      );
      rooms.length = 0;
    }
  });
  afterAll(async () => {
    await redis!.quit();
  });

  it("keeps same-millisecond marks distinct and preserves a future retry deadline", async () => {
    const room = await fixture();
    markRoomForSync(room.id);
    await redis!.ping();
    expect(await redis!.zscore("pending_db_syncs", room.id)).toBe("1000001");

    await redis!.zadd("pending_db_syncs", 1_060_000, room.id);
    markRoomForSync(room.id);
    await redis!.ping();
    expect(await redis!.zscore("pending_db_syncs", room.id)).toBe("1060001");
    await flushDbSyncQueue(database(async () => ({ error: null })));
    expect(await redis!.zscore("pending_db_syncs", room.id)).toBeNull();
  });

  it("does not acknowledge a new same-millisecond mark with an older flush", async () => {
    const room = await fixture();
    const entered = deferred<void>();
    const release = deferred<{ error: unknown }>();
    const writes: string[] = [];
    const flushing = flushDbSyncQueue(
      database(async (state) => {
        writes.push(state.name);
        entered.resolve();
        return release.promise;
      }),
    );
    await entered.promise;
    await setRedisRoom(room.id, {
      ...room,
      name: "Updated",
      version: room.version + 1,
    });
    markRoomForSync(room.id);
    await redis!.ping();
    release.resolve({ error: null });
    await flushing;

    expect(await redis!.zscore("pending_db_syncs", room.id)).toBe("1000001");
    await flushDbSyncQueue(
      database(async (state) => {
        writes.push(state.name);
        return { error: null };
      }),
    );
    expect(writes).toEqual(["Initial", "Updated"]);
    expect(await redis!.zscore("pending_db_syncs", room.id)).toBeNull();
  });

  it("retains failed legacy entries while flushing other rooms", async () => {
    const failed = await fixture("Failing");
    const healthy = await fixture("Healthy");
    await redis!.zadd(
      "pending_db_syncs",
      900_000,
      failed.id,
      900_001,
      healthy.id,
    );
    vi.spyOn(console, "error").mockImplementation(() => {});
    const written: string[] = [];
    await flushDbSyncQueue(
      database(async (state) => {
        written.push(state.name);
        return { error: state.name === "Failing" ? { code: "XX000" } : null };
      }),
    );

    expect(written).toEqual(["Failing", "Healthy"]);
    expect(await redis!.zscore("pending_db_syncs", failed.id)).toBe("900000");
    expect(await redis!.zscore("pending_db_syncs", healthy.id)).toBeNull();
    await flushDbSyncQueue(database(async () => ({ error: null })));
    expect(await redis!.zscore("pending_db_syncs", failed.id)).toBeNull();
  });

  it("leaves a new mark pending when an older worker write succeeds", async () => {
    const room = await fixture();
    const entered = deferred<void>();
    const release = deferred<{ error: unknown }>();
    const writes: string[] = [];
    const working = workerTick(
      database(async (state) => {
        writes.push(state.name);
        entered.resolve();
        return release.promise;
      }),
    );
    await entered.promise;
    await setRedisRoom(room.id, {
      ...room,
      name: "Latest",
      version: room.version + 1,
    });
    markRoomForSync(room.id);
    await redis!.ping();
    release.resolve({ error: null });
    await working;

    expect(await redis!.zscore("pending_db_syncs", room.id)).toBe("1010000");
    expect(await redis!.get(`db_sync_lock:${room.id}`)).toBeNull();
    await flushDbSyncQueue(
      database(async (state) => {
        writes.push(state.name);
        return { error: null };
      }),
    );
    expect(writes).toEqual(["Initial", "Latest"]);
    expect(await redis!.zscore("pending_db_syncs", room.id)).toBeNull();
  });

  it("does not overwrite a new mark with an older worker's retry deadline", async () => {
    const room = await fixture();
    const entered = deferred<void>();
    const release = deferred<{ error: unknown }>();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const working = workerTick(
      database(async () => {
        entered.resolve();
        return release.promise;
      }),
    );
    await entered.promise;
    markRoomForSync(room.id);
    await redis!.ping();
    release.resolve({ error: { code: "XX000" } });
    await working;

    expect(await redis!.zscore("pending_db_syncs", room.id)).toBe("1010000");
    expect(await redis!.get(`db_sync_lock:${room.id}`)).toBeNull();
  });

  it("backs off the unchanged failing mark for one minute", async () => {
    const room = await fixture();
    vi.spyOn(console, "error").mockImplementation(() => {});
    await workerTick(database(async () => ({ error: { code: "XX000" } })));
    expect(await redis!.zscore("pending_db_syncs", room.id)).toBe("1070000");
    expect(await redis!.get(`db_sync_lock:${room.id}`)).toBeNull();
  });

  it("removes an unchanged legacy marker for a confirmed missing room", async () => {
    const roomId = randomUUID();
    rooms.push(roomId);
    await redis!.zadd("pending_db_syncs", 900_000, roomId);
    const writes: string[] = [];
    await flushDbSyncQueue(
      database(async (state) => {
        writes.push(state.name);
        return { error: null };
      }),
    );
    expect(writes).toEqual([]);
    expect(await redis!.zscore("pending_db_syncs", roomId)).toBeNull();
  });
});
