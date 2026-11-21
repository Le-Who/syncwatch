import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

export async function exerciseRoomSnapshotConcurrency(
  supabase: Pick<SupabaseClient, "from" | "rpc">,
  onTestFinished: (cleanup: () => Promise<void>) => void,
) {
  const roomId = randomUUID();
  const ownerId = randomUUID();
  const videoIds = Array.from({ length: 15 }, () => randomUUID());
  const name = `RPC concurrency test ${roomId}`;
  const baseTimestamp = Date.now();
  const numWrites = 10;

  async function deleteFixture(phase: "preflight" | "teardown") {
    const { data, error } = await supabase
      .from("rooms")
      .delete()
      .eq("id", roomId)
      .eq("owner_id", ownerId)
      .select("id");
    if (error) {
      throw new Error(`Room fixture ${phase} failed: ${error.message}`);
    }
    return data;
  }

  async function writeSnapshot(version: number, playlist: string[]) {
    const { error } = await supabase.rpc("sync_room_state", {
      p_room_id: roomId,
      p_owner_id: ownerId,
      p_state: {
        name,
        settings: { controlMode: "open" },
        playlist: playlist.map((id) => ({
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
          mediaItemId: playlist[0] ?? null,
          status: playlist.length ? "playing" : "paused",
          basePosition: version,
          baseTimestamp,
          rate: 1,
          updatedBy: "test",
        },
        version,
      },
    });
    if (error) {
      throw new Error(
        `Room snapshot version ${version} failed: ${error.message}`,
      );
    }
  }

  await deleteFixture("preflight");
  let created = false;
  onTestFinished(async () => {
    const removed = await deleteFixture("teardown");
    if (created && (removed?.length !== 1 || removed[0].id !== roomId)) {
      throw new Error("Room fixture teardown did not remove the test room.");
    }
  });

  await writeSnapshot(1, []);
  created = true;
  const results = await Promise.allSettled(
    Array.from({ length: numWrites }, (_, index) => {
      const playlist = [...videoIds.slice(index), ...videoIds.slice(0, index)];
      return writeSnapshot(
        index + 2,
        index % 2 ? playlist.reverse() : playlist,
      );
    }),
  );
  const failures = results.filter((result) => result.status === "rejected");
  if (failures.length) {
    throw new AggregateError(
      failures.map(({ reason }) => reason),
      "Concurrent room writes failed.",
    );
  }

  const { data, error } = await supabase
    .from("rooms")
    .select("state")
    .eq("id", roomId)
    .single();
  if (error)
    throw new Error(`Reading the persisted room failed: ${error.message}`);
  if (data.state?.version !== numWrites + 1) {
    throw new Error("The persisted room is missing the newest snapshot.");
  }
}
