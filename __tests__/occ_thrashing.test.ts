import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { executeFastMutation } from "../lib/redis-lua";
import { pushSlowCommand } from "../lib/redis-queue";
import { processQueueForRoom } from "../lib/redis-queue-worker";
import { getRedisClient } from "../lib/redis-rate-limit";
import { setRedisRoom } from "../lib/redis-actor";

describe("OCC Thrashing Simulation (Phase 1)", () => {
  const roomId = "test-occ-room";
  const redis = getRedisClient();

  beforeAll(async () => {
    if (!redis) return;
    await redis.flushall();
    await setRedisRoom(roomId, {
      id: roomId,
      version: 1,
      sequence: 1,
      participants: {
        u1: { id: "u1", role: "owner" },
        u2: { id: "u2", role: "guest" },
      },
      settings: { controlMode: "open" },
      playlist: [],
      playback: {
        status: "paused",
        basePosition: 0,
        baseTimestamp: Date.now(),
      },
    });
  });

  afterAll(async () => {
    if (redis) await redis.flushall();
  });

  it("should handle 100 concurrent fast-path mutations via Lua without deadlocking", async () => {
    if (!redis) return; // Skip in memory mode
    const promises = [];
    for (let i = 0; i < 100; i++) {
      // -1 bypasses strict OCC versioning for LWW
      promises.push(
        executeFastMutation(roomId, -1, "seek", { position: i }, "u1", "u1"),
      );
    }
    const results = await Promise.all(promises);
    const successes = results.filter((r) => r.success);
    expect(successes.length).toBe(100);
  });

  it("should queue 10 playlist additions and process them sequentially without read-modify-write collisions", async () => {
    if (!redis) return;
    const promises = [];
    for (let i = 0; i < 10; i++) {
      promises.push(
        pushSlowCommand(roomId, i, "add_item", { url: `vid_${i}` }, "u1", "u1"),
      );
    }
    await Promise.all(promises);

    // Process queue synchronously for test
    await processQueueForRoom(roomId);

    const roomStr = await redis.get(`room_state:${roomId}`);
    const room = JSON.parse(roomStr!);
    expect(room.playlist.length).toBe(10);
  });

  it("should enforce strict OCC versioning and reject stale sequence commands (TC-201)", async () => {
    if (!redis) return;

    // Set baseline
    await setRedisRoom(roomId, {
      id: roomId,
      version: 5,
      sequence: 5,
      participants: { u1: { id: "u1", role: "owner" } },
      settings: { controlMode: "open" },
      playlist: [],
      playback: {
        status: "paused",
        basePosition: 0,
        baseTimestamp: Date.now(),
        rate: 1,
        updatedBy: "u1",
      }, // added rate and updatedBy to satisfy types
    } as any);

    // Emulate 2 clients racing with the same sequence knowledge (e.g. sequence 5)
    const reqA = executeFastMutation(
      roomId,
      5,
      "play",
      { position: 10 },
      "u1",
      "u1",
    );
    const reqB = executeFastMutation(
      roomId,
      5,
      "seek",
      { position: 20 },
      "u1",
      "u1",
    );

    const [resA, resB] = await Promise.all([reqA, reqB]);

    // One must succeed, one must fail with VERSION_CONFLICT
    const successes = [resA, resB].filter((r: any) => r.success);
    const conflicts = [resA, resB].filter(
      (r: any) => !r.success && r.error === "VERSION_CONFLICT",
    );

    expect(successes).toHaveLength(1);
    expect(conflicts).toHaveLength(1);
  });
});
