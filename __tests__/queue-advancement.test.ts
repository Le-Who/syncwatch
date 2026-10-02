import { describe, expect, it, vi } from "vitest";
import { RoomCommandService } from "../lib/room-command-service";
import { RoomEventBus } from "../lib/room-event-bus";
import { InMemoryRoomRepository } from "../lib/room-repository";
import { roomWithParticipants } from "./helpers/room-fixtures";

const ids = [1, 2, 3].map((n) => `00000000-0000-4000-8000-00000000000${n}`);
function fixture(
  options: {
    temporary?: number;
    single?: boolean;
    index?: number;
    shuffle?: boolean;
    looping?: boolean;
    autoplayNext?: boolean;
  } = {},
) {
  const room = roomWithParticipants(5, { moderatorIds: ["p1"] });
  room.settings = {
    autoplayNext: options.autoplayNext ?? true,
    looping: options.looping ?? false,
    shuffle: options.shuffle ?? false,
  };
  room.playlist = ids.slice(0, options.single ? 1 : 3).map((id, index) => ({
    id,
    url: `https://example.com/${id}.mp4`,
    title: id,
    provider: "file",
    duration: 120,
    addedBy: "p0",
    isTemporary: index === options.temporary,
  }));
  room.currentMediaId = ids[options.index ?? 0];
  room.playback.status = "playing";
  const repository = new InMemoryRoomRepository([room]);
  const service = new RoomCommandService({
    repository,
    eventBus: new RoomEventBus(() => {}),
  });
  const read = async () => (await repository.get(room.id))!;
  const send = async (type: string, payload?: unknown, actor = "p0") =>
    service.execute(
      { currentRoomId: room.id, currentParticipantId: actor },
      {
        roomId: room.id,
        clientSequence: 1,
        nonce: crypto.randomUUID(),
        command: {
          type,
          payload: payload ?? {
            currentMediaId: (await read()).currentMediaId,
            roomGeneration: "legacy",
            mediaRun: (await read()).mediaRun ?? 0,
          },
        },
      },
    );
  return { read, send };
}
describe("authoritative queue advancement", () => {
  for (const type of ["next", "video_ended"])
    for (const shuffle of [false, true])
      it(`${type} does not restart a removal-selected Set as next item (shuffle ${shuffle})`, async () => {
        const { read, send } = fixture({ shuffle });
        expect(await send("set_next_item", { itemId: ids[1] })).toMatchObject({
          status: "applied",
        });
        expect(await send("remove_item", { itemId: ids[0] })).toMatchObject({
          status: "applied",
        });
        expect(await read()).toMatchObject({
          playlist: [{ id: ids[1] }, { id: ids[2] }],
          currentMediaId: ids[1],
          nextMediaId: null,
          mediaRun: 1,
          playback: { status: "playing" },
        });

        expect(await send(type)).toMatchObject({ status: "applied" });
        expect(await read()).toMatchObject({
          playlist: [{ id: ids[1] }, { id: ids[2] }],
          currentMediaId: ids[2],
          nextMediaId: null,
          mediaRun: 2,
          playback: { status: "playing" },
        });
      });

  it("keeps a future Set as next target after removal selects another head", async () => {
    const { read, send } = fixture();
    await send("set_next_item", { itemId: ids[2] });
    await send("reorder_playlist", {
      playlist: ids.map((id) => ({ id })),
    });
    await send("remove_item", { itemId: ids[0] });
    expect(await read()).toMatchObject({
      playlist: [{ id: ids[1] }, { id: ids[2] }],
      currentMediaId: ids[1],
      nextMediaId: ids[2],
      mediaRun: 1,
    });

    expect(await send("next")).toMatchObject({ status: "applied" });
    expect(await read()).toMatchObject({
      currentMediaId: ids[2],
      nextMediaId: null,
      mediaRun: 2,
    });
  });

  it("clears Set as next when its target is removed", async () => {
    const { read, send } = fixture();
    await send("set_next_item", { itemId: ids[1] });
    expect(await send("remove_item", { itemId: ids[1] })).toMatchObject({
      status: "applied",
    });
    expect(await read()).toMatchObject({
      playlist: [{ id: ids[0] }, { id: ids[2] }],
      currentMediaId: ids[0],
      nextMediaId: null,
      mediaRun: 0,
    });
  });

  it("consumes Set as next when that item is directly selected, avoiding a same-item repeat", async () => {
    const { read, send } = fixture({ shuffle: true, looping: true });
    await send("set_next_item", { itemId: ids[1] });
    await send("set_media", { itemId: ids[1] });
    expect((await read()).nextMediaId).toBeNull();
    await send("next");
    expect((await read()).currentMediaId).not.toBe(ids[1]);
  });
  for (const type of ["next", "video_ended"])
    for (const index of [0, 1, 2])
      it(`${type} consumes temporary item at ${index} and retains kept entries`, async () => {
        const { read, send } = fixture({
          temporary: index,
          index,
          looping: true,
        });
        expect(await send(type)).toMatchObject({ status: "applied" });
        const room = await read();
        expect(room.playlist.map((i) => i.id)).toEqual(
          ids.filter((_, n) => n !== index),
        );
        expect(room.currentMediaId).toBe(ids[(index + 1) % 3]);
        expect(room.playback.status).toBe("playing");
      });
  for (const type of ["next", "video_ended"])
    it(`${type} clears a single temporary item even while looping`, async () => {
      const { read, send } = fixture({
        temporary: 0,
        single: true,
        looping: true,
      });
      expect(await send(type)).toMatchObject({ status: "applied" });
      expect(await read()).toMatchObject({
        playlist: [],
        currentMediaId: null,
        playback: { status: "ended" },
      });
    });
  it("autoplay off stops natural end despite looping, but explicit Next advances", async () => {
    const { read, send } = fixture({
      autoplayNext: false,
      looping: true,
      index: 2,
    });
    await send("video_ended");
    expect(await read()).toMatchObject({
      currentMediaId: ids[2],
      playback: { status: "ended" },
    });
    await send("next");
    expect(await read()).toMatchObject({
      currentMediaId: ids[0],
      playback: { status: "playing" },
    });
  });
  it("autoplay off consumes temporary media and clears selection without starting a kept item", async () => {
    const { read, send } = fixture({
      autoplayNext: false,
      looping: true,
      temporary: 0,
    });
    await send("video_ended");
    expect(await read()).toMatchObject({
      currentMediaId: null,
      playback: { status: "ended" },
    });
    expect((await read()).playlist.map((i) => i.id)).toEqual([ids[1], ids[2]]);
  });
  it("shuffle visits each eligible entry once then loops without an immediate repeat", async () => {
    const random = vi.spyOn(Math, "random").mockReturnValue(0.99);
    try {
      const { read, send } = fixture({ shuffle: true, looping: true });
      await send("next");
      expect((await read()).currentMediaId).toBe(ids[2]);
      await send("video_ended");
      expect((await read()).currentMediaId).toBe(ids[1]);
      await send("next");
      expect((await read()).currentMediaId).toBe(ids[2]);
    } finally {
      random.mockRestore();
    }
  });
  it("honors Set as next once in shuffle and rejects stale ends/next even on a single-item loop", async () => {
    const { read, send } = fixture({ shuffle: true, looping: true });
    await send("set_next_item", { itemId: ids[1] }, "p1");
    await send("next");
    expect((await read()).currentMediaId).toBe(ids[1]);
    await send("next");
    expect((await read()).currentMediaId).toBe(ids[2]);
    const single = fixture({ single: true, looping: true });
    const stale = {
      currentMediaId: ids[0],
      roomGeneration: "legacy",
      mediaRun: 0,
    };
    await single.send("video_ended", stale);
    expect(await single.send("video_ended", stale)).toMatchObject({
      code: "STALE_MEDIA",
    });
    expect(await single.send("next", stale)).toMatchObject({
      code: "STALE_MEDIA",
    });
    expect(await send("set_next_item", { itemId: ids[0] }, "p2")).toMatchObject(
      { code: "NOT_PERMITTED" },
    );
  });
});
