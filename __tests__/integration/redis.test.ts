import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getRedisClient } from "../../lib/redis-rate-limit";
import {
  withLock,
  getRedisRoom,
  setRedisRoomCAS,
  setRedisRoom,
} from "../../lib/redis-actor";
import { pushSlowCommand } from "../../lib/redis-queue";
import { processQueueForRoom } from "../../lib/redis-queue-worker";
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

    // Arrange: setup identical competing lock bounds
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
        // Simulate async work cleanly without implicit time races (force event loop yield)
        await new Promise((resolve) => setImmediate(resolve));
        concurrencyCounter--;
      });
    };

    // Act: Fire 5 operations absolutely concurrently
    await Promise.all([
      criticalPath(),
      criticalPath(),
      criticalPath(),
      criticalPath(),
      criticalPath(),
    ]);

    // Assert: If the lock works, the critical section is strictly sequential, so counter never exceeds 1.
    expect(maxConcurrencyObserved).toBe(1);
  });

  it("2. setRedisRoomCAS: should reject stale versions (Optimistic Concurrency Control)", async () => {
    if (!redis) return;
    const roomId = `cas_test_${TEST_RUN_ID}`;

    // Arrange: Seed initial synchronized base version
    const initialState = { id: roomId, version: 1, data: "initial" };
    await setRedisRoom(roomId, initialState);

    const v2State = { ...initialState, version: 2, data: "second" };
    const staleState = { ...initialState, version: 3, data: "stale_attempt" };

    // Act: Valid update matching version 1, followed by a stale overwrite attempt
    const success1 = await setRedisRoomCAS(roomId, v2State, 1);
    const success2 = await setRedisRoomCAS(roomId, staleState, 1);

    const current = await getRedisRoom(roomId);

    // Assert: Verify acceptance and rejection bounds
    expect(success1).toBe(true);
    expect(success2).toBe(false);
    expect(current.version).toBe(2);
    expect(current.data).toBe("second");
  });

  it("3. pushSlowCommand & processQueueForRoom: should process queued commands properly", async () => {
    if (!redis) return;

    // Arrange: Create an initial room and queue payload
    const roomId = `queue_test_${TEST_RUN_ID}`;
    const participantId = `user_${TEST_RUN_ID}`;

    const initialState = {
      id: roomId,
      name: "Queue Test Room",
      settings: { controlMode: "open", autoplayNext: true, looping: false },
      participants: {
        [participantId]: {
          id: participantId,
          nickname: "Owner",
          role: "owner",
          lastSeen: Date.now(),
        },
      },
      playlist: [],
      currentMediaId: null,
      playback: {
        status: "paused",
        basePosition: 0,
        baseTimestamp: Date.now(),
        rate: 1,
        updatedBy: participantId,
      },
      version: 1,
      sequence: 1,
      lastActivity: Date.now(),
    };

    await setRedisRoom(roomId, initialState as any);

    const payload = {
      url: "https://www.youtube.com/watch?v=mock_video",
      provider: "youtube",
      title: "Mock Video from Queue",
      duration: 180,
    };

    // Act: Push to queue, then synchronously drain the queue worker
    const pushSuccess = await pushSlowCommand(
      roomId,
      2,
      "add_item",
      payload,
      participantId,
      "Owner",
    );

    await processQueueForRoom(roomId);

    const updatedRoom = await getRedisRoom(roomId);

    // Assert: Check command was accurately materialized onto the room state
    expect(pushSuccess).toBe(true);
    expect(updatedRoom.playlist.length).toBe(1);
    expect(updatedRoom.playlist[0].title).toBe("Mock Video from Queue");
    expect(updatedRoom.currentMediaId).toBe(updatedRoom.playlist[0].id); // Since playlist was empty, playback shifts to it
    expect(updatedRoom.playback.status).toBe("paused");
  });
});
