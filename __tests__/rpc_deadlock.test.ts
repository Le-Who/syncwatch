import { createClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { exerciseRoomSnapshotConcurrency } from "./helpers/supabase-concurrency-fixture";

function disposableSupabaseTarget(
  env: Readonly<Record<string, string | undefined>>,
) {
  const url = env.SYNCWATCH_TEST_SUPABASE_URL?.trim();
  const key = env.SYNCWATCH_TEST_SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) {
    throw new Error(
      "Set SYNCWATCH_TEST_SUPABASE_URL and SYNCWATCH_TEST_SUPABASE_SERVICE_ROLE_KEY for a disposable Supabase database.",
    );
  }

  const target = new URL(url);
  if (target.protocol !== "http:" && target.protocol !== "https:") {
    throw new Error("SYNCWATCH_TEST_SUPABASE_URL must be an HTTP(S) URL.");
  }
  const applicationUrl = env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  if (
    applicationUrl &&
    URL.canParse(applicationUrl) &&
    new URL(applicationUrl).origin === target.origin
  ) {
    throw new Error(
      "SYNCWATCH_TEST_SUPABASE_URL must point to a database separate from NEXT_PUBLIC_SUPABASE_URL.",
    );
  }
  return { url, key };
}

describe("Supabase concurrency test target", () => {
  it("requires dedicated credentials even when application credentials are available", () => {
    expect(() =>
      disposableSupabaseTarget({
        NEXT_PUBLIC_SUPABASE_URL: "https://application.example",
        SUPABASE_SERVICE_ROLE_KEY: "application-key",
      }),
    ).toThrow(
      "Set SYNCWATCH_TEST_SUPABASE_URL and SYNCWATCH_TEST_SUPABASE_SERVICE_ROLE_KEY",
    );
  });

  it("rejects the application database as the disposable target", () => {
    expect(() =>
      disposableSupabaseTarget({
        NEXT_PUBLIC_SUPABASE_URL: "https://application.example",
        SYNCWATCH_TEST_SUPABASE_URL: "https://application.example/",
        SYNCWATCH_TEST_SUPABASE_SERVICE_ROLE_KEY: "test-key",
      }),
    ).toThrow(
      "must point to a database separate from NEXT_PUBLIC_SUPABASE_URL",
    );
  });
});

describe.skipIf(process.env.SYNCWATCH_TEST_DB_DEADLOCK !== "1")(
  "disposable Supabase sync_room_state RPC",
  () => {
    it("serializes concurrent playlist writes in conflicting item orders", async ({
      onTestFinished,
    }) => {
      const { url, key } = disposableSupabaseTarget(process.env);
      const supabase = createClient(url, key, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      await exerciseRoomSnapshotConcurrency(supabase, onTestFinished);
    }, 30_000);
  },
);

describe("Supabase concurrency fixture", () => {
  it("checks teardown permission before creating a room", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      Response.json({ message: "permission denied" }, { status: 403 }),
    );
    const client = createClient("https://disposable.example", "test-key", {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { fetch },
    });
    const registerCleanup = vi.fn();

    await expect(
      exerciseRoomSnapshotConcurrency(client, registerCleanup),
    ).rejects.toThrow("Room fixture preflight failed: permission denied");
    expect(fetch).toHaveBeenCalledExactlyOnceWith(
      expect.stringContaining("/rest/v1/rooms?"),
      expect.objectContaining({ method: "DELETE" }),
    );
    expect(registerCleanup).not.toHaveBeenCalled();
  });

  it.for([
    { setup: "successful writes", failedVersion: null, expectedWrites: 11 },
    { setup: "failed initial write", failedVersion: 1, expectedWrites: 1 },
    { setup: "failed concurrent write", failedVersion: 7, expectedWrites: 11 },
  ])(
    "removes the same owned fixture after $setup",
    async ({ failedVersion, expectedWrites }) => {
      let room: { id: string; ownerId: string; version: number } | undefined;
      let identity: [string, string] | undefined;
      const deletes: [string | null, string | null][] = [];
      const writes: number[] = [];
      const client = createClient("https://disposable.example", "test-key", {
        auth: { autoRefreshToken: false, persistSession: false },
        global: {
          fetch: async (input, options) => {
            const request = new Request(input, options);
            if (request.method === "POST") {
              const snapshot = await request.json();
              const version = snapshot.p_state.version as number;
              const id = snapshot.p_room_id as string;
              const ownerId = snapshot.p_owner_id as string;
              identity ??= [`eq.${id}`, `eq.${ownerId}`];
              writes.push(version);
              if (!room || version > room.version)
                room = { id, ownerId, version };
              if (version === failedVersion) {
                return Response.json(
                  { message: "fixture RPC failed" },
                  { status: 400 },
                );
              }
              return new Response(null, { status: 204 });
            }

            if (request.method === "DELETE") {
              const { searchParams } = new URL(request.url);
              const selectedId = searchParams.get("id");
              const selectedOwner = searchParams.get("owner_id");
              deletes.push([selectedId, selectedOwner]);
              if (
                room &&
                selectedId === `eq.${room.id}` &&
                selectedOwner === `eq.${room.ownerId}`
              ) {
                const deleted = room;
                room = undefined;
                return Response.json([{ id: deleted.id }]);
              }
              return Response.json([]);
            }

            return Response.json({ state: { version: room?.version } });
          },
        },
      });
      const cleanup: Array<() => Promise<void>> = [];
      const result = exerciseRoomSnapshotConcurrency(client, (finish) =>
        cleanup.push(finish),
      );
      if (failedVersion === 1) {
        await expect(result).rejects.toThrow(
          "Room snapshot version 1 failed: fixture RPC failed",
        );
      } else if (failedVersion) {
        await expect(result).rejects.toThrow("Concurrent room writes failed");
      } else {
        await result;
      }

      expect(writes).toHaveLength(expectedWrites);
      expect(deletes).toEqual([identity]);
      expect(cleanup).toHaveLength(1);
      await cleanup[0]();
      expect(deletes).toEqual([identity, identity]);
      expect(room).toBeUndefined();
    },
  );
});
