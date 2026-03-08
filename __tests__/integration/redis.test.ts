import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getRedisClient } from "../../lib/redis-rate-limit";
import {
  withLock,
  getRedisRoom,
  setRedisRoomCAS,
  setRedisRoom,
} from "../../lib/redis-actor";
import { randomUUID } from "node:crypto";

// We require a real Redis instance (like the one in .env.local) to test Lua scripts.
// We use a unique namespace per test run to prevent CI collisions.
const TEST_RUN_ID = randomUUID().slice(0, 8);

describe("Redis Actor & Queue Integration Tests", () => {
  let redis: ReturnType<typeof getRedisClient>;

  beforeAll(() => {
    redis = getRedisClient();
    if (!redis) {
      console.warn("Skipping Redis integration tests. No REDIS_URL found.");
    }
  });

  afterAll(async () => {
    if (redis) {
      // Clean up all keys generated in this isolated test run
      const keys = await redis.keys(`*${TEST_RUN_ID}*`);
      if (keys.length > 0) {
        await redis.del(...keys);
      }
      await redis.quit();
    }
  });

  it("1. withLock: should guarantee mutual exclusion for distributed locks", async () => {
    if (!redis) return;
    const resourceId = `lock_test_${TEST_RUN_ID}`;
    let concurrencyCounter = 0;
    let maxConcurrencyObserved = 0;

    const criticalPath = async () => {
      await withLock(resourceId, 5000, async () => {
        concurrencyCounter++;
        maxConcurrencyObserved = Math.max(
          maxConcurrencyObserved,
          concurrencyCounter,
        );
        // Simulate async work
        await new Promise((resolve) => setTimeout(resolve, 50));
        concurrencyCounter--;
      });
    };

    // Fire 5 operations absolutely concurrently
    await Promise.all([
      criticalPath(),
      criticalPath(),
      criticalPath(),
      criticalPath(),
      criticalPath(),
    ]);

    // If the lock works, the critical section is strictly sequential, so counter never exceeds 1.
    expect(maxConcurrencyObserved).toBe(1);
  });

  it("2. setRedisRoomCAS: should reject stale versions (Optimistic Concurrency Control)", async () => {
    if (!redis) return;
    const roomId = `cas_test_${TEST_RUN_ID}`;

    const initialState = { id: roomId, version: 1, data: "initial" };
    await setRedisRoom(roomId, initialState);

    // 1. Valid update matching version 1
    const v2State = { ...initialState, version: 2, data: "second" };
    const success1 = await setRedisRoomCAS(roomId, v2State, 1);
    expect(success1).toBe(true);

    // 2. Stale update attempting to branch from version 1 again (should fail)
    const staleState = { ...initialState, version: 3, data: "stale_attempt" };
    const success2 = await setRedisRoomCAS(roomId, staleState, 1);
    expect(success2).toBe(false);

    // Verify current state is v2
    const current = await getRedisRoom(roomId);
    expect(current.version).toBe(2);
    expect(current.data).toBe("second");
  });
});
