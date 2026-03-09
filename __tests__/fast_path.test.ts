import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { executeFastMutation } from "../lib/redis-lua";
import { getRedisClient } from "../lib/redis-rate-limit";
import {
  setRedisRoomCAS,
  setRedisRoom,
  getRedisRoom,
} from "../lib/redis-actor";
import { randomUUID } from "node:crypto";

const TEST_RUN_ID = randomUUID().slice(0, 8);

describe("Fast-Path OCC Logic", () => {
  const roomId = `test-fast-path-${TEST_RUN_ID}`;
  let redis: ReturnType<typeof getRedisClient>;

  beforeAll(async () => {
    redis = getRedisClient();
    if (!redis) return;

    // Arrange: Setup initial fast-path room
    await setRedisRoom(roomId, {
      id: roomId,
      version: 1,
      sequence: 1,
      name: "Fast Path Test Room",
      participants: {
        u1: {
          id: "u1",
          role: "owner",
          nickname: "Owner",
          lastSeen: Date.now(),
        },
      },
      settings: { controlMode: "open", autoplayNext: true, looping: false },
      playlist: [
        {
          id: "mock_video_id",
          url: "https://youtube.com/watch?v=mock",
          provider: "youtube",
          title: "Mock Title",
          duration: 300,
          addedBy: "u1",
        },
      ],
      currentMediaId: "mock_video_id",
      playback: {
        status: "paused",
        basePosition: 0,
        baseTimestamp: Date.now(),
        rate: 1,
        updatedBy: "u1",
      },
      lastActivity: Date.now(),
    } as any);
  });

  afterAll(async () => {
    if (redis) {
      const keys = await redis.keys(`*${TEST_RUN_ID}*`);
      if (keys.length > 0) {
        await redis.del(...keys);
      }
    }
  });

  it("TC-Fast-1: Should correctly update state via Lua script on fast-path play mutation", async () => {
    if (!redis) return; // Skip if no external redis bounds present

    // Act: Send 'play' mutation
    const result = await executeFastMutation(
      roomId,
      -1, // LWW bypassing explicit sequence checks for fast paths
      "play",
      { position: 50 },
      "u1",
      "Owner",
    );

    // Assert: Mutation completed successfully inside Lua and matched return state
    expect(result.success).toBe(true);
    expect(result.state).toBeDefined();

    const latestState = await getRedisRoom(roomId);
    expect(latestState.playback.status).toBe("playing");
    expect(latestState.playback.basePosition).toBe(50);
  });
});
