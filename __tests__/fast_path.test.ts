import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  afterAll,
  vi,
} from "vitest";
import { executeFastMutation } from "../lib/redis-lua";
import * as permissions from "../lib/permissions";
import { getRedisClient } from "../lib/redis-rate-limit";
import {
  setRedisRoomCAS,
  setRedisRoom,
  getRedisRoom,
} from "../lib/redis-actor";
import { installRedisMock, uninstallRedisMock } from "./helpers/redis-mock";
import { randomUUID } from "node:crypto";
import { RedisRoomRepository } from "../lib/room-repository";

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
  });

  beforeEach(async () => {
    vi.restoreAllMocks();
    // Arrange: Setup initial fast-path room for each test so leader/position
    // mutations cannot leak between cases.
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
        u2: {
          id: "u2",
          role: "viewer",
          nickname: "Viewer",
          lastSeen: Date.now(),
        },
        u3: {
          id: "u3",
          role: "moderator",
          nickname: "Mod",
          lastSeen: Date.now(),
        },
        u4: {
          id: "u4",
          role: "viewer",
          nickname: "Other Viewer",
          lastSeen: Date.now(),
        },
      },
      leaderId: null,
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
      "play",
      { roomGeneration: "legacy", mediaRun: 0, position: 50 },
      "u1",
    );

    // Assert: Mutation completed successfully inside Lua and matched return state
    expect(result.success).toBe(true);
    expect(result.state).toBeDefined();

    const latestState = await getRedisRoom(roomId);
    expect(latestState.playback.status).toBe("playing");
    expect(latestState.playback.basePosition).toBe(50);
  });

  it("treats legacy Redis buffering commands as canonical no-ops", async () => {
    const result = await executeFastMutation(
      roomId,
      "buffering",
      {
        roomGeneration: "legacy",
        mediaRun: 0,
        position: 99,
        nonce: randomUUID(),
      },
      "u1",
    );

    expect(result).toEqual({ success: false, error: "NO_CHANGE" });
    expect(await getRedisRoom(roomId)).toMatchObject({
      sequence: 1,
      playback: { status: "paused", basePosition: 0 },
    });
  });

  it("TC-Fast-2: Should reject unauthorized participant", async () => {
    const result = await executeFastMutation(
      roomId,
      "play",
      { roomGeneration: "legacy", mediaRun: 0, position: 100 },
      "unknown_user",
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe("UNAUTHORIZED");
  });

  it("TC-Fast-2b: Should allow viewer playback control when there is no leader", async () => {
    const viewerResult = await executeFastMutation(
      roomId,
      "play",
      { roomGeneration: "legacy", mediaRun: 0, position: 12 },
      "u2",
    );

    expect(viewerResult.success).toBe(true);
    const viewerState = await getRedisRoom(roomId);
    expect(viewerState.playback.basePosition).toBe(12);
    expect(viewerState.playback.updatedBy).toBe("u2");
  });

  it("uses the shared permission policy before applying an atomic fast mutation", async () => {
    const permissionSpy = vi
      .spyOn(permissions, "getParticipantPermissions")
      .mockReturnValue({
        canAddPlaylist: true,
        canEditPlaylist: false,
        canControlPlayback: false,
        canManageRoom: false,
        isOwner: false,
        isOwnerOrMod: false,
        isLeader: false,
        hasActiveLeader: false,
      });

    const result = await executeFastMutation(
      roomId,
      "play",
      { roomGeneration: "legacy", mediaRun: 0, position: 12 },
      "u2",
    );

    expect(result).toEqual({ success: false, error: "UNAUTHORIZED" });
    expect((await getRedisRoom(roomId)).playback.basePosition).toBe(0);
    permissionSpy.mockRestore();
  });

  it("normalizes a legacy Redis room before returning it to the fast path", async () => {
    await setRedisRoom(roomId, {
      id: roomId,
      name: "Legacy Fast Path Room",
      settings: { autoplayNext: true, looping: false },
      participants: {
        u2: { id: "u2", nickname: "Viewer", role: "viewer", lastSeen: 1 },
      },
      playlist: [],
      currentMediaId: null,
      playback: {
        status: "buffering",
        basePosition: 4,
        baseTimestamp: 1,
        rate: 1,
        updatedBy: "u2",
      },
      version: 1,
      sequence: 1,
      lastActivity: 1,
    });

    const room = await getRedisRoom(roomId);

    expect(room.playback.status).toBe("paused");
    expect(room.chat).toEqual([]);
    expect(room.flashbacks).toEqual({});
    expect(room.participants.u2.connection).toBe("connected");
  });

  it("TC-Fast-2c: Should reject non-leader playback control while allowing leader and moderator control", async () => {
    const stateWithLeader = await getRedisRoom(roomId);
    stateWithLeader.leaderId = "u2";
    await setRedisRoom(roomId, stateWithLeader);

    const otherViewerResult = await executeFastMutation(
      roomId,
      "play",
      { roomGeneration: "legacy", mediaRun: 0, position: 12 },
      "u4",
    );

    expect(otherViewerResult.success).toBe(false);
    expect(otherViewerResult.error).toBe("UNAUTHORIZED");

    const leaderResult = await executeFastMutation(
      roomId,
      "play",
      { roomGeneration: "legacy", mediaRun: 0, position: 12 },
      "u2",
    );

    expect(leaderResult.success).toBe(true);

    const moderatorResult = await executeFastMutation(
      roomId,
      "play",
      { roomGeneration: "legacy", mediaRun: 0, position: 13, forceSeek: true },
      "u3",
    );

    expect(moderatorResult.success).toBe(true);
    const state = await getRedisRoom(roomId);
    expect(state.playback.basePosition).toBe(13);
    expect(state.playback.updatedBy).toBe("u3");
  });

  it("reloads Redis authorization after a conflict and rejects a viewer who lost control", async () => {
    const originalEval = (redis as any).eval.bind(redis);
    const evalSpy = vi.spyOn(redis as any, "eval");
    evalSpy.mockImplementationOnce((async (
      _script: string,
      _numKeys: number,
      key: string,
    ) => {
      const competing = JSON.parse(await (redis as any).get(key));
      competing.leaderId = "u1";
      competing.version += 1;
      competing.sequence += 1;
      await (redis as any).set(key, JSON.stringify(competing));
      return "VERSION_CONFLICT";
    }) as any);
    evalSpy.mockImplementation(originalEval);

    const result = await executeFastMutation(
      roomId,
      "play",
      {
        roomGeneration: "legacy",
        mediaRun: 0,
        position: 12,
        nonce: randomUUID(),
      },
      "u2",
    );

    expect(result).toEqual({ success: false, error: "UNAUTHORIZED" });
    expect((await getRedisRoom(roomId)).playback.status).toBe("paused");
    evalSpy.mockRestore();
  });

  it("retries a Redis authorization snapshot conflict for a still-authorized moderator", async () => {
    const originalEval = (redis as any).eval.bind(redis);
    const evalSpy = vi.spyOn(redis as any, "eval");
    evalSpy.mockImplementationOnce((async (
      _script: string,
      _numKeys: number,
      key: string,
    ) => {
      const competing = JSON.parse(await (redis as any).get(key));
      competing.participants.u2.nickname = "Unrelated rename";
      competing.version += 1;
      competing.sequence += 1;
      await (redis as any).set(key, JSON.stringify(competing));
      return "VERSION_CONFLICT";
    }) as any);
    evalSpy.mockImplementation(originalEval);

    const result = await executeFastMutation(
      roomId,
      "play",
      {
        roomGeneration: "legacy",
        mediaRun: 0,
        position: 23,
        nonce: randomUUID(),
      },
      "u3",
    );

    expect(result.success).toBe(true);
    expect((await getRedisRoom(roomId)).playback.basePosition).toBe(23);
    evalSpy.mockRestore();
  });

  it("reports bounded Redis contention explicitly instead of invalid command", async () => {
    const evalSpy = vi.spyOn(redis as any, "eval");
    evalSpy.mockResolvedValue("VERSION_CONFLICT" as never);
    const room = await getRedisRoom(roomId);

    const result = await new RedisRoomRepository().mutatePlayback(
      roomId,
      {
        type: "play",
        payload: {
          roomGeneration: "legacy",
          mediaRun: 0,
          position: 31,
          nonce: randomUUID(),
        },
      },
      room.participants.u3,
    );

    expect(result).toEqual({ status: "rejected", code: "CONTENTION" });
    expect(evalSpy.mock.calls.length).toBeGreaterThan(10);
    evalSpy.mockRestore();
  });

  it("TC-Fast-3: Should handle pause mutation correctly", async () => {
    await executeFastMutation(
      roomId,
      "play",
      { roomGeneration: "legacy", mediaRun: 0, position: 70 },
      "u1",
    );

    const result = await executeFastMutation(
      roomId,
      "pause",
      { roomGeneration: "legacy", mediaRun: 0, position: 75 },
      "u1",
    );

    expect(result.success).toBe(true);
    const state = await getRedisRoom(roomId);
    expect(state.playback.status).toBe("paused");
    expect(state.playback.basePosition).toBe(75);
  });

  it("TC-Fast-4: Should handle sync_correction with nonce", async () => {
    // First set to playing
    await executeFastMutation(
      roomId,
      "play",
      { roomGeneration: "legacy", mediaRun: 0, position: 0 },
      "u1",
    );

    const nonce = "test-nonce-123";
    const result = await executeFastMutation(
      roomId,
      "sync_correction",
      { roomGeneration: "legacy", mediaRun: 0, position: 42, nonce },
      "u1",
    );

    expect(result.success).toBe(true);
    const state = await getRedisRoom(roomId);
    expect(state.playback.basePosition).toBe(42);
    expect(state.playback.lastActionNonce).toBe(nonce);
  });

  it("records the actor ID for sync correction ordering", async () => {
    const result = await executeFastMutation(
      roomId,
      "sync_correction",
      {
        roomGeneration: "legacy",
        mediaRun: 0,
        position: 21,
        nonce: randomUUID(),
      },
      "u2",
    );

    expect(result.success).toBe(true);
    expect((await getRedisRoom(roomId)).playback.updatedBy).toBe("u2");
  });

  it("TC-Fast-5: Should return NO_CHANGE when pausing an already-paused room", async () => {
    // Ensure paused first
    await executeFastMutation(
      roomId,
      "pause",
      { roomGeneration: "legacy", mediaRun: 0, position: 10 },
      "u1",
    );

    const result = await executeFastMutation(
      roomId,
      "pause",
      { roomGeneration: "legacy", mediaRun: 0, position: 20 },
      "u1",
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe("NO_CHANGE");
  });

  it("deduplicates a playback nonce atomically and increments sequence once", async () => {
    const nonce = randomUUID();

    const first = await executeFastMutation(
      roomId,
      "seek",
      { roomGeneration: "legacy", mediaRun: 0, position: 17, nonce },
      "u1",
    );
    const second = await executeFastMutation(
      roomId,
      "seek",
      { roomGeneration: "legacy", mediaRun: 0, position: 99, nonce },
      "u1",
    );

    expect(first.success).toBe(true);
    expect(second).toEqual({ success: false, error: "DUPLICATE" });
    const state = await getRedisRoom(roomId);
    expect(state.sequence).toBe(2);
    expect(state.playback.basePosition).toBe(17);
    expect(state.playback.updatedBy).toBe("u1");
  });

  it("does not create a missing Redis room from a non-create CAS version", async () => {
    const missingRoomId = `${roomId}-missing-cas`;
    await (redis as any).del(`room_state:${missingRoomId}`);

    const created = await setRedisRoomCAS(
      missingRoomId,
      { ...(await getRedisRoom(roomId)), id: missingRoomId, version: 100 },
      99,
    );

    expect(created).toBe(false);
    expect(await getRedisRoom(missingRoomId)).toBeNull();
  });

  it("creates a missing Redis room only from the explicit create CAS version", async () => {
    const missingRoomId = `${roomId}-explicit-create`;
    await (redis as any).del(`room_state:${missingRoomId}`);
    const candidate = {
      ...(await getRedisRoom(roomId)),
      id: missingRoomId,
      version: 1,
    };

    expect(await setRedisRoomCAS(missingRoomId, candidate, 0)).toBe(true);
    expect(await getRedisRoom(missingRoomId)).toMatchObject({
      id: missingRoomId,
      version: 1,
    });
  });

  it("does not create a missing fallback room from a non-create CAS version", async () => {
    const redisGlobal = globalThis as unknown as { redisClient: any };
    const previousRedis = redisGlobal.redisClient;
    redisGlobal.redisClient = null;
    const missingRoomId = `${roomId}-missing-fallback-cas`;

    try {
      const created = await setRedisRoomCAS(
        missingRoomId,
        { ...(await getRedisRoom(roomId)), id: missingRoomId, version: 100 },
        99,
      );

      expect(created).toBe(false);
      expect(await getRedisRoom(missingRoomId)).toBeNull();
      expect(
        await setRedisRoomCAS(
          missingRoomId,
          { id: missingRoomId, version: 1 },
          0,
        ),
      ).toBe(true);
      expect(await getRedisRoom(missingRoomId)).toMatchObject({
        id: missingRoomId,
        version: 1,
      });
    } finally {
      redisGlobal.redisClient = previousRedis;
    }
  });
});
