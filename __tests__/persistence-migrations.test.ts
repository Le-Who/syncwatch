/** @vitest-environment node */
import { readFile, readdir } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { uuid_ossp } from "@electric-sql/pglite/contrib/uuid_ossp";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  persistRoomState,
  flushDbSyncQueue,
  loadRoomFromDB,
} from "../lib/db-sync";
import { setRedisRoom } from "../lib/redis-actor";
import { roomWithParticipants } from "./helpers/room-fixtures";
import {
  joinParticipant,
  removeParticipantAfterGrace,
  PARTICIPANT_GRACE_MS,
} from "../lib/participant-lifecycle";

const legacyId = "10000000-0000-4000-8000-000000000001";
const roomId = "10000000-0000-4000-8000-000000000002";
const a = "20000000-0000-4000-8000-000000000001";
const b = "20000000-0000-4000-8000-000000000002";
const owner = "30000000-0000-4000-8000-000000000001";
let db: PGlite;
// Only the transport is adapted: every RPC and selected field runs against
// tables created by the checked-in SQL, never a synthesized state response.
const client = {
  rpc: async (_name: string, args: any) => {
    try {
      await db.query(
        "select public.sync_room_state($1::uuid,$2::uuid,$3::jsonb)",
        [args.p_room_id, args.p_owner_id, JSON.stringify(args.p_state)],
      );
      return { error: null };
    } catch (error) {
      return { error };
    }
  },
  from: () => ({
    select: (columns: string) => ({
      eq: (_column: string, id: string) => ({
        single: async () => {
          try {
            return {
              data: (
                await db.query(
                  `select ${columns} from public.rooms where id=$1::uuid`,
                  [id],
                )
              ).rows[0],
              error: null,
            };
          } catch (error) {
            return { data: null, error };
          }
        },
      }),
    }),
  }),
} as unknown as SupabaseClient;

beforeAll(async () => {
  db = new PGlite({ extensions: { uuid_ossp } });
  await db.exec(
    "create role anon; create role authenticated; create role service_role bypassrls;",
  );
  const files = (await readdir("supabase/migrations"))
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const file of files.filter((f) => f.startsWith("000")))
    await db.exec(await readFile(`supabase/migrations/${file}`, "utf8"));
  await db.query(
    "insert into public.rooms(id,name,settings,owner_id) values($1,'Legacy preserved','{\"autoplayNext\":false,\"looping\":true}', $2)",
    [legacyId, owner],
  );
  await db.query(
    "insert into public.playlist_items(id,room_id,url,provider,title,duration,added_by,position,last_position,thumbnail_url) values($1,$2,'https://example.com/old.mp4','file','Legacy clip',90,'Friend',0,12,'old.jpg')",
    [a, legacyId],
  );
  await db.query(
    "insert into public.playback_snapshots(room_id,media_item_id,status,base_position,base_timestamp,rate,version,updated_by) values($1,$2,'buffering',12,1000,1,7,'Friend')",
    [legacyId, a],
  );
  for (const file of files.filter((f) => !f.startsWith("000")))
    await db.exec(await readFile(`supabase/migrations/${file}`, "utf8"));
}, 30000);
afterAll(async () => {
  await db?.close();
});

describe("migration-backed persistence and server-only RPC", () => {
  it("backfills existing relational data and normalizes legacy playback", async () => {
    expect(await loadRoomFromDB(legacyId, client)).toMatchObject({
      name: "Legacy preserved",
      currentMediaId: a,
      playlist: [
        { id: a, title: "Legacy clip", lastPosition: 12, thumbnail: "old.jpg" },
      ],
      playback: { status: "paused", basePosition: 12 },
      version: 7,
    });
    expect(
      (await loadRoomFromDB(legacyId, client))!.participants,
    ).toMatchObject({ [owner]: { role: "owner", connection: "reconnecting" } });
  });
  it("round-trips the production persist/reload boundary with queue metadata and canonical epochs", async () => {
    const room = roomWithParticipants(3, { moderatorIds: ["p1"] });
    room.id = roomId;
    room.name = "Durable friends";
    room.mediaRun = 17;
    room.sequence = 43;
    room.version = 45;
    room.currentMediaId = b;
    room.nextMediaId = null;
    room.shufflePlayedIds = [b];
    room.settings = { autoplayNext: false, looping: true, shuffle: true };
    room.leaderId = "p1";
    room.playlist = [
      {
        id: b,
        url: "https://example.com/new.mp4",
        provider: "file",
        title: "New clip",
        duration: 120,
        addedBy: "Friend",
        requesterId: "p2",
        author: "Author",
        startPosition: 5,
        lastPosition: 18,
        thumbnail: "new.jpg",
        aspectRatio: 1.5,
        isTemporary: true,
      },
    ];
    room.chat = [
      {
        id: "chat",
        participantId: "p2",
        nickname: "Friend",
        message: "hello",
        sentAt: 123,
      },
    ];
    room.flashbacks = { [b]: { position: 8, savedAt: 456 } };
    room.playback = {
      status: "playing",
      basePosition: 18,
      baseTimestamp: 1234,
      rate: 1.5,
      updatedBy: "p0",
      lastActionNonce: "accepted",
    };
    await setRedisRoom(room.id, room);
    persistRoomState(room, client);
    await flushDbSyncQueue(client);
    const loaded = await loadRoomFromDB(room.id, client);
    expect(loaded).toMatchObject({
      name: "Durable friends",
      mediaRun: 17,
      sequence: 43,
      version: 45,
      currentMediaId: b,
      settings: room.settings,
      playlist: room.playlist,
      playback: room.playback,
      chat: room.chat,
      flashbacks: room.flashbacks,
    });
    expect(
      Object.values(loaded!.participants).flatMap((p) => p.connectionIds ?? []),
    ).toEqual([]);
    expect(loaded!.generation).not.toBe(room.generation);
    expect(loaded!.participants.p0).toMatchObject({
      role: "owner",
      connection: "reconnecting",
      playbackHealth: "idle",
      readyMediaId: null,
    });
    const rejoined = joinParticipant(
      loaded!,
      { ...room.participants.p1, lastSeen: Date.now() },
      Date.now(),
      "fresh-socket",
    );
    expect(rejoined.participants.p0.role).toBe("owner");
    expect(rejoined.participants.p1.role).toBe("moderator");
    expect(loaded!.leaderId).toBeNull();
    const viewerFirst = joinParticipant(
      loaded!,
      room.participants.p2,
      Date.now(),
      "viewer-socket",
    );
    expect(viewerFirst.participants.p2.role).toBe("viewer");
    expect(
      Object.values(viewerFirst.participants)
        .filter((p) => p.role === "owner")
        .map((p) => p.id),
    ).toEqual(["p0"]);
    const expired = removeParticipantAfterGrace(
      viewerFirst,
      "p0",
      Date.now() + PARTICIPANT_GRACE_MS + 1,
    );
    expect(
      Object.values(expired.participants)
        .filter((p) => p.role === "owner")
        .map((p) => p.id),
    ).toEqual(["p2"]);
    expect(
      JSON.stringify(
        (await db.query("select state from public.rooms where id=$1", [roomId]))
          .rows,
      ),
    ).not.toContain("socket-p");
    expect(
      (
        await db.query(
          "select title,position,thumbnail_url from public.playlist_items where room_id=$1",
          [roomId],
        )
      ).rows,
    ).toEqual([{ title: "New clip", position: 0, thumbnail_url: "new.jpg" }]);
    room.playlist = [];
    room.currentMediaId = null;
    room.playback = { ...room.playback, status: "paused", basePosition: 0 };
    room.version++;
    await setRedisRoom(room.id, room);
    persistRoomState(room, client);
    await flushDbSyncQueue(client);
    expect(await loadRoomFromDB(room.id, client)).toMatchObject({
      playlist: [],
      currentMediaId: null,
      playback: { status: "paused", basePosition: 0 },
    });
    expect(
      (
        await db.query(
          "select media_item_id,status,base_position from public.playback_snapshots where room_id=$1",
          [roomId],
        )
      ).rows,
    ).toEqual([{ media_item_id: null, status: "paused", base_position: 0 }]);
  });
  it("denies API roles and grants service_role on the only RPC signature", async () => {
    for (const role of ["anon", "authenticated", "service_role"]) {
      const result = await db.query<{ allowed: boolean }>(
        "select has_function_privilege($1,'public.sync_room_state(uuid,uuid,jsonb)','EXECUTE') as allowed",
        [role],
      );
      expect(result.rows[0].allowed).toBe(role === "service_role");
    }
    expect(
      (
        await db.query(
          "select oid::regprocedure::text as signature from pg_proc where proname='sync_room_state'",
        )
      ).rows,
    ).toEqual([{ signature: "sync_room_state(uuid,uuid,jsonb)" }]);
    const args = [
      roomId,
      owner,
      JSON.stringify({
        name: "Service update",
        settings: { autoplayNext: true, looping: false },
        playlist: [],
        playback: {
          mediaItemId: null,
          status: "paused",
          basePosition: 0,
          baseTimestamp: 1000,
          rate: 1,
          updatedBy: "system",
        },
        version: 99,
        sequence: 100,
      }),
    ];
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`set role ${role}`);
      try {
        await expect(
          db.query(
            "select public.sync_room_state($1::uuid,$2::uuid,$3::jsonb)",
            args,
          ),
        ).rejects.toMatchObject({ code: "42501" });
      } finally {
        await db.exec("reset role");
      }
    }
    expect(
      (await db.query("select name from public.rooms where id=$1", [roomId]))
        .rows,
    ).toEqual([{ name: "Durable friends" }]);
    await db.exec("set role service_role");
    try {
      await db.query(
        "select public.sync_room_state($1::uuid,$2::uuid,$3::jsonb)",
        args,
      );
      expect(await loadRoomFromDB(roomId, client)).toMatchObject({
        name: "Service update",
      });
    } finally {
      await db.exec("reset role");
    }
  });
});
