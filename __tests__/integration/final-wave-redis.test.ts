/** @vitest-environment node */
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import { getRedisClient } from "../../lib/redis-rate-limit";
import { setRedisRoom } from "../../lib/redis-actor";
import { RedisRoomRepository } from "../../lib/room-repository";
import { RoomCommandService } from "../../lib/room-command-service";
import { RoomEventBus } from "../../lib/room-event-bus";
import { setupPubSubListeners } from "../../lib/socket/pubsub";
import {
  reduceCanonicalRoomEvent,
  type CanonicalRoomConsumer,
} from "../../lib/room-event-reducer";
import { roomWithParticipants } from "../helpers/room-fixtures";

const redis = process.env.REDIS_URL ? getRedisClient() : null;
const keys: string[] = [];
const a = "00000000-0000-4000-8000-000000000001";
const b = "00000000-0000-4000-8000-000000000002";
async function fixture() {
  const room = roomWithParticipants(5);
  room.id = `final-wave-${randomUUID()}`;
  room.currentMediaId = a;
  room.playback.status = "playing";
  room.playlist = [a, b].map((id) => ({
    id,
    url: `https://example.com/${id}.mp4`,
    title: id,
    provider: "file",
    duration: 200,
    addedBy: "p0",
  }));
  await setRedisRoom(room.id, room);
  keys.push(`room_state:${room.id}`);
  const repository = new RedisRoomRepository();
  return { room, repository };
}
function send(
  service: RoomCommandService,
  roomId: string,
  type: string,
  payload: unknown,
) {
  return service.execute(
    { currentRoomId: roomId, currentParticipantId: "p0" },
    {
      roomId,
      nonce: randomUUID(),
      clientSequence: 1,
      command: { type, payload },
    },
  );
}
afterAll(async () => {
  if (redis) {
    if (keys.length) await redis.del(...keys);
    await redis.quit();
  }
});
describe.skipIf(!redis)("real Redis final correction boundaries", () => {
  it("rejects retired-generation commands in Lua while accepting current same-run LWW", async () => {
    const { room, repository } = await fixture();
    await setRedisRoom(room.id, { ...room, generation: "fresh-cache" });
    const service = new RoomCommandService({
      repository,
      eventBus: new RoomEventBus(() => {}),
    });
    expect(
      await send(service, room.id, "seek", {
        mediaRun: 0,
        roomGeneration: "legacy",
        position: 123,
      }),
    ).toMatchObject({ code: "STALE_MEDIA" });
    expect(
      await send(service, room.id, "seek", {
        mediaRun: 0,
        roomGeneration: "fresh-cache",
        position: 30,
      }),
    ).toMatchObject({ status: "applied" });
    expect(
      await send(service, room.id, "seek", {
        mediaRun: 0,
        roomGeneration: "fresh-cache",
        position: 12,
      }),
    ).toMatchObject({ status: "applied" });
    expect((await repository.get(room.id))?.playback.basePosition).toBe(12);
  });
  it.each(["play", "pause", "seek", "update_rate", "sync_correction"])(
    "rejects delayed %s after next and same-item return using production Lua",
    async (type) => {
      const { room, repository } = await fixture();
      const service = new RoomCommandService({
        repository,
        eventBus: new RoomEventBus(() => {}),
      });
      await send(service, room.id, "next", {
        currentMediaId: a,
        roomGeneration: "legacy",
        mediaRun: 0,
      });
      await send(service, room.id, "set_media", { itemId: a });
      const before = await repository.get(room.id);
      expect(
        await send(service, room.id, type, {
          roomGeneration: "legacy",
          mediaRun: 0,
          position: 123,
          rate: 2,
          forceSeek: true,
        }),
      ).toMatchObject({ code: "STALE_MEDIA" });
      expect(await repository.get(room.id)).toEqual(before);
    },
  );
  it("validates the run inside Lua after a switch between permission read and atomic write", async () => {
    const { room, repository } = await fixture();
    const service = new RoomCommandService({
      repository,
      eventBus: new RoomEventBus(() => {}),
    });
    const original = redis!.eval.bind(redis!);
    let switched = false;
    const spy = vi.spyOn(redis!, "eval").mockImplementation((async (
      ...args: any[]
    ) => {
      if (!switched && String(args[0]).includes("mutation_type")) {
        switched = true;
        await setRedisRoom(room.id, {
          ...room,
          currentMediaId: b,
          roomGeneration: "legacy",
          mediaRun: 1,
          version: 2,
          sequence: 2,
        });
      }
      return (original as any)(...args);
    }) as any);
    try {
      expect(
        await send(service, room.id, "seek", {
          roomGeneration: "legacy",
          mediaRun: 0,
          position: 123,
        }),
      ).toMatchObject({ code: "STALE_MEDIA" });
    } finally {
      spy.mockRestore();
    }
    expect((await repository.get(room.id))?.playback.basePosition).toBe(0);
  });
  it.each([false, true])(
    "converges reordered full/compact pubsub (media switch=%s)",
    async (switchMedia) => {
      const { room, repository } = await fixture();
      let consumer: CanonicalRoomConsumer = { room, deliveryVersion: 0 };
      const held: Array<[string, string]> = [];
      const subscriber = redis!.duplicate();
      const aBus = new RoomEventBus(
        () => {},
        {
          publish: (channel, message) => {
            held.push([channel, message]);
          },
        },
        randomUUID(),
      );
      const bBus = new RoomEventBus(
        (id, event) => {
          if (id === room.id)
            consumer = reduceCanonicalRoomEvent(consumer, event);
        },
        redis!,
        randomUUID(),
      );
      await setupPubSubListeners(bBus, subscriber);
      try {
        const aService = new RoomCommandService({ repository, eventBus: aBus });
        const bService = new RoomCommandService({ repository, eventBus: bBus });
        await send(aService, room.id, "update_room_name", {
          name: "Redis metadata",
        });
        if (switchMedia)
          await send(aService, room.id, "set_media", { itemId: b });
        await send(bService, room.id, "play", {
          roomGeneration: "legacy",
          mediaRun: switchMedia ? 1 : 0,
          position: 42,
          forceSeek: true,
        });
        for (const [channel, message] of held)
          await redis!.publish(channel, message);
        await expect.poll(() => consumer.room.name).toBe("Redis metadata");
        await expect.poll(() => consumer.room.playback.basePosition).toBe(42);
        expect(consumer.room.currentMediaId).toBe(switchMedia ? b : a);
        expect(consumer.room.sequence).toBe(switchMedia ? 4 : 3);
      } finally {
        await subscriber.quit();
      }
    },
  );
});
