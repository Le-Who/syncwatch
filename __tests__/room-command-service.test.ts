import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  RoomCommandService,
  type RoomCommandContext,
} from "../lib/room-command-service";
import { RoomEventBus } from "../lib/room-event-bus";
import {
  InMemoryRoomRepository,
  RedisRoomRepository,
} from "../lib/room-repository";
import { setRedisRoom } from "../lib/redis-actor";
import type {
  RoomCommand,
  RoomCommandEnvelope,
} from "../lib/room-command-contract";
import type { RoomEvent } from "../lib/room-events";
import type { RoomState } from "../lib/types";
import { handleCommandEvents } from "../lib/socket/commands";
import type { Server, Socket } from "socket.io";

const ITEM_ONE = "00000000-0000-4000-8000-000000000001";
const ITEM_TWO = "00000000-0000-4000-8000-000000000002";

function makeRoom(id = "room-a"): RoomState {
  return {
    id,
    name: "Friends",
    settings: { autoplayNext: true, looping: false },
    participants: {
      p0: {
        id: "p0",
        nickname: "Owner",
        role: "owner",
        joinedAt: 1,
        lastSeen: 1,
        connection: "connected",
        connectionIds: ["socket-p0"],
        playbackHealth: "idle",
        readyMediaId: null,
      },
      p1: {
        id: "p1",
        nickname: "Friend",
        role: "viewer",
        joinedAt: 2,
        lastSeen: 2,
        connection: "connected",
        connectionIds: ["socket-p1"],
        playbackHealth: "buffering",
        readyMediaId: null,
      },
    },
    playlist: [
      {
        id: ITEM_ONE,
        url: "https://www.youtube.com/watch?v=one",
        provider: "youtube",
        title: "One",
        duration: 120,
        addedBy: "Owner",
      },
      {
        id: ITEM_TWO,
        url: "https://www.youtube.com/watch?v=two",
        provider: "youtube",
        title: "Two",
        duration: 120,
        addedBy: "Owner",
      },
    ],
    chat: [],
    currentMediaId: ITEM_ONE,
    leaderId: null,
    playback: {
      status: "paused",
      basePosition: 0,
      baseTimestamp: 1,
      rate: 1,
      updatedBy: "system",
    },
    flashbacks: {},
    version: 1,
    sequence: 1,
    lastActivity: 1,
  };
}

function contextFor(roomId: string, participantId: string): RoomCommandContext {
  return {
    currentRoomId: roomId,
    currentParticipantId: participantId,
  };
}

function envelope<C extends RoomCommand>(
  roomId: string,
  command: C,
  nonce = randomUUID(),
): RoomCommandEnvelope {
  return { roomId, command, nonce, clientSequence: 1 };
}

function harness(room = makeRoom()) {
  const repository = new InMemoryRoomRepository([room], () => 10_000);
  const events: Array<{ roomId: string; event: RoomEvent }> = [];
  const eventBus = new RoomEventBus((roomId, event) => {
    events.push({ roomId, event });
  });
  const schedulePersistence = vi.fn();
  const service = new RoomCommandService({
    repository,
    eventBus,
    now: () => 10_000,
    schedulePersistence,
  });
  return { repository, events, schedulePersistence, service };
}

describe("RoomCommandService", () => {
  it("expires rooms through the no-Redis production repository", async () => {
    vi.useFakeTimers();
    const room = makeRoom("room-expire");
    const repository = new RedisRoomRepository();
    await setRedisRoom(room.id, room);

    await repository.expire(room.id, 1);
    await vi.advanceTimersByTimeAsync(1_000);

    expect(await repository.get(room.id)).toBeNull();
    vi.useRealTimers();
  });

  it("applies play in memory and publishes exactly one compact playback event", async () => {
    const { repository, events, service } = harness();

    const result = await service.execute(
      contextFor("room-a", "p0"),
      envelope("room-a", { type: "play", payload: { position: 8 } }),
    );

    expect(result).toMatchObject({
      status: "applied",
      roomSequence: 2,
    });
    expect(events).toEqual([
      {
        roomId: "room-a",
        event: {
          type: "playback_updated",
          playback: {
            mediaItemId: ITEM_ONE,
            status: "playing",
            basePosition: 8,
            baseTimestamp: 10_000,
            rate: 1,
            sequence: 2,
            updatedBy: "p0",
            lastActionNonce: result.nonce,
          },
          serverTime: 10_000,
        },
      },
    ]);
    expect((await repository.get("room-a"))?.playback.status).toBe("playing");
  });

  it("rejects a command targeting a room the socket did not join", async () => {
    const { repository, events, service } = harness();

    const result = await service.execute(
      contextFor("room-a", "p0"),
      envelope("room-b", { type: "pause", payload: { position: 3 } }),
    );

    expect(result).toMatchObject({
      status: "rejected",
      code: "ROOM_MISMATCH",
    });
    expect(events).toEqual([]);
    expect((await repository.get("room-a"))?.sequence).toBe(1);
  });

  it("applies the same nonce only once", async () => {
    const { repository, events, service } = harness();
    const command = envelope(
      "room-a",
      { type: "seek", payload: { position: 30 } },
      randomUUID(),
    );

    expect(
      await service.execute(contextFor("room-a", "p0"), command),
    ).toMatchObject({ status: "applied", roomSequence: 2 });
    expect(
      await service.execute(contextFor("room-a", "p0"), command),
    ).toMatchObject({ status: "ignored", code: "DUPLICATE" });

    expect((await repository.get("room-a"))?.sequence).toBe(2);
    expect(events).toHaveLength(1);
  });

  it("deduplicates a slow command after its first authoritative commit", async () => {
    const { repository, events, service } = harness();
    const command = envelope(
      "room-a",
      { type: "send_chat", payload: { message: "once" } },
      randomUUID(),
    );

    expect(
      await service.execute(contextFor("room-a", "p1"), command),
    ).toMatchObject({ status: "applied" });
    expect(
      await service.execute(contextFor("room-a", "p1"), command),
    ).toMatchObject({ status: "ignored", code: "DUPLICATE" });
    expect((await repository.get("room-a"))?.chat).toHaveLength(1);
    expect(events).toHaveLength(1);
  });

  it.each(["next", "video_ended"] as const)(
    "ignores stale %s without changing the active media or queue",
    async (type) => {
      const { repository, events, service } = harness();
      const before = await repository.get("room-a");

      const result = await service.execute(
        contextFor("room-a", "p0"),
        envelope("room-a", {
          type,
          payload: { currentMediaId: ITEM_TWO },
        }),
      );

      expect(result).toMatchObject({
        status: "ignored",
        code: "STALE_MEDIA",
      });
      expect(await repository.get("room-a")).toEqual(before);
      expect(events).toEqual([]);
    },
  );

  it("ignores set_media when the selected queue item disappeared", async () => {
    const { repository, events, service } = harness();
    const missingItemId = "00000000-0000-4000-8000-000000000099";

    const result = await service.execute(
      contextFor("room-a", "p0"),
      envelope("room-a", {
        type: "set_media",
        payload: { itemId: missingItemId },
      }),
    );

    expect(result).toMatchObject({
      status: "ignored",
      code: "STALE_MEDIA",
    });
    expect((await repository.get("room-a"))?.currentMediaId).toBe(ITEM_ONE);
    expect(events).toEqual([]);
  });

  it("records the participant ID on accepted slow playback transitions", async () => {
    const { repository, service } = harness();

    const result = await service.execute(
      contextFor("room-a", "p0"),
      envelope("room-a", {
        type: "next",
        payload: { currentMediaId: ITEM_ONE },
      }),
    );

    expect(result.status).toBe("applied");
    expect((await repository.get("room-a"))?.playback.updatedBy).toBe("p0");
  });

  it("serializes simultaneous in-memory playback commands", async () => {
    const { repository, events, service } = harness();
    const ctx = contextFor("room-a", "p0");

    const results = await Promise.all(
      Array.from({ length: 25 }, (_, position) =>
        service.execute(
          ctx,
          envelope("room-a", { type: "seek", payload: { position } }),
        ),
      ),
    );

    expect(results.every((result) => result.status === "applied")).toBe(true);
    expect((await repository.get("room-a"))?.sequence).toBe(26);
    expect(events).toHaveLength(25);
    expect(
      events.map(({ event }) =>
        event.type === "playback_updated" ? event.playback.sequence : -1,
      ),
    ).toEqual(Array.from({ length: 25 }, (_, index) => index + 2));
  });

  it("retries an in-memory playback CAS conflict without losing the command", async () => {
    class OneConflictRepository extends InMemoryRoomRepository {
      private shouldConflict = true;

      override async compareAndSet(
        roomId: string,
        expectedVersion: number,
        next: RoomState,
      ) {
        if (this.shouldConflict) {
          this.shouldConflict = false;
          return false;
        }
        return super.compareAndSet(roomId, expectedVersion, next);
      }
    }
    const repository = new OneConflictRepository([makeRoom()], () => 10_000);
    const events: RoomEvent[] = [];
    const service = new RoomCommandService({
      repository,
      eventBus: new RoomEventBus((_roomId, event) => events.push(event)),
    });

    const result = await service.execute(
      contextFor("room-a", "p0"),
      envelope("room-a", { type: "seek", payload: { position: 45 } }),
    );

    expect(result).toMatchObject({ status: "applied", roomSequence: 2 });
    expect((await repository.get("room-a"))?.playback.basePosition).toBe(45);
    expect(events).toHaveLength(1);
  });

  it("does not let another participant's buffering health block play", async () => {
    const { repository, service } = harness();

    const result = await service.execute(
      contextFor("room-a", "p0"),
      envelope("room-a", { type: "play", payload: { position: 4 } }),
    );

    expect(result.status).toBe("applied");
    expect((await repository.get("room-a"))?.playback.status).toBe("playing");
  });

  it.each([
    ["play", "playing"],
    ["pause", "paused"],
  ] as const)(
    "ignores an unchanged %s command without showing an invalid-command error",
    async (type, status) => {
      const room = makeRoom();
      room.playback.status = status;
      const { repository, events, service } = harness(room);

      const result = await service.execute(
        contextFor("room-a", "p0"),
        envelope("room-a", { type, payload: { position: 5 } }),
      );

      expect(result).toMatchObject({ status: "ignored", code: "NO_CHANGE" });
      expect((await repository.get("room-a"))?.sequence).toBe(1);
      expect(events).toEqual([]);
    },
  );

  it("acknowledges a committed mutation when remote publication is unavailable", async () => {
    const repository = new InMemoryRoomRepository([makeRoom()], () => 10_000);
    const localEvents: RoomEvent[] = [];
    const eventBus = new RoomEventBus(
      (_roomId, event) => localEvents.push(event),
      { publish: vi.fn().mockRejectedValue(new Error("redis offline")) },
    );
    const onPostCommitError = vi.fn();
    const resilientService = new RoomCommandService({
      repository,
      eventBus,
      onPostCommitError,
    });

    const result = await resilientService.execute(
      contextFor("room-a", "p0"),
      envelope("room-a", { type: "seek", payload: { position: 22 } }),
    );

    expect(result).toMatchObject({ status: "applied", roomSequence: 2 });
    expect(localEvents).toHaveLength(1);
    expect((await repository.get("room-a"))?.playback.basePosition).toBe(22);
    expect(onPostCommitError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "redis offline" }),
      "publication",
    );
  });

  it("rejects a 501st queue item with a stable code", async () => {
    const room = makeRoom();
    room.playlist = Array.from({ length: 500 }, (_, index) => ({
      id: `00000000-0000-4000-8000-${index.toString().padStart(12, "0")}`,
      url: `https://example.com/${index}`,
      provider: "direct",
      title: `Item ${index}`,
      duration: 0,
      addedBy: "Owner",
    }));
    const { repository, events, service } = harness(room);

    const result = await service.execute(
      contextFor("room-a", "p1"),
      envelope("room-a", {
        type: "add_item",
        payload: { url: "https://example.com/overflow" },
      }),
    );

    expect(result).toMatchObject({
      status: "rejected",
      code: "QUEUE_FULL",
    });
    expect((await repository.get("room-a"))?.playlist).toHaveLength(500);
    expect(events).toEqual([]);
  });

  it("rejects a duplicate queue URL as invalid", async () => {
    const { repository, service } = harness();

    const result = await service.execute(
      contextFor("room-a", "p1"),
      envelope("room-a", {
        type: "add_item",
        payload: { url: "https://www.youtube.com/watch?v=one" },
      }),
    );

    expect(result).toMatchObject({
      status: "rejected",
      code: "INVALID_COMMAND",
    });
    expect((await repository.get("room-a"))?.playlist).toHaveLength(2);
  });

  it("uses server time and keeps only the newest 200 chat messages", async () => {
    const room = makeRoom();
    room.chat = Array.from({ length: 200 }, (_, index) => ({
      id: `message-${index}`,
      participantId: "p0",
      nickname: "Owner",
      message: `old-${index}`,
      sentAt: index,
    }));
    const { repository, service } = harness(room);

    const result = await service.execute(
      contextFor("room-a", "p1"),
      envelope("room-a", {
        type: "send_chat",
        payload: { message: "newest" },
      }),
    );

    expect(result.status).toBe("applied");
    const stored = await repository.get("room-a");
    expect(stored?.chat).toHaveLength(200);
    expect(stored?.chat[0].message).toBe("old-1");
    expect(stored?.chat.at(-1)).toMatchObject({
      participantId: "p1",
      message: "newest",
      sentAt: 10_000,
    });
  });

  it.each(["   ", "x".repeat(501)])(
    "rejects empty or oversized chat without publishing it",
    async (message) => {
      const { repository, events, service } = harness();

      const result = await service.execute(
        contextFor("room-a", "p1"),
        envelope("room-a", {
          type: "send_chat",
          payload: { message },
        }),
      );

      expect(result).toMatchObject({
        status: "rejected",
        code: "INVALID_COMMAND",
      });
      expect((await repository.get("room-a"))?.chat).toEqual([]);
      expect(events).toEqual([]);
    },
  );

  it("serializes 25 participants' concurrent slow commands without dropping additions", async () => {
    const room = makeRoom();
    room.playlist = [];
    room.currentMediaId = null;
    for (let index = 2; index < 25; index++) {
      room.participants[`p${index}`] = {
        ...room.participants.p1,
        id: `p${index}`,
        nickname: `Friend ${index}`,
        connectionIds: [`socket-p${index}`],
      };
    }
    const { repository, service } = harness(room);

    const results = await Promise.all(
      Array.from({ length: 25 }, (_, index) =>
        service.execute(
          contextFor("room-a", `p${index}`),
          envelope("room-a", {
            type: "add_item",
            payload: { url: `https://example.com/${index}` },
          }),
        ),
      ),
    );

    expect(results.every((result) => result.status === "applied")).toBe(true);
    const stored = await repository.get("room-a");
    expect(stored?.playlist).toHaveLength(25);
    expect(new Set(stored?.playlist.map((item) => item.url)).size).toBe(25);
  });

  it("rechecks in-memory playback permission after a CAS conflict", async () => {
    class PermissionChangingRepository extends InMemoryRoomRepository {
      private shouldConflict = true;

      override async compareAndSet(
        roomId: string,
        expectedVersion: number,
        next: RoomState,
      ) {
        if (this.shouldConflict) {
          this.shouldConflict = false;
          const competing = await this.get(roomId);
          if (!competing) return false;
          competing.leaderId = "p0";
          competing.version = expectedVersion + 1;
          competing.sequence += 1;
          await super.compareAndSet(roomId, expectedVersion, competing);
          return false;
        }
        return super.compareAndSet(roomId, expectedVersion, next);
      }
    }
    const repository = new PermissionChangingRepository(
      [makeRoom()],
      () => 10_000,
    );
    const service = new RoomCommandService({
      repository,
      eventBus: new RoomEventBus(() => {}),
    });

    const result = await service.execute(
      contextFor("room-a", "p1"),
      envelope("room-a", { type: "play", payload: { position: 12 } }),
    );

    expect(result).toMatchObject({ status: "rejected", code: "NOT_PERMITTED" });
    expect((await repository.get("room-a"))?.playback.status).toBe("paused");
  });
});

describe("Socket command acknowledgement adapter", () => {
  it("correlates one acknowledgement and one compact event to the envelope nonce", async () => {
    const repository = new InMemoryRoomRepository([makeRoom()], () => 10_000);
    const roomEmit = vi.fn();
    const io = {
      to: vi.fn(() => ({
        emit: roomEmit,
        except: vi.fn(() => ({ emit: roomEmit })),
      })),
    } as unknown as Server;
    const eventBus = new RoomEventBus((roomId, event) => {
      if (event.type === "playback_updated") {
        io.to(roomId).emit("playback_updated", {
          playback: event.playback,
          serverTime: event.serverTime,
        });
      }
    });
    const service = new RoomCommandService({ repository, eventBus });
    const handlers = new Map<string, (...args: any[]) => unknown>();
    const socketEmit = vi.fn();
    const socket = {
      id: "socket-p0",
      data: { participantId: "p0" },
      handshake: { address: "127.0.0.1", headers: {} },
      on: vi.fn((event: string, handler: (...args: any[]) => unknown) => {
        handlers.set(event, handler);
      }),
      emit: socketEmit,
    } as unknown as Socket;
    const nonce = randomUUID();
    const callback = vi.fn();

    handleCommandEvents(
      io,
      socket,
      null,
      { currentRoomId: "room-a", currentParticipantId: "p0" },
      service,
    );
    await handlers.get("command")?.(
      envelope("room-a", { type: "play", payload: { position: 12 } }, nonce),
      callback,
    );

    const expectedAck = {
      nonce,
      status: "applied",
      roomSequence: 2,
    };
    expect(callback).toHaveBeenCalledOnce();
    expect(callback).toHaveBeenCalledWith(expectedAck);
    expect(socketEmit).toHaveBeenCalledWith("command_ack", expectedAck);
    expect(roomEmit.mock.calls.map(([event]) => event)).toEqual([
      "playback_updated",
    ]);
  });
});
