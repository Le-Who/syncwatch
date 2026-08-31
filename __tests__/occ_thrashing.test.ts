import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { executeFastMutation } from "../lib/redis-lua";
import { applyAddItem } from "../lib/room-logic";
import { getRedisClient } from "../lib/redis-rate-limit";
import {
  setRedisRoom,
  getRedisRoom,
  setRedisRoomCAS,
} from "../lib/redis-actor";
import { RedisRoomRepository } from "../lib/room-repository";
import { RoomState } from "../lib/types";
import { installRedisMock, uninstallRedisMock } from "./helpers/redis-mock";

describe("OCC Thrashing Simulation (Phase 1)", () => {
  const roomId = "test-occ-room";
  let redis: NonNullable<ReturnType<typeof getRedisClient>>;
  let usingMock = false;

  beforeAll(async () => {
    const configuredRedis = getRedisClient();
    if (!configuredRedis) {
      installRedisMock();
      redis = getRedisClient()!;
      usingMock = true;
    } else {
      redis = configuredRedis;
    }
    await redis.flushall();
    await setRedisRoom(roomId, {
      id: roomId,
      version: 1,
      sequence: 1,
      participants: {
        u1: {
          id: "u1",
          role: "owner",
          nickname: "u1",
          joinedAt: 1,
          lastSeen: Date.now(),
          connection: "connected",
          playbackHealth: "idle",
          readyMediaId: null,
        },
        u2: {
          id: "u2",
          role: "viewer",
          nickname: "u2",
          joinedAt: 2,
          lastSeen: Date.now(),
          connection: "connected",
          playbackHealth: "idle",
          readyMediaId: null,
        },
      },
      settings: { controlMode: "open", autoplayNext: true, looping: false },
      playlist: [],
      chat: [],
      currentMediaId: null,
      leaderId: null,
      playback: {
        status: "paused",
        basePosition: 0,
        baseTimestamp: Date.now(),
        rate: 1,
        updatedBy: "u1",
      },
      name: "OCC Test Room",
      flashbacks: {},
      lastActivity: Date.now(),
    } as RoomState);
  });

  afterAll(async () => {
    if (usingMock) uninstallRedisMock();
    else if (redis) await redis.flushall();
  });

  it("should handle 100 concurrent fast-path mutations via Lua without deadlocking", async () => {
    const intents: Promise<any>[] = [];
    for (let i = 0; i < 100; i++) {
      intents.push(executeFastMutation(roomId, "seek", { position: i }, "u1"));
    }
    const results = await Promise.all(intents);

    const successes = results.filter((r) => r.success);
    expect(successes.length).toBe(100);
  });

  it("should apply 10 playlist additions via CAS without read-modify-write collisions", async () => {
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

  it("rejects a stale slow-state compare-and-set version", async () => {
    await setRedisRoom(roomId, {
      id: roomId,
      version: 5,
      sequence: 5,
      participants: {
        u1: {
          id: "u1",
          role: "owner",
          nickname: "u1",
          joinedAt: 1,
          lastSeen: Date.now(),
          connection: "connected",
          playbackHealth: "idle",
          readyMediaId: null,
        },
      },
      settings: { controlMode: "open", autoplayNext: true, looping: false },
      playlist: [],
      chat: [],
      currentMediaId: null,
      leaderId: null,
      playback: {
        status: "paused",
        basePosition: 0,
        baseTimestamp: Date.now(),
        rate: 1,
        updatedBy: "u1",
      },
      name: "OCC Test",
      flashbacks: {},
      lastActivity: Date.now(),
    } as RoomState);

    const repository = new RedisRoomRepository();
    const fresh = (await repository.get(roomId))!;
    const stale = structuredClone(fresh);
    fresh.version = 6;
    stale.version = 6;

    expect(await repository.compareAndSet(roomId, 5, fresh)).toBe(true);
    expect(await repository.compareAndSet(roomId, 5, stale)).toBe(false);
  });
});
