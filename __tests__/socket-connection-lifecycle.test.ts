/** @vitest-environment node */
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Server, Socket } from "socket.io";
import { handleConnectionEvents } from "../lib/socket/connection";
import { InMemoryRoomRepository } from "../lib/room-repository";
import { RoomCommandService } from "../lib/room-command-service";
import { RoomEventBus } from "../lib/room-event-bus";
import { createEmptyRoom } from "../lib/room-handler";
import { PARTICIPANT_GRACE_MS } from "../lib/participant-lifecycle";
import type { RoomEvent } from "../lib/room-events";
import type { RoomState } from "../lib/types";
import type { SocketContext } from "../lib/socket/context";

vi.mock("../lib/redis-rate-limit", () => ({
  checkRedisRateLimit: async () => true,
  getRedisClient: () => null,
}));

// Adapt the external Redis boundary to the same real repository used by commands.
vi.mock("../lib/redis-actor", () => ({
  getRedisRoom: (roomId: string) => repository.get(roomId),
  setRedisRoomCAS: async (roomId: string, next: RoomState, version: number) => {
    const committed = await repository.compareAndSet(roomId, version, next);
    const pause = pauseCommit;
    pauseCommit = undefined;
    if (pause) {
      pause.entered.resolve();
      await pause.resume.promise;
    }
    return committed;
  },
  pubClient: () => null,
}));

vi.mock("../lib/db-sync", () => ({
  isSystemDegraded: async () => false,
  loadRoomFromDB: (...args: unknown[]) => loadRoom(...args),
  persistRoomState: () => {},
}));

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}

let repository: InMemoryRoomRepository;
let loadRoom: (...args: unknown[]) => Promise<RoomState | null>;
let pauseCommit:
  | {
      entered: ReturnType<typeof deferred<void>>;
      resume: ReturnType<typeof deferred<void>>;
    }
  | undefined;
let events: Array<{ roomId: string; event: RoomEvent }>;
let eventBus: RoomEventBus;

function connectSocket(participantId: string) {
  const handlers = new Map<string, (...args: any[]) => any>();
  const messages: Array<{ event: string; payload: any }> = [];
  const rooms = new Set<string>();
  const context: SocketContext = {
    currentRoomId: null,
    currentParticipantId: null,
  };
  const socket = {
    id: randomUUID(),
    connected: true,
    data: { participantId },
    handshake: { headers: {}, address: randomUUID() },
    on: (event: string, callback: (...args: any[]) => any) => {
      handlers.set(event, callback);
    },
    emit: (event: string, payload: any) => messages.push({ event, payload }),
    join: (roomId: string) => rooms.add(roomId),
    to: () => ({ emit: () => {} }),
  };
  handleConnectionEvents(
    {} as Server,
    socket as unknown as Socket,
    null,
    context,
    eventBus,
  );
  return {
    socket,
    context,
    messages,
    rooms,
    join: (roomId: string) =>
      handlers.get("join_room")!({ roomId, nickname: participantId }),
    disconnect: () => {
      socket.connected = false;
      rooms.clear();
      handlers.get("disconnect")!();
    },
  };
}

describe("socket joins interrupted by disconnect", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    repository = new InMemoryRoomRepository();
    loadRoom = async () => null;
    pauseCommit = undefined;
    events = [];
    eventBus = new RoomEventBus((roomId, event) =>
      events.push({ roomId, event }),
    );
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("does not register a departed socket when room hydration finishes later", async () => {
    const hydration = deferred<RoomState | null>();
    const entered = deferred();
    loadRoom = async () => {
      entered.resolve();
      return hydration.promise;
    };
    const client = connectSocket("departed-owner");
    const joining = client.join("hydrating-room");
    await entered.promise;

    client.disconnect();
    hydration.resolve(null);
    await joining;
    await vi.advanceTimersByTimeAsync(PARTICIPANT_GRACE_MS + 1);

    expect(
      (await repository.get("hydrating-room"))?.participants ?? {},
    ).toEqual({});
    expect(client.context.currentRoomId).toBeNull();
    expect(client.rooms.size).toBe(0);
    expect(events).toEqual([]);
  });

  it("starts grace after a join commits but its CAS response arrives after disconnect", async () => {
    const room = createEmptyRoom("committing-room", "Room");
    repository = new InMemoryRoomRepository([room]);
    pauseCommit = { entered: deferred(), resume: deferred() };
    const pause = pauseCommit;
    const client = connectSocket("departed-owner");
    const joining = client.join(room.id);
    await pause.entered.promise;

    client.disconnect();
    pause.resume.resolve();
    await joining;
    await vi.advanceTimersByTimeAsync(0);

    expect(
      (await repository.get(room.id))?.participants["departed-owner"],
    ).toMatchObject({
      connection: "reconnecting",
      connectionIds: [],
    });
    expect(client.rooms.size).toBe(0);
    expect(client.messages.some(({ event }) => event === "room_state")).toBe(
      false,
    );
    expect(events.map(({ event }) => event.type)).toEqual([
      "participant_disconnected",
    ]);

    await vi.advanceTimersByTimeAsync(PARTICIPANT_GRACE_MS + 1);
    expect((await repository.get(room.id))?.participants).toEqual({});
    expect(events.map(({ event }) => event.type)).toEqual([
      "participant_disconnected",
      "participant_left",
    ]);
  });

  it("removes only the interrupted tab while the shared identity keeps room access", async () => {
    const room = createEmptyRoom("shared-room", "Shared");
    const unrelated = createEmptyRoom("other-room", "Other");
    repository = new InMemoryRoomRepository([room, unrelated]);
    const live = connectSocket("shared-owner");
    await live.join(room.id);
    events.length = 0;

    pauseCommit = { entered: deferred(), resume: deferred() };
    const pause = pauseCommit;
    const departed = connectSocket("shared-owner");
    const joining = departed.join(room.id);
    await pause.entered.promise;
    departed.disconnect();
    pause.resume.resolve();
    await joining;
    await vi.advanceTimersByTimeAsync(PARTICIPANT_GRACE_MS + 1);

    expect(
      (await repository.get(room.id))?.participants["shared-owner"],
    ).toMatchObject({
      role: "owner",
      connection: "connected",
      connectionIds: [live.socket.id],
    });
    expect(events).toEqual([]);
    expect(await repository.get(unrelated.id)).toEqual(unrelated);

    const service = new RoomCommandService({ repository, eventBus });
    expect(
      await service.execute(live.context, {
        roomId: room.id,
        nonce: randomUUID(),
        clientSequence: 2,
        command: {
          type: "update_nickname",
          payload: { nickname: "Still here" },
        },
      }),
    ).toMatchObject({ status: "applied" });
    expect(
      (await repository.get(room.id))?.participants["shared-owner"].nickname,
    ).toBe("Still here");
  });

  it("cleans up a disconnect during expired-departure publication and still tells peers the repaired owner", async () => {
    const room = createEmptyRoom("expired-room", "Expired");
    room.participants = {
      "expired-owner": {
        id: "expired-owner",
        nickname: "Expired",
        role: "owner",
        joinedAt: 1,
        lastSeen: Date.now() - PARTICIPANT_GRACE_MS - 1,
        connection: "reconnecting",
        connectionIds: [],
        playbackHealth: "idle",
        readyMediaId: null,
      },
      viewer: {
        id: "viewer",
        nickname: "Viewer",
        role: "viewer",
        joinedAt: 2,
        lastSeen: Date.now(),
        connection: "connected",
        connectionIds: ["viewer-socket"],
        playbackHealth: "ready",
        readyMediaId: null,
      },
    };
    repository = new InMemoryRoomRepository([room]);
    const publication = { entered: deferred(), resume: deferred() };
    eventBus = new RoomEventBus(
      (roomId, event) => events.push({ roomId, event }),
      {
        publish: async (_channel, message) => {
          if (JSON.parse(message).event.type === "participant_left") {
            publication.entered.resolve();
            await publication.resume.promise;
          }
        },
      },
    );
    const client = connectSocket("expired-owner");
    const joining = client.join(room.id);
    await publication.entered.promise;

    client.disconnect();
    publication.resume.resolve();
    await joining;
    await vi.advanceTimersByTimeAsync(0);

    expect(
      (await repository.get(room.id))?.participants["expired-owner"],
    ).toMatchObject({
      role: "viewer",
      connection: "reconnecting",
      connectionIds: [],
    });
    expect(client.rooms.size).toBe(0);
    expect(client.messages.some(({ event }) => event === "room_state")).toBe(
      false,
    );
    expect(
      events.some(({ event }) => event.type === "participant_joined"),
    ).toBe(false);
    const repair = events.find(
      ({ event }) => event.type === "room_state",
    )?.event;
    expect(
      repair?.type === "room_state" && repair.room.participants.viewer.role,
    ).toBe("owner");

    await vi.advanceTimersByTimeAsync(PARTICIPANT_GRACE_MS + 1);
    expect(
      (await repository.get(room.id))?.participants["expired-owner"],
    ).toBeUndefined();
    expect((await repository.get(room.id))?.participants.viewer).toMatchObject({
      role: "owner",
      connection: "connected",
      connectionIds: ["viewer-socket"],
    });
  });
});
