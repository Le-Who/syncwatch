import { describe, expect, it } from "vitest";
import { RoomCommandService } from "../lib/room-command-service";
import { InMemoryRoomRepository } from "../lib/room-repository";
import { RoomEventBus } from "../lib/room-event-bus";
import {
  reduceCanonicalRoomEvent,
  type CanonicalRoomConsumer,
} from "../lib/room-event-reducer";
import type { RoomEvent } from "../lib/room-events";
import { roomWithParticipants } from "./helpers/room-fixtures";

describe("two-node mixed full and compact delivery", () => {
  it("does not mark delayed metadata as fresh canonical playback after reconnect", () => {
    const room = roomWithParticipants(1);
    room.sequence = 7;
    const result = reduceCanonicalRoomEvent(
      { room, fullSequence: 5, deliveryVersion: 10 },
      {
        type: "room_state",
        room: { ...room, name: "Renamed", sequence: 6 },
        serverTime: 123,
      },
    );
    expect(result.room.name).toBe("Renamed");
    expect(result.deliveryVersion).toBe(10);
  });
  for (const switchMedia of [false, true])
    it(`converges after compact overtakes ${switchMedia ? "media switch" : "rename"}`, async () => {
      const room = roomWithParticipants(5);
      const a = "00000000-0000-4000-8000-000000000001";
      const b = "00000000-0000-4000-8000-000000000002";
      room.currentMediaId = a;
      room.playlist = [a, b].map((id) => ({
        id,
        url: `https://example.com/${id}.mp4`,
        title: id,
        provider: "file",
        duration: 200,
        addedBy: "p0",
      }));
      const repository = new InMemoryRoomRepository([room]);
      let consumer: CanonicalRoomConsumer = { room, deliveryVersion: 0 };
      const held: RoomEvent[] = [];
      const aBus = new RoomEventBus((_id, event) => held.push(event));
      const bBus = new RoomEventBus((_id, event) => {
        consumer = reduceCanonicalRoomEvent(consumer, event);
      });
      const aService = new RoomCommandService({ repository, eventBus: aBus });
      const bService = new RoomCommandService({ repository, eventBus: bBus });
      const context = { currentRoomId: room.id, currentParticipantId: "p0" };
      const send = (
        service: RoomCommandService,
        type: string,
        payload: unknown,
      ) =>
        service.execute(context, {
          roomId: room.id,
          nonce: crypto.randomUUID(),
          clientSequence: 1,
          command: { type, payload },
        });
      await send(aService, "update_room_name", { name: "Updated name" });
      if (switchMedia) await send(aService, "set_media", { itemId: b });
      await send(bService, "play", {
        position: 42,
        roomGeneration: "legacy",
        mediaRun: switchMedia ? 1 : 0,
      });
      for (const event of held)
        consumer = reduceCanonicalRoomEvent(consumer, event);
      expect(consumer.room.name).toBe("Updated name");
      expect(consumer.room.currentMediaId).toBe(switchMedia ? b : a);
      expect(consumer.room.playback).toMatchObject({
        status: "playing",
        basePosition: 42,
      });
      expect(consumer.room.sequence).toBe(switchMedia ? 4 : 3);
    });
});
