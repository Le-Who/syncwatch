import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getRedisClient } from "../../lib/redis-rate-limit";
import {
  withLock,
  getRedisRoom,
  setRedisRoomCAS,
  setRedisRoom,
} from "../../lib/redis-actor";
import { applyAddItem } from "../../lib/room-logic";
import { RoomEventBus } from "../../lib/room-event-bus";
import { setupPubSubListeners } from "../../lib/socket/pubsub";
import { RoomState } from "../../lib/types";
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
        await new Promise((resolve) => setImmediate(resolve));
        concurrencyCounter--;
      });
    };

    await Promise.all([
      criticalPath(),
      criticalPath(),
      criticalPath(),
      criticalPath(),
      criticalPath(),
    ]);

    expect(maxConcurrencyObserved).toBe(1);
  });

  it("2. setRedisRoomCAS: should reject stale versions (Optimistic Concurrency Control)", async () => {
    if (!redis) return;
    const roomId = `cas_test_${TEST_RUN_ID}`;

    const initialState = {
      id: roomId,
      name: "Initial CAS room",
      settings: { controlMode: "open", autoplayNext: true, looping: false },
      participants: {},
      playlist: [],
      chat: [],
      currentMediaId: null,
      leaderId: null,
      playback: {
        status: "paused" as const,
        basePosition: 0,
        baseTimestamp: 1,
        rate: 1,
        updatedBy: "system",
      },
      flashbacks: {},
      version: 1,
      sequence: 1,
      lastActivity: 1,
    };
    await setRedisRoom(roomId, initialState);

    const v2State = { ...initialState, version: 2, name: "Accepted CAS room" };
    const staleState = { ...initialState, version: 3, name: "Stale CAS room" };

    const success1 = await setRedisRoomCAS(roomId, v2State, 1);
    const success2 = await setRedisRoomCAS(roomId, staleState, 1);

    const current = await getRedisRoom(roomId);

    expect(success1).toBe(true);
    expect(success2).toBe(false);
    expect(current.version).toBe(2);
    expect(current.name).toBe("Accepted CAS room");
  });

  it("normalizes legacy persisted data when reading from Redis", async () => {
    if (!redis) return;
    const roomId = `legacy_read_${TEST_RUN_ID}`;
    await setRedisRoom(roomId, {
      id: roomId,
      name: "Legacy Redis Room",
      settings: { autoplayNext: true, looping: false },
      participants: {},
      playlist: [],
      currentMediaId: null,
      playback: {
        status: "buffering",
        basePosition: 0,
        baseTimestamp: 1,
        rate: 1,
        updatedBy: "system",
      },
      version: 1,
      sequence: 1,
      lastActivity: 1,
    });

    const room = await getRedisRoom(roomId);

    expect(room.playback.status).toBe("paused");
    expect(room.chat).toEqual([]);
    expect(room.leaderId).toBeNull();
    expect(room.flashbacks).toEqual({});
  });

  it("delivers a cross-node room event through real Redis pub/sub", async () => {
    if (!redis) return;
    const roomId = `pubsub_test_${TEST_RUN_ID}`;
    const sourceSubscriber = redis.duplicate();
    const targetSubscriber = redis.duplicate();
    const event = {
      type: "participant_disconnected" as const,
      participantId: `user_${TEST_RUN_ID}`,
    };
    const sourceEvents: string[] = [];
    const targetEvents: string[] = [];
    const sourceBus = new RoomEventBus(
      (observedRoomId, observedEvent) => {
        if (observedRoomId === roomId && observedEvent.type === event.type) {
          sourceEvents.push(observedEvent.participantId);
        }
      },
      redis,
      "source-test-node",
    );
    const targetBus = new RoomEventBus(
      (observedRoomId, observedEvent) => {
        if (observedRoomId === roomId && observedEvent.type === event.type) {
          targetEvents.push(observedEvent.participantId);
        }
      },
      null,
      "target-test-node",
    );

    try {
      await Promise.all([
        setupPubSubListeners(sourceBus, sourceSubscriber),
        setupPubSubListeners(targetBus, targetSubscriber),
      ]);
      await sourceBus.publish(roomId, event);
      await expect.poll(() => targetEvents).toEqual([event.participantId]);
      await expect.poll(() => sourceEvents).toEqual([event.participantId]);
    } finally {
      await Promise.all([sourceSubscriber.quit(), targetSubscriber.quit()]);
    }
  });

  it("3. applySlowCommand + CAS: should apply and persist add_item via the new inline CAS path", async () => {
    if (!redis) return;

    const roomId = `cas_cmd_test_${TEST_RUN_ID}`;
    const participantId = `user_${TEST_RUN_ID}`;

    const initialState: RoomState = {
      id: roomId,
      name: "CAS Command Test Room",
      settings: { controlMode: "open", autoplayNext: true, looping: false },
      participants: {
        [participantId]: {
          id: participantId,
          nickname: "Owner",
          role: "owner",
          joinedAt: 0,
          lastSeen: Date.now(),
          connection: "connected",
          playbackHealth: "idle",
          readyMediaId: null,
        },
      },
      playlist: [],
      chat: [],
      currentMediaId: null,
      leaderId: null,
      playback: {
        status: "paused",
        basePosition: 0,
        baseTimestamp: Date.now(),
        rate: 1,
        updatedBy: participantId,
      },
      flashbacks: {},
      version: 1,
      sequence: 1,
      lastActivity: Date.now(),
    };

    await setRedisRoom(roomId, initialState);

    // CAS loop: read → mutate → save (matches production code path)
    const room = (await getRedisRoom(roomId)) as RoomState;
    const baseVersion = room.version;
    const changed = applyAddItem(
      room,
      {
        url: "https://www.youtube.com/watch?v=mock_video",
        provider: "youtube",
        title: "Mock Video from CAS",
        duration: 180,
      },
      participantId,
      "Owner",
    );
    expect(changed).toBe(true);

    room.version++;
    const success = await setRedisRoomCAS(roomId, room, baseVersion);
    expect(success).toBe(true);

    const updatedRoom = await getRedisRoom(roomId);

    expect(updatedRoom.playlist.length).toBe(1);
    expect(updatedRoom.playlist[0].title).toBe("Mock Video from CAS");
    expect(updatedRoom.currentMediaId).toBe(updatedRoom.playlist[0].id);
    expect(updatedRoom.playback.status).toBe("paused");
  });
});
