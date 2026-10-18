import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { RoomCommandService } from "../lib/room-command-service";
import { RoomEventBus } from "../lib/room-event-bus";
import { InMemoryRoomRepository } from "../lib/room-repository";
import type { RoomEvent } from "../lib/room-events";
import type { RoomState } from "../lib/types";
import { roomWithParticipants } from "./helpers/room-fixtures";

const a = "00000000-0000-4000-8000-000000000001";
const b = "00000000-0000-4000-8000-000000000002";

function fixture() {
  const room = roomWithParticipants(3, { moderatorIds: ["p1"] });
  room.currentMediaId = a;
  room.playback.status = "paused";
  room.playlist = [a, b].map((id) => ({
    id,
    url: `https://example.com/${id}.mp4`,
    provider: "file",
    title: id,
    duration: 120,
    addedBy: "p0",
  }));
  return room;
}

// Commit a competing writer's actual snapshot on the first CAS. The service
// must rerun its mutation against that snapshot instead of trusting preflight.
class CompetingRepository extends InMemoryRoomRepository {
  private raced = false;
  winner: RoomState | null = null;

  constructor(
    room: RoomState,
    private readonly compete: (room: RoomState) => RoomState | null,
  ) {
    super([room]);
  }

  override async compareAndSet(
    roomId: string,
    version: number,
    next: RoomState,
  ) {
    if (!this.raced) {
      this.raced = true;
      const current = (await this.get(roomId))!;
      const winner = this.compete(current);
      if (!winner) {
        await this.expire(roomId, 0);
        await new Promise((resolve) => setTimeout(resolve, 5));
      } else {
        winner.version = version + 1;
        winner.sequence += 1;
        await super.compareAndSet(roomId, version, winner);
      }
      this.winner = await this.get(roomId);
      return false;
    }
    return super.compareAndSet(roomId, version, next);
  }
}

function harness(
  room = fixture(),
  repository: InMemoryRoomRepository = new InMemoryRoomRepository([room]),
) {
  const events: RoomEvent[] = [];
  const persisted: RoomState[] = [];
  const service = new RoomCommandService({
    repository,
    eventBus: new RoomEventBus((_roomId, event) => events.push(event)),
    schedulePersistence: (committed) => {
      persisted.push(structuredClone(committed));
    },
  });
  const send = (
    type: string,
    payload: unknown,
    nonce = randomUUID(),
    actor = "p1",
  ) =>
    service.execute(
      { currentRoomId: room.id, currentParticipantId: actor },
      { roomId: room.id, nonce, clientSequence: 1, command: { type, payload } },
    );
  return { repository, events, persisted, send };
}

describe("slow commands revalidate the authoritative snapshot after a CAS conflict", () => {
  it("does not recreate an expired room", async () => {
    const room = fixture();
    const repository = new CompetingRepository(room, () => null);
    const { send, events, persisted } = harness(room, repository);

    expect(await send("send_chat", { message: "too late" })).toMatchObject({
      status: "rejected",
      code: "NOT_JOINED",
    });
    expect(await repository.get(room.id)).toBeNull();
    expect(events).toEqual([]);
    expect(persisted).toEqual([]);
  });

  it("does not commit a removed participant's pending chat", async () => {
    const room = fixture();
    const repository = new CompetingRepository(room, (competing) => {
      delete competing.participants.p1;
      return competing;
    });
    const { send, events, persisted } = harness(room, repository);

    expect(await send("send_chat", { message: "too late" })).toMatchObject({
      status: "rejected",
      code: "NOT_PARTICIPANT",
    });
    expect(await repository.get(room.id)).toEqual(repository.winner);
    expect((await repository.get(room.id))?.chat).toEqual([]);
    expect(events).toEqual([]);
    expect(persisted).toEqual([]);
  });

  it("honors a moderator's revoked room-management permission", async () => {
    const room = fixture();
    const repository = new CompetingRepository(room, (competing) => {
      competing.participants.p1.role = "viewer";
      return competing;
    });
    const { send, events, persisted } = harness(room, repository);

    expect(
      await send("update_room_name", { name: "Forbidden rename" }),
    ).toMatchObject({
      status: "rejected",
      code: "NOT_PERMITTED",
    });
    expect(await repository.get(room.id)).toEqual(repository.winner);
    expect((await repository.get(room.id))?.name).toBe("Test Room");
    expect(events).toEqual([]);
    expect(persisted).toEqual([]);
  });

  it("does not publish or append a nonce already committed by another writer", async () => {
    const room = fixture();
    const nonce = randomUUID();
    const repository = new CompetingRepository(room, (competing) => {
      competing.processedCommandNonces = [nonce];
      competing.chat.push({
        id: "competing-chat",
        participantId: "p1",
        nickname: "p1",
        message: "once",
        sentAt: 1,
      });
      return competing;
    });
    const { send, events, persisted } = harness(room, repository);

    expect(await send("send_chat", { message: "once" }, nonce)).toMatchObject({
      status: "ignored",
      code: "DUPLICATE",
    });
    expect(await repository.get(room.id)).toEqual(repository.winner);
    expect((await repository.get(room.id))?.chat).toHaveLength(1);
    expect(events).toEqual([]);
    expect(persisted).toEqual([]);
  });

  it.each([
    { type: "next", change: "media", expectedMedia: b },
    { type: "video_ended", change: "run", expectedMedia: a },
    { type: "next", change: "generation", expectedMedia: a },
  ])(
    "ignores $type after a competing $change change",
    async ({ type, change, expectedMedia }) => {
      const room = fixture();
      const repository = new CompetingRepository(room, (competing) => {
        if (change === "media") competing.currentMediaId = b;
        if (change === "run") competing.mediaRun = 1;
        if (change === "generation") competing.generation = "replacement-room";
        return competing;
      });
      const { send, events, persisted } = harness(room, repository);

      expect(
        await send(type, {
          currentMediaId: a,
          mediaRun: 0,
          roomGeneration: "legacy",
        }),
      ).toMatchObject({
        status: "ignored",
        code: "STALE_MEDIA",
      });
      expect(await repository.get(room.id)).toEqual(repository.winner);
      expect((await repository.get(room.id))?.currentMediaId).toBe(
        expectedMedia,
      );
      expect(events).toEqual([]);
      expect(persisted).toEqual([]);
    },
  );

  it("rejects the entire batch when a competing addition makes its URL duplicate", async () => {
    const room = fixture();
    const repository = new CompetingRepository(room, (competing) => {
      competing.playlist.push({
        id: "00000000-0000-4000-8000-000000000003",
        url: "https://example.com/new.mp4",
        provider: "file",
        title: "Competing addition",
        duration: 120,
        addedBy: "p0",
      });
      return competing;
    });
    const { send, events, persisted } = harness(room, repository);

    expect(
      await send("add_items", {
        items: [
          { url: "https://example.com/new.mp4" },
          { url: "https://example.com/other.mp4" },
        ],
      }),
    ).toMatchObject({
      status: "rejected",
      code: "INVALID_COMMAND",
    });
    expect(await repository.get(room.id)).toEqual(repository.winner);
    expect((await repository.get(room.id))?.playlist).toHaveLength(3);
    expect(events).toEqual([]);
    expect(persisted).toEqual([]);
  });

  it("does not overfill a queue that acquired its final item during the conflict", async () => {
    const room = fixture();
    room.playlist = Array.from({ length: 499 }, (_, index) => ({
      ...room.playlist[0],
      id: `existing-${index}`,
      url: `https://example.com/existing-${index}.mp4`,
    }));
    room.currentMediaId = room.playlist[0].id;
    const repository = new CompetingRepository(room, (competing) => {
      competing.playlist.push({
        ...competing.playlist[0],
        id: "competing-last-item",
        url: "https://example.com/last-slot.mp4",
      });
      return competing;
    });
    const { send, events, persisted } = harness(room, repository);

    expect(
      await send("add_items", {
        items: [{ url: "https://example.com/overflow.mp4" }],
      }),
    ).toMatchObject({ status: "rejected", code: "QUEUE_FULL" });
    expect(await repository.get(room.id)).toEqual(repository.winner);
    expect((await repository.get(room.id))?.playlist).toHaveLength(500);
    expect(events).toEqual([]);
    expect(persisted).toEqual([]);
  });

  it("ignores a selected item that was removed after preflight", async () => {
    const room = fixture();
    const repository = new CompetingRepository(room, (competing) => {
      competing.playlist.splice(1, 1);
      return competing;
    });
    const { send, events, persisted } = harness(room, repository);

    expect(await send("set_media", { itemId: b })).toMatchObject({
      status: "ignored",
      code: "STALE_MEDIA",
    });
    expect(await repository.get(room.id)).toEqual(repository.winner);
    expect((await repository.get(room.id))?.currentMediaId).toBe(a);
    expect(events).toEqual([]);
    expect(persisted).toEqual([]);
  });
});

describe("bulk playlist commands are atomic", () => {
  it.each([
    {
      label: "an existing URL",
      urls: [`https://example.com/${a}.mp4`, "https://example.com/new.mp4"],
    },
    {
      label: "a repeated submitted URL",
      urls: ["https://example.com/new.mp4", "https://example.com/new.mp4"],
    },
  ])("rejects $label without retaining the valid subset", async ({ urls }) => {
    const room = fixture();
    const { repository, send, events, persisted } = harness(room);

    expect(
      await send("add_items", { items: urls.map((url) => ({ url })) }),
    ).toMatchObject({
      status: "rejected",
      code: "INVALID_COMMAND",
    });
    expect(await repository.get(room.id)).toEqual(room);
    expect(events).toEqual([]);
    expect(persisted).toEqual([]);
  });

  it("rejects a batch that exceeds the remaining queue capacity without truncating it", async () => {
    const room = fixture();
    room.playlist = Array.from({ length: 499 }, (_, index) => ({
      ...room.playlist[0],
      id: `existing-${index}`,
      url: `https://example.com/existing-${index}.mp4`,
    }));
    room.currentMediaId = room.playlist[0].id;
    const { repository, send, events, persisted } = harness(room);

    expect(
      await send("add_items", {
        items: [
          { url: "https://example.com/new.mp4" },
          { url: "https://example.com/other.mp4" },
        ],
      }),
    ).toMatchObject({
      status: "rejected",
      code: "QUEUE_FULL",
    });
    expect(await repository.get(room.id)).toEqual(room);
    expect(events).toEqual([]);
    expect(persisted).toEqual([]);
  });

  it("accepts the last available slot from a viewer and publishes the entire committed queue", async () => {
    const room = fixture();
    room.playlist = Array.from({ length: 499 }, (_, index) => ({
      ...room.playlist[0],
      id: `existing-${index}`,
      url: `https://example.com/existing-${index}.mp4`,
    }));
    room.currentMediaId = room.playlist[0].id;
    const { repository, send, events, persisted } = harness(room);

    expect(
      await send(
        "add_items",
        { items: [{ url: "https://example.com/new.mp4" }], insertMode: "next" },
        randomUUID(),
        "p2",
      ),
    ).toMatchObject({ status: "applied" });
    const stored = (await repository.get(room.id))!;
    expect(stored.playlist).toHaveLength(500);
    expect(stored.playlist[1].url).toBe("https://example.com/existing-1.mp4");
    expect(stored.playlist[499]).toMatchObject({
      url: "https://example.com/new.mp4",
      requesterId: "p2",
    });
    expect(persisted).toEqual([stored]);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "room_state",
      room: { playlist: stored.playlist },
    });
  });
});

describe("playlist resume positions", () => {
  it("resumes at an explicitly saved zero instead of the original start offset", async () => {
    const room = fixture();
    room.playlist[0].startPosition = 30;
    room.playback.basePosition = 30;
    const { repository, send } = harness(room);

    await send("seek", { position: 0, mediaRun: 0, roomGeneration: "legacy" });
    await send("set_media", { itemId: b });
    expect((await repository.get(room.id))?.playlist[0].lastPosition).toBe(0);
    await send("set_media", { itemId: a });
    expect((await repository.get(room.id))?.playback.basePosition).toBe(0);
  });

  it("uses the requested offset for an unplayed newly added queue item", async () => {
    const { repository, send } = harness();
    await send("add_item", {
      url: "https://example.com/offset.mp4",
      startPosition: 30,
      duration: 120,
    });
    const stored = (await repository.get("room-test"))!;
    await send("set_media", { itemId: stored.playlist[2].id });
    expect((await repository.get("room-test"))?.playback.basePosition).toBe(30);
  });

  it.each([
    { position: undefined, expected: 30, label: "an unplayed persisted item" },
    {
      position: 114,
      expected: 114,
      label: "a saved position before the final five seconds",
    },
    {
      position: 115,
      expected: 0,
      label: "a saved position at the final five seconds",
    },
  ])("selects $label at $expected seconds", async ({ position, expected }) => {
    const room = fixture();
    room.playlist[1].startPosition = 30;
    room.playlist[1].lastPosition = position;
    const { repository, send } = harness(room);

    expect(await send("set_media", { itemId: b })).toMatchObject({
      status: "applied",
    });
    expect((await repository.get(room.id))?.playback.basePosition).toBe(
      expected,
    );
    if (position === 115) {
      expect((await repository.get(room.id))?.playlist[1].lastPosition).toBe(0);
      await send("set_media", { itemId: a });
      await send("set_media", { itemId: b });
      expect((await repository.get(room.id))?.playback.basePosition).toBe(0);
    }
  });
});
