import { beforeAll, afterAll, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useStore } from "../lib/store";
import { roomSocketService } from "../lib/socket";
import { loadRoomFromDB } from "../lib/db-sync";
import { roomWithParticipants } from "./helpers/room-fixtures";

const transport = vi.hoisted(() => {
  const handlers = new Map<string, Array<(payload?: any) => void>>();
  const socket = {
    connected: true,
    emit: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
    on(event: string, callback: (payload?: any) => void) {
      handlers.set(event, [...(handlers.get(event) ?? []), callback]);
    },
    off(event: string, callback: (payload?: any) => void) {
      handlers.set(
        event,
        (handlers.get(event) ?? []).filter((fn) => fn !== callback),
      );
    },
    receive(event: string, payload?: any) {
      for (const fn of handlers.get(event) ?? []) fn(payload);
    },
  };
  return socket;
});
vi.mock("socket.io-client", () => ({ io: () => transport }));
beforeAll(() => useStore.getState().init());
afterAll(() => roomSocketService.disconnect());

it("recovers seq100 from a correlated lower hydrated lifetime and retires old frames/requests", async () => {
  const old = {
    ...roomWithParticipants(3),
    generation: "old-cache",
    sequence: 100,
    version: 100,
  };
  useStore.setState({
    room: old,
    fullRoomSequence: 100,
    commandSequence: 100,
    canonicalDeliveryVersion: 9,
    isConnected: true,
    participantId: "p0",
    sessionToken: "friend-token",
  });
  roomSocketService.connect(old.id, "p0", "p0", "friend-token");
  const oldRequest = transport.emit.mock.calls.find(
    ([event]) => event === "join_room",
  )![1];
  transport.receive("disconnect");
  transport.receive("connect");
  const request = transport.emit.mock.calls
    .filter(([event]) => event === "join_room")
    .at(-1)![1];
  // The migration-backed suite separately verifies this exact state column.
  const durable = {
    name: "Restored",
    version: 12,
    sequence: 12,
    mediaRun: 0,
    playlist: [],
    settings: old.settings,
    playback: { ...old.playback, mediaItemId: null },
  };
  const db = {
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({ data: { state: durable }, error: null }),
        }),
      }),
    }),
  } as unknown as SupabaseClient;
  const restored = (await loadRoomFromDB(old.id, db))!;
  expect(restored).not.toBeNull();
  transport.receive("room_state", {
    room: restored,
    serverTime: Date.now(),
    snapshotRequestId: request.snapshotRequestId,
  });
  expect(useStore.getState().room).toMatchObject({
    name: "Restored",
    sequence: 12,
  });
  expect(useStore.getState().commandSequence).toBe(12);
  expect(useStore.getState().canonicalDeliveryVersion).toBeGreaterThan(
    useStore.getState().connectionDeliveryFloor,
  );
  expect(useStore.getState().participantId).toBe("p0");
  expect(useStore.getState().sessionToken).toBe("friend-token");
  const stable = useStore.getState().room;
  transport.receive("room_state", {
    room: { ...old, sequence: 101 },
    serverTime: Date.now(),
    snapshotRequestId: oldRequest.snapshotRequestId,
  });
  transport.receive("playback_updated", {
    playback: {
      ...old.playback,
      mediaItemId: null,
      mediaRun: 0,
      generation: "old-cache",
      sequence: 102,
      basePosition: 999,
    },
    serverTime: Date.now(),
  });
  expect(useStore.getState().room).toEqual(stable);
  // Replayed consumed responses cannot reauthorize a retired generation.
  transport.receive("room_state", {
    room: old,
    serverTime: Date.now(),
    snapshotRequestId: request.snapshotRequestId,
  });
  expect(useStore.getState().room).toEqual(stable);
});

it("binds snapshot recovery to the requested room as well as the current request", () => {
  const room = useStore.getState().room!;
  roomSocketService.requestRoomState(room.id);
  const request = transport.emit.mock.calls.at(-1)![1];
  transport.receive("room_state", {
    room: { ...room, id: "another-room", generation: "other", sequence: 1000 },
    snapshotRequestId: request.snapshotRequestId,
    serverTime: Date.now(),
  });
  expect(useStore.getState().room?.id).toBe(room.id);
});
