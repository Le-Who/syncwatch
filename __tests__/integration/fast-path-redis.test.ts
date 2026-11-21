import { randomUUID } from "node:crypto";
import { Redis } from "ioredis";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  getRedisRoom,
  setRedisRoom,
  setRedisRoomCAS,
} from "../../lib/redis-actor";
import { executeFastMutation } from "../../lib/redis-lua";
import { roomWithParticipants } from "../helpers/room-fixtures";

const redisUrl = process.env.SYNCWATCH_TEST_REDIS_URL;
const playbackContext = { roomGeneration: "legacy", mediaRun: 0 };

describe.skipIf(redisUrl === undefined)(
  "production Redis Lua on disposable Redis",
  () => {
    let redis: Redis;

    beforeAll(async () => {
      if (!redisUrl?.trim())
        throw new Error(
          "Set SYNCWATCH_TEST_REDIS_URL to a disposable Redis database.",
        );
      const target = new URL(redisUrl);
      if (target.protocol !== "redis:" && target.protocol !== "rediss:") {
        throw new Error(
          "SYNCWATCH_TEST_REDIS_URL must be a redis:// or rediss:// URL.",
        );
      }
      redis = new Redis(redisUrl, {
        lazyConnect: true,
        maxRetriesPerRequest: 0,
        retryStrategy: () => null,
      });
      await redis.connect();
      expect(await redis.ping()).toBe("PONG");
      vi.stubGlobal("redisClient", redis);
    });

    afterAll(() => {
      redis?.disconnect();
      vi.unstubAllGlobals();
    });

    function fixture(onTestFinished: (cleanup: () => Promise<void>) => void) {
      const room = roomWithParticipants(2);
      room.id = `lua-integration-${randomUUID()}`;
      onTestFinished(async () => {
        await redis.del(`room_state:${room.id}`);
      });
      return room;
    }

    it("applies CAS once and preserves the winner against an outdated version", async ({
      onTestFinished,
    }) => {
      const room = fixture(onTestFinished);
      await expect(setRedisRoomCAS(room.id, room, 0)).resolves.toBe(true);
      const winner = {
        ...room,
        version: room.version + 1,
        name: "Accepted CAS",
      };
      const stale = { ...winner, name: "Stale CAS" };

      await expect(
        setRedisRoomCAS(room.id, winner, room.version),
      ).resolves.toBe(true);
      await expect(setRedisRoomCAS(room.id, stale, room.version)).resolves.toBe(
        false,
      );
      expect(await getRedisRoom(room.id)).toMatchObject({
        name: winner.name,
        version: winner.version,
      });
    });

    it("detects a leader change in Lua and rechecks the viewer's permission", async ({
      onTestFinished,
    }) => {
      const room = fixture(onTestFinished);
      await setRedisRoom(room.id, room);
      const competingRoom = {
        ...room,
        leaderId: "p0",
        version: room.version + 1,
        sequence: room.sequence + 1,
      };
      const evalOnRedis = redis.eval.bind(redis);
      let luaResult: unknown;
      const evalSpy = vi
        .spyOn(redis, "eval")
        .mockImplementationOnce(async (script, numberOfKeys, ...args) => {
          await setRedisRoom(room.id, competingRoom);
          luaResult = await evalOnRedis(script, numberOfKeys, ...args);
          return luaResult;
        });
      try {
        await expect(
          executeFastMutation(
            room.id,
            "play",
            { ...playbackContext, position: 8 },
            "p1",
          ),
        ).resolves.toEqual({ success: false, error: "UNAUTHORIZED" });
        expect(luaResult).toBe("VERSION_CONFLICT");
        expect(await getRedisRoom(room.id)).toMatchObject({
          leaderId: "p0",
          sequence: competingRoom.sequence,
          playback: { status: "paused", basePosition: 0 },
        });
      } finally {
        evalSpy.mockRestore();
      }
    });

    it.for(["empty", "populated"])(
      "applies playback mutations and rejects a replay with %s collections",
      async (collections, { onTestFinished }) => {
        const room = fixture(onTestFinished);
        if (collections === "populated") {
          room.playlist = ["video-a", "video-b"].map((id) => ({
            id,
            url: `https://example.com/${id}.mp4`,
            provider: "file",
            title: id,
            duration: 100,
            addedBy: "p0",
          }));
          room.currentMediaId = "video-a";
          room.nextMediaId = "video-b";
          room.shufflePlayedIds = ["video-a"];
          room.chat = [
            {
              id: "m1",
              message: "hello",
              participantId: "p0",
              nickname: "p0",
              sentAt: 1,
            },
          ];
        }
        await setRedisRoom(room.id, room);
        const play = (
          type: "play" | "seek" | "pause",
          position: number,
          nonce = randomUUID(),
        ) =>
          executeFastMutation(
            room.id,
            type,
            { ...playbackContext, position, nonce },
            "p0",
          );

        await expect(play("play", 10)).resolves.toMatchObject({
          success: true,
          state: {
            sequence: room.sequence + 1,
            playback: { status: "playing", basePosition: 10 },
            playlist: room.playlist,
            chat: room.chat,
            shufflePlayedIds: room.shufflePlayedIds,
          },
        });
        const seekNonce = randomUUID();
        await expect(play("seek", 25, seekNonce)).resolves.toMatchObject({
          success: true,
          state: {
            sequence: room.sequence + 2,
            playback: { status: "playing", basePosition: 25 },
          },
        });
        await expect(play("seek", 99, seekNonce)).resolves.toEqual({
          success: false,
          error: "DUPLICATE",
        });
        await expect(play("pause", 26)).resolves.toMatchObject({
          success: true,
          state: {
            sequence: room.sequence + 3,
            playback: { status: "paused", basePosition: 26 },
          },
        });
        expect(await getRedisRoom(room.id)).toMatchObject({
          version: room.version + 3,
          sequence: room.sequence + 3,
          playback: { status: "paused", basePosition: 26, updatedBy: "p0" },
          playlist: room.playlist,
          chat: room.chat,
          nextMediaId: room.nextMediaId,
          shufflePlayedIds: room.shufflePlayedIds,
        });
      },
    );
  },
);
