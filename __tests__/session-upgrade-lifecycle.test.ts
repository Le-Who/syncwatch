/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { SignJWT } from "jose";
import type { Server, Socket } from "socket.io";
import { handleCommandEvents } from "../lib/socket/commands";
import { handleConnectionEvents } from "../lib/socket/connection";
import type { SocketContext } from "../lib/socket/context";
import { createEmptyRoom } from "../lib/room-handler";
import { PARTICIPANT_GRACE_MS } from "../lib/participant-lifecycle";
import { getRedisRoom, setRedisRoomCAS } from "../lib/redis-actor";
import { persistRoomState } from "../lib/db-sync";
import type { RoomCommandService } from "../lib/room-command-service";
import type { RoomEventBus } from "../lib/room-event-bus";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("../lib/redis-actor", () => ({
  getRedisRoom: vi.fn(),
  setRedisRoomCAS: vi.fn(),
}));
vi.mock("../lib/redis-rate-limit", () => ({
  checkRedisRateLimit: vi.fn().mockResolvedValue(true),
  getRedisClient: vi.fn(),
}));
vi.mock("../lib/db-sync", () => ({
  isSystemDegraded: vi.fn().mockResolvedValue(false),
  persistRoomState: vi.fn(),
  loadRoomFromDB: vi.fn(),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("session upgrade command lifecycle", () => {
  let handlers: Record<string, (...args: unknown[]) => Promise<void>>;
  let socket: Socket;
  let context: SocketContext;
  let stored: ReturnType<typeof createEmptyRoom>;
  let supabase: SupabaseClient;
  let publish: ReturnType<typeof vi.fn>;

  const tokenFor = (participantId: string) =>
    new SignJWT({ participantId, nickname: "Account" })
      .setProtectedHeader({ alg: "HS256" })
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode("default_local_secret_dont_use_in_prod"));
  const commandFor = async (participantId = "account") => ({
    roomId: "upgrade-room",
    nonce: randomUUID(),
    clientSequence: 0,
    command: {
      type: "upgrade_session",
      payload: { token: await tokenFor(participantId) },
    },
  });

  beforeEach(() => {
    vi.clearAllMocks();
    handlers = {};
    context = {
      currentRoomId: "upgrade-room",
      currentParticipantId: "fallback",
    };
    socket = {
      id: "upgrade-socket",
      data: { participantId: "fallback" },
      emit: vi.fn(),
      on: vi.fn((event, handler) => {
        handlers[event] = handler;
      }),
      handshake: { headers: {}, address: "127.0.0.1" },
      join: vi.fn(),
    } as unknown as Socket;
    stored = createEmptyRoom("upgrade-room", "Upgrade");
    stored.participants.fallback = {
      id: "fallback",
      nickname: "Guest",
      role: "owner",
      joinedAt: 1,
      lastSeen: 1,
      connection: "connected",
      connectionIds: [socket.id],
      playbackHealth: "idle",
      readyMediaId: null,
    };
    stored.leaderId = "fallback";
    vi.mocked(getRedisRoom).mockImplementation(async () =>
      structuredClone(stored),
    );
    vi.mocked(setRedisRoomCAS).mockImplementation(
      async (_id, next, version) => {
        if (stored.version !== version) return false;
        stored = structuredClone(next);
        return true;
      },
    );
    publish = vi.fn().mockResolvedValue(undefined);
    const eventBus = { publish } as unknown as RoomEventBus;
    const io = {
      to: vi.fn().mockReturnValue({ emit: vi.fn() }),
    } as unknown as Server;
    supabase = {} as SupabaseClient;
    handleConnectionEvents(io, socket, supabase, context, eventBus);
    handleCommandEvents(
      io,
      socket,
      supabase,
      context,
      {} as RoomCommandService,
      eventBus,
    );
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("ignores a non-function acknowledgement argument without rejecting the handler", async () => {
    socket.data.participantId = undefined;
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      handlers.command({}, { malicious: true }),
    ).resolves.toBeUndefined();
    expect(socket.emit).toHaveBeenCalledWith(
      "command_ack",
      expect.objectContaining({ code: "NOT_JOINED" }),
    );
    expect(console.error).not.toHaveBeenCalled();
  });

  it("schedules the committed identity and role transfer for durable persistence", async () => {
    await handlers.command(await commandFor());
    expect(persistRoomState).toHaveBeenCalledExactlyOnceWith(stored, supabase);
    expect(stored.participants.account.role).toBe("owner");
    expect(stored.leaderId).toBe("account");
    expect(context.currentParticipantId).toBe("account");
  });

  it("does not write an upgrade when disconnect happens during its room read", async () => {
    vi.useFakeTimers();
    const read = deferred<ReturnType<typeof createEmptyRoom>>();
    const reading = deferred<void>();
    vi.mocked(getRedisRoom).mockImplementationOnce(() => {
      reading.resolve();
      return read.promise;
    });
    const pending = handlers.command(await commandFor());
    await reading.promise;
    await handlers.disconnect();
    const writesAfterDisconnect = vi.mocked(setRedisRoomCAS).mock.calls.length;
    read.resolve(structuredClone(stored));
    await pending;
    expect(setRedisRoomCAS).toHaveBeenCalledTimes(writesAfterDisconnect);
    expect(socket.emit).not.toHaveBeenCalledWith(
      "session_upgraded",
      expect.anything(),
    );
    expect(context.currentParticipantId).toBe("fallback");
  });

  it("does not apply a stale room read after the socket context changes", async () => {
    const read = deferred<ReturnType<typeof createEmptyRoom>>();
    const reading = deferred<void>();
    vi.mocked(getRedisRoom).mockImplementationOnce(() => {
      reading.resolve();
      return read.promise;
    });
    const pending = handlers.command(await commandFor());
    await reading.promise;
    context.currentParticipantId = "newer-identity";
    socket.data.participantId = "newer-identity";
    read.resolve(structuredClone(stored));
    await pending;
    expect(setRedisRoomCAS).not.toHaveBeenCalled();
    expect(context.currentParticipantId).toBe("newer-identity");
    expect(socket.emit).not.toHaveBeenCalledWith(
      "session_upgraded",
      expect.anything(),
    );
  });

  it("cleans a winning upgrade CAS after disconnect and removes the identity after grace", async () => {
    vi.useFakeTimers();
    const committed = deferred<void>();
    const result = deferred<boolean>();
    vi.mocked(setRedisRoomCAS).mockImplementationOnce(async (_id, next) => {
      stored = structuredClone(next);
      committed.resolve();
      return result.promise;
    });
    const pending = handlers.command(await commandFor());
    await committed.promise;
    await handlers.disconnect();
    result.resolve(true);
    await pending;
    expect(stored.participants.account.connection).toBe("reconnecting");
    expect(stored.participants.account.connectionIds).toEqual([]);
    expect(socket.emit).not.toHaveBeenCalledWith(
      "session_upgraded",
      expect.anything(),
    );
    expect(context.currentParticipantId).toBe("fallback");
    await vi.advanceTimersByTimeAsync(PARTICIPANT_GRACE_MS + 1);
    expect(stored.participants.account).toBeUndefined();
  });

  it("preserves other sockets on an upgraded identity when this socket disconnects during CAS", async () => {
    vi.useFakeTimers();
    stored.participants.account = {
      ...stored.participants.fallback,
      id: "account",
      role: "viewer",
      connectionIds: ["other-account-socket"],
    };
    const committed = deferred<void>();
    const result = deferred<boolean>();
    vi.mocked(setRedisRoomCAS).mockImplementationOnce(async (_id, next) => {
      stored = structuredClone(next);
      committed.resolve();
      return result.promise;
    });
    const pending = handlers.command(await commandFor());
    await committed.promise;
    await handlers.disconnect();
    result.resolve(true);
    await pending;
    expect(stored.participants.account.connection).toBe("connected");
    expect(stored.participants.account.connectionIds).toEqual([
      "other-account-socket",
    ]);
    expect(socket.emit).not.toHaveBeenCalledWith(
      "session_upgraded",
      expect.anything(),
    );
    await vi.advanceTimersByTimeAsync(PARTICIPANT_GRACE_MS + 1);
    expect(stored.participants.account).toBeDefined();
  });

  it("cleans a committed upgrade without overwriting a newer socket context", async () => {
    vi.useFakeTimers();
    const committed = deferred<void>();
    const result = deferred<boolean>();
    vi.mocked(setRedisRoomCAS).mockImplementationOnce(async (_id, next) => {
      stored = structuredClone(next);
      committed.resolve();
      return result.promise;
    });
    const pending = handlers.command(await commandFor());
    await committed.promise;
    context.currentRoomId = "new-room";
    context.currentParticipantId = "newer-identity";
    socket.data.participantId = "newer-identity";
    result.resolve(true);
    await pending;
    expect(context.currentRoomId).toBe("new-room");
    expect(context.currentParticipantId).toBe("newer-identity");
    expect(socket.data.participantId).toBe("newer-identity");
    expect(stored.participants.account.connection).toBe("reconnecting");
    expect(socket.emit).not.toHaveBeenCalledWith(
      "session_upgraded",
      expect.anything(),
    );
  });

  it("rejects overlapping upgrades on one socket until the active upgrade completes", async () => {
    const committed = deferred<void>();
    const result = deferred<boolean>();
    vi.mocked(setRedisRoomCAS).mockImplementationOnce(async (_id, next) => {
      stored = structuredClone(next);
      committed.resolve();
      return result.promise;
    });
    const pending = handlers.command(await commandFor());
    await committed.promise;
    const secondAck = vi.fn();
    await handlers.command(await commandFor("second-account"), secondAck);
    result.resolve(true);
    await pending;
    expect(secondAck).toHaveBeenCalledWith(
      expect.objectContaining({ code: "CONTENTION" }),
    );
    expect(context.currentParticipantId).toBe("account");
    expect(setRedisRoomCAS).toHaveBeenCalledTimes(1);
  });

  it("rejects a room rejoin while an upgrade commit is pending", async () => {
    const committed = deferred<void>();
    const result = deferred<boolean>();
    vi.mocked(setRedisRoomCAS).mockImplementationOnce(async (_id, next) => {
      stored = structuredClone(next);
      committed.resolve();
      return result.promise;
    });
    const pending = handlers.command(await commandFor());
    await committed.promise;
    await handlers.join_room({ roomId: "upgrade-room", nickname: "Guest" });
    result.resolve(true);
    await pending;
    expect(setRedisRoomCAS).toHaveBeenCalledTimes(1);
    expect(stored.participants.fallback).toBeUndefined();
    expect(socket.emit).toHaveBeenCalledWith("error", {
      message: expect.stringMatching(/upgrade.*progress.*try/i),
    });
  });

  it("rejects an upgrade while a room join is pending so the client can retry", async () => {
    const read = deferred<ReturnType<typeof createEmptyRoom>>();
    const reading = deferred<void>();
    vi.mocked(getRedisRoom).mockImplementationOnce(() => {
      reading.resolve();
      return read.promise;
    });
    const joining = handlers.join_room({
      roomId: "upgrade-room",
      nickname: "Guest",
    });
    await reading.promise;
    const ack = vi.fn();
    await handlers.command(await commandFor(), ack);
    read.resolve(structuredClone(stored));
    await joining;
    expect(ack).toHaveBeenCalledWith(
      expect.objectContaining({ code: "CONTENTION" }),
    );
    expect(context.currentParticipantId).toBe("fallback");
    expect(stored.participants.account).toBeUndefined();
  });
});
