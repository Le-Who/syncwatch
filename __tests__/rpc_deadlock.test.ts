import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";

// Test against local Supabase if running emulator, else fail fast or use project if configured securely
const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || "http://127.0.0.1:54321";
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  "";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

describe("RPC Deadlock Test (sync_room_state)", () => {
  it("should handle highly concurrent disjoint array updates without deadlocking", async () => {
    if (!SUPABASE_SERVICE_ROLE_KEY) {
      console.warn(
        "Skipping DB deadlock test because no service key is available",
      );
      return;
    }

    const roomId = randomUUID();
    const ownerId = randomUUID();
    const vids = Array.from({ length: 15 }, () => randomUUID());

    // Initial base state
    await supabase.rpc("sync_room_state", {
      p_room_id: roomId,
      p_owner_id: ownerId,
      p_state: {
        name: "Deadlock Room",
        settings: { controlMode: "open" },
        playlist: [],
        playback: {
          mediaItemId: null,
          status: "paused",
          basePosition: 0,
          baseTimestamp: Date.now(),
          rate: 1,
          updatedBy: "system",
        },
        version: 1,
      },
    });

    // Create 10 concurrent requests that try to insert/update the exact same videos in completely DIFFERENT orders.
    // In a row-by-row FOR loop without a parent lock, this guarantees an AB/BA deadlock.
    const tasks = Array.from({ length: 10 }).map((_, i) => {
      const shuffledVids = [...vids].sort(() => Math.random() - 0.5);

      const stateObj = {
        name: `Room Update ${i}`,
        settings: { controlMode: "open" },
        playlist: shuffledVids.map((id, idx) => ({
          id,
          url: `https://youtube.com/watch?v=${id}`,
          provider: "youtube",
          title: `Video ${id}`,
          duration: 100,
          addedBy: "test",
          lastPosition: 0,
          thumbnail: "",
        })),
        playback: {
          mediaItemId: shuffledVids[0] || null,
          status: "playing",
          basePosition: Math.random() * 100,
          baseTimestamp: Date.now(),
          rate: 1,
          updatedBy: "test",
        },
        version: i + 2,
      };

      return supabase.rpc("sync_room_state", {
        p_room_id: roomId,
        p_owner_id: ownerId,
        p_state: stateObj,
      });
    });

    const results = await Promise.allSettled(tasks);

    // If deadlocks happen, Supabase/Postgres returns an error code 40P01 (deadlock_detected)
    const failures = results.filter(
      (r) =>
        r.status === "rejected" || (r.status === "fulfilled" && r.value.error),
    );

    if (failures.length > 0) {
      console.error(
        "Deadlock or concurrent update failure detected:",
        failures[0],
      );
    }

    expect(failures).toHaveLength(0);
  }, 15000);
});
