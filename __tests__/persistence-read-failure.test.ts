/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadRoomFromDB } from "../lib/db-sync";

vi.mock("../lib/redis-rate-limit", () => ({ getRedisClient: () => null }));

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

function database(read: () => Promise<unknown>) {
  return {
    from: () => ({
      select: () => ({ eq: () => ({ single: read, maybeSingle: read }) }),
    }),
  } as unknown as SupabaseClient;
}

describe("durable room absence versus read failures", () => {
  it("returns null for a confirmed absent row", async () => {
    const db = database(async () => ({ data: null, error: null }));
    await expect(loadRoomFromDB("absent", db)).resolves.toBeNull();
  });

  it("rejects database errors instead of reporting that the room is absent", async () => {
    const error = { code: "503", message: "database unavailable" };
    const db = database(async () => ({ data: null, error }));
    await expect(loadRoomFromDB("saved", db)).rejects.toBe(error);
  });

  it("rejects thrown transport failures instead of reporting absence", async () => {
    const error = new Error("network failed");
    const db = database(async () => {
      throw error;
    });
    await expect(loadRoomFromDB("saved", db)).rejects.toBe(error);
  });

  it.each([null, [], "invalid", 17, {}].map((state) => ({ state })))(
    "rejects an existing row with unusable state $state",
    async ({ state }) => {
      const db = database(async () => ({ data: { state }, error: null }));
      await expect(loadRoomFromDB("saved", db)).rejects.toThrow();
    },
  );
});
