/** @vitest-environment node */
import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { POST } from "../app/api/auth/session/route";
import { handleConnectionEvents } from "../lib/socket/connection";
import { RoomEventBus } from "../lib/room-event-bus";
import { getRedisRoom } from "../lib/redis-actor";
import { checkRedisRateLimit } from "../lib/redis-rate-limit";
import type { Server, Socket } from "socket.io";
import type { SocketContext } from "../lib/socket/context";

function request(ip: string, cookie = "") {
  return new Request("http://localhost/api/auth/session", {
    method: "POST",
    headers: { "x-syncwatch-client-ip": ip, cookie },
  });
}
describe("same NAT admission with the real local limiter", () => {
  it("expires hydrated absent owners after grace without promoting the first viewer early", async () => {
    vi.useFakeTimers();
    try {
      const roomId = `hydrated-${randomUUID()}`;
      const handlers = new Map<string, (payload: any) => Promise<void>>();
      const socket = {
        id: randomUUID(),
        data: { participantId: "viewer" },
        handshake: { headers: {}, address: randomUUID() },
        on: (name: string, fn: any) => handlers.set(name, fn),
        emit: () => {},
        join: () => {},
      } as unknown as Socket;
      const db = {
        from: () => ({
          select: () => ({
            eq: () => ({
              single: async () => ({
                data: {
                  state: {
                    name: "Hydrated",
                    participantRoles: [
                      { id: "owner", role: "owner", joinedAt: 0 },
                    ],
                    playlist: [],
                    version: 1,
                    sequence: 1,
                  },
                },
              }),
            }),
          }),
        }),
      };
      handleConnectionEvents(
        {} as Server,
        socket,
        db as any,
        { currentRoomId: null, currentParticipantId: null },
        new RoomEventBus(() => {}),
      );
      await handlers.get("join_room")!({ roomId, nickname: "Viewer" });
      expect((await getRedisRoom(roomId))!.participants.viewer.role).toBe(
        "viewer",
      );
      await vi.advanceTimersByTimeAsync(15001);
      const room = (await getRedisRoom(roomId))!;
      expect(room.participants.owner).toBeUndefined();
      expect(room.participants.viewer.role).toBe("owner");
    } finally {
      vi.useRealTimers();
    }
  });
  it("admits 25 signed sessions and repeated group reconnects while isolating noisy identities", async () => {
    const ip = randomUUID();
    const roomId = `nat-${randomUUID()}`;
    const friends = [];
    for (let i = 0; i < 25; i++) {
      const response = await POST(request(ip));
      expect(response.status).toBe(200);
      const session = await response.json();
      const cookie = `syncwatch_session=${session.token}`;
      const reused = await POST(request(ip, cookie));
      expect(await reused.json()).toMatchObject(session);
      const handlers = new Map<string, (...args: any[]) => Promise<void>>();
      const errors: unknown[] = [];
      const context = {
        currentRoomId: null,
        currentParticipantId: null,
      } as SocketContext;
      const socket = {
        id: randomUUID(),
        data: { participantId: session.participantId },
        handshake: { headers: {}, address: ip },
        on: (event: string, fn: any) => handlers.set(event, fn),
        emit: (event: string, data: unknown) => {
          if (event === "error") errors.push(data);
        },
        join: () => {},
      } as unknown as Socket;
      handleConnectionEvents(
        {} as Server,
        socket,
        null,
        context,
        new RoomEventBus(() => {}),
      );
      friends.push({ session, handlers, errors, context });
    }
    for (let cycle = 0; cycle < 4; cycle++)
      for (const friend of friends)
        await friend.handlers.get("join_room")!({ roomId, nickname: "Friend" });
    expect(friends.flatMap((f) => f.errors)).toEqual([]);
    expect(
      Object.keys((await getRedisRoom(roomId))!.participants),
    ).toHaveLength(25);
    for (let i = 0; i < 50; i++)
      await friends[0].handlers.get("join_room")!({
        roomId,
        nickname: "Noisy",
      });
    expect(friends[0].errors.length).toBeGreaterThan(0);
    for (const friend of friends.slice(1))
      await friend.handlers.get("join_room")!({ roomId, nickname: "Friend" });
    expect(friends.slice(1).flatMap((f) => f.errors)).toEqual([]);
  });
  it("bounds new identity creation but reuses a valid cookie after the budget is exhausted", async () => {
    const ip = randomUUID();
    const first = await POST(request(ip));
    const session = await first.json();
    for (let i = 1; i < 1000; i++)
      expect(await checkRedisRateLimit(`api:auth:${ip}`, 1000, 60000)).toBe(
        true,
      );
    const blocked = await POST(request(ip));
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(
      (await POST(request(ip, `syncwatch_session=${session.token}`))).status,
    ).toBe(200);
  });
  it("retains the 1000-join coarse same-address abuse ceiling", async () => {
    const ip = randomUUID();
    for (let n = 0; n < 1000; n++)
      expect(await checkRedisRateLimit(`ws:join:${ip}`, 1000, 60000)).toBe(
        true,
      );
    const handlers = new Map<string, (payload: any) => Promise<void>>();
    const errors: any[] = [];
    const socket = {
      id: randomUUID(),
      data: { participantId: randomUUID() },
      handshake: { headers: {}, address: ip },
      on: (event: string, fn: any) => handlers.set(event, fn),
      emit: (event: string, value: any) => {
        if (event === "error") errors.push(value);
      },
      join: () => {},
    } as unknown as Socket;
    handleConnectionEvents(
      {} as Server,
      socket,
      null,
      { currentRoomId: null, currentParticipantId: null },
      new RoomEventBus(() => {}),
    );
    await handlers.get("join_room")!({
      roomId: randomUUID(),
      nickname: "Fresh identity",
    });
    expect(errors).toEqual([{ message: "Too many join requests" }]);
  });
});
