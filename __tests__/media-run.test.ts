import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { roomWithParticipants } from "./helpers/room-fixtures";
import { RoomCommandService } from "../lib/room-command-service";
import { RoomEventBus } from "../lib/room-event-bus";
import { InMemoryRoomRepository } from "../lib/room-repository";

const a = "00000000-0000-4000-8000-000000000001";
const b = "00000000-0000-4000-8000-000000000002";
function fixture() {
  const room = roomWithParticipants(3);
  room.currentMediaId = a;
  room.playback.status = "playing";
  room.playlist = [a, b].map((id) => ({
    id,
    title: id,
    url: `https://example.com/${id}.mp4`,
    provider: "file",
    duration: 200,
    addedBy: "p0",
  }));
  const repository = new InMemoryRoomRepository([room]);
  const service = new RoomCommandService({
    repository,
    eventBus: new RoomEventBus(() => {}),
  });
  const execute = (type: string, payload: unknown, nonce = randomUUID()) =>
    service.execute(
      { currentRoomId: room.id, currentParticipantId: "p0" },
      { roomId: room.id, nonce, clientSequence: 1, command: { type, payload } },
    );
  return { room, repository, execute };
}
describe("commands belong to the observed playback run", () => {
  it("rejects a command from a retired cache lifetime even with the same media run", async () => {
    const { room, repository, execute } = fixture();
    const current = { ...room, generation: "restored-cache" };
    await repository.compareAndSet(room.id, room.version, {
      ...current,
      version: room.version + 1,
    });
    expect(
      await execute("seek", {
        position: 123,
        mediaRun: 0,
        roomGeneration: "retired-cache",
      }),
    ).toMatchObject({ code: "STALE_MEDIA" });
    expect((await repository.get(room.id))?.playback.basePosition).toBe(0);
  });
  for (const type of [
    "play",
    "pause",
    "seek",
    "update_rate",
    "sync_correction",
  ]) {
    it(`rejects delayed ${type} after A → B → A`, async () => {
      const { room, repository, execute } = fixture();
      await execute("set_media", { itemId: b });
      await execute("set_media", { itemId: a });
      const before = await repository.get(room.id);
      const nonce = randomUUID();
      const ack = await execute(
        type,
        {
          roomGeneration: "legacy",
          mediaRun: 0,
          position: 123,
          rate: 2,
          forceSeek: true,
        },
        nonce,
      );
      expect(ack).toMatchObject({ nonce, code: "STALE_MEDIA" });
      expect(await repository.get(room.id)).toEqual(before);
    });
  }
  it("rejects a missing binding and keeps last writer wins within one run", async () => {
    const { room, repository, execute } = fixture();
    expect(await execute("seek", { position: 123 })).toMatchObject({
      status: "rejected",
      code: "INVALID_COMMAND",
    });
    expect(
      await execute("seek", {
        position: 30,
        roomGeneration: "legacy",
        mediaRun: 0,
      }),
    ).toMatchObject({ status: "applied" });
    expect(
      await execute("seek", {
        position: 12,
        roomGeneration: "legacy",
        mediaRun: 0,
      }),
    ).toMatchObject({ status: "applied" });
    expect((await repository.get(room.id))?.playback.basePosition).toBe(12);
  });
  it("rechecks the binding when a switch wins the compare-and-set race", async () => {
    const { room, repository, execute } = fixture();
    const cas = repository.compareAndSet.bind(repository);
    let raced = false;
    repository.compareAndSet = async (id, version, next) => {
      if (!raced) {
        raced = true;
        const switched = structuredClone(room) as typeof room & {
          mediaRun: number;
        };
        switched.currentMediaId = b;
        switched.mediaRun = 1;
        switched.version++;
        switched.sequence++;
        await cas(id, version, switched);
      }
      return cas(id, version, next);
    };
    expect(
      await execute("seek", {
        position: 123,
        roomGeneration: "legacy",
        mediaRun: 0,
      }),
    ).toMatchObject({ code: "STALE_MEDIA" });
    expect((await repository.get(room.id))?.playback.basePosition).toBe(0);
  });
});
