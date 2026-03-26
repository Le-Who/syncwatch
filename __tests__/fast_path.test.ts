import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { executeFastMutation } from "../lib/redis-lua";
import { getRedisClient } from "../lib/redis-rate-limit";
import {
  setRedisRoomCAS,
  setRedisRoom,
  getRedisRoom,
} from "../lib/redis-actor";
import { installRedisMock, uninstallRedisMock } from "./helpers/redis-mock";
import { randomUUID } from "node:crypto";

const TEST_RUN_ID = randomUUID().slice(0, 8);

describe("Fast-Path OCC Logic", () => {
  const roomId = `test-fast-path-${TEST_RUN_ID}`;
  let redis: ReturnType<typeof getRedisClient>;
  let usingMock = false;

  beforeAll(async () => {
    redis = getRedisClient();
    if (!redis) {
      // CI fallback: use in-process Redis mock
      installRedisMock();
      redis = getRedisClient();
      usingMock = true;
    }

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
    if (usingMock) {
      uninstallRedisMock();
    } else if (redis) {
      const keys = await redis.keys(`*${TEST_RUN_ID}*`);
      if (keys.length > 0) {
        await redis.del(...keys);
      }
    }
  });

  it("TC-Fast-1: Should correctly update state via Lua script on fast-path play mutation", async () => {
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

  it("TC-Fast-2: Should reject unauthorized participant", async () => {
    const result = await executeFastMutation(
      roomId,
      -1,
      "play",
      { position: 100 },
      "unknown_user",
      "Hacker",
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe("UNAUTHORIZED");
  });

  it("TC-Fast-3: Should handle pause mutation correctly", async () => {
    const result = await executeFastMutation(
      roomId,
      -1,
      "pause",
      { position: 75 },
      "u1",
      "Owner",
    );

    expect(result.success).toBe(true);
    const state = await getRedisRoom(roomId);
    expect(state.playback.status).toBe("paused");
    expect(state.playback.basePosition).toBe(75);
  });

  it("TC-Fast-4: Should handle sync_correction with nonce", async () => {
    // First set to playing
    await executeFastMutation(roomId, -1, "play", { position: 0 }, "u1", "Owner");

    const nonce = "test-nonce-123";
    const result = await executeFastMutation(
      roomId,
      -1,
      "sync_correction",
      { position: 42, nonce },
      "u1",
      "Owner",
    );

    expect(result.success).toBe(true);
    const state = await getRedisRoom(roomId);
    expect(state.playback.basePosition).toBe(42);
    expect(state.playback.lastActionNonce).toBe(nonce);
  });

  it("TC-Fast-5: Should return NO_CHANGE when pausing an already-paused room", async () => {
    // Ensure paused first
    await executeFastMutation(roomId, -1, "pause", { position: 10 }, "u1", "Owner");

    const result = await executeFastMutation(
      roomId,
      -1,
      "pause",
      { position: 20 },
      "u1",
      "Owner",
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe("NO_CHANGE");
  });
});
