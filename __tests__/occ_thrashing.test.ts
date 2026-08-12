import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { executeFastMutation } from "../lib/redis-lua";
import { applyAddItem } from "../lib/room-logic";
import { getRedisClient } from "../lib/redis-rate-limit";
import {
  setRedisRoom,
  getRedisRoom,
  setRedisRoomCAS,
} from "../lib/redis-actor";
import { RoomState } from "../lib/types";

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
        u1: { id: "u1", role: "owner", nickname: "u1", lastSeen: Date.now() },
        u2: { id: "u2", role: "viewer", nickname: "u2", lastSeen: Date.now() },
      },
      settings: { controlMode: "open", autoplayNext: true, looping: false },
      playlist: [],
      currentMediaId: null,
      playback: {
        status: "paused",
        basePosition: 0,
        baseTimestamp: Date.now(),
        rate: 1,
        updatedBy: "u1",
      },
      name: "OCC Test Room",
      lastActivity: Date.now(),
    } as RoomState);
  });

  afterAll(async () => {
    if (redis) await redis.flushall();
  });

  it("should handle 100 concurrent fast-path mutations via Lua without deadlocking", async () => {
    if (!redis) return;

    const intents: Promise<any>[] = [];
    for (let i = 0; i < 100; i++) {
      intents.push(
        executeFastMutation(roomId, -1, "seek", { position: i }, "u1", "u1"),
      );
    }
    const results = await Promise.all(intents);

    const successes = results.filter((r) => r.success);
    expect(successes.length).toBe(100);
  });

  it("should apply 10 playlist additions via CAS without read-modify-write collisions", async () => {
    if (!redis) return;

    // Apply 10 add_item mutations sequentially via CAS (matching production path)
    for (let i = 0; i < 10; i++) {
      let retries = 10;
      while (retries > 0) {
        const room = (await getRedisRoom(roomId)) as RoomState;
        const baseVersion = room.version;
        const changed = applyAddItem(room, { url: `vid_${i}` }, "u1", "u1");
        if (changed) {
          room.version++;
          room.lastActivity = Date.now();
          const success = await setRedisRoomCAS(roomId, room, baseVersion);
          if (success) break;
        }
        retries--;
      }
    }

    const roomStr = await redis.get(`room_state:${roomId}`);
    const room = JSON.parse(roomStr!);
    expect(room.playlist.length).toBe(10);
  });

  it("should enforce strict OCC versioning and reject stale sequence commands (TC-201)", async () => {
    if (!redis) return;

    await setRedisRoom(roomId, {
      id: roomId,
      version: 5,
      sequence: 5,
      participants: {
        u1: { id: "u1", role: "owner", nickname: "u1", lastSeen: Date.now() },
      },
      settings: { controlMode: "open", autoplayNext: true, looping: false },
      playlist: [],
      currentMediaId: null,
      playback: {
        status: "paused",
        basePosition: 0,
        baseTimestamp: Date.now(),
        rate: 1,
        updatedBy: "u1",
      },
      name: "OCC Test",
      lastActivity: Date.now(),
    } as RoomState);

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

    const successes = [resA, resB].filter((r: any) => r.success);
    const conflicts = [resA, resB].filter(
      (r: any) => !r.success && r.error === "VERSION_CONFLICT",
    );

    expect(successes).toHaveLength(1);
    expect(conflicts).toHaveLength(1);
  });
});
