import { SupabaseClient } from "@supabase/supabase-js";
import { getRedisClient } from "./redis-rate-limit";
import { getRedisRoom } from "./redis-actor";
import { RoomState } from "./types";
import { v5 as uuidv5 } from "uuid";

const SYNCWATCH_NAMESPACE = "1b671a64-40d5-491e-99b0-da01ff1f3341";

export function getDeterministicUUID(roomId: string): string {
  if (
    roomId.length === 36 &&
    roomId.match(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    )
  ) {
    return roomId;
  }
  return uuidv5(roomId, SYNCWATCH_NAMESPACE);
}

export const writeBehindQueue = new Set<string>();

export async function isSystemDegraded(): Promise<boolean> {
  const redisClient = getRedisClient();
  if (redisClient) {
    try {
      const size = await redisClient.zcard("pending_db_syncs");
      return size > 2000;
    } catch {
      return false;
    }
  }
  return writeBehindQueue.size > 2000;
}

export const markRoomForSync = (roomId: string) => {
  const redisClient = getRedisClient();
  if (redisClient) {
    redisClient
      .zadd("pending_db_syncs", Date.now(), roomId)
      .catch((e) => console.error("Redis queue error:", e));
  } else {
    writeBehindQueue.add(roomId);
  }
};

export const persistRoomState = (
  room: RoomState,
  supabase: SupabaseClient | null,
) => {
  if (!supabase) return;
  markRoomForSync(room.id);
};

export const forcePersistRoom = async (
  room: RoomState,
  supabase: SupabaseClient | null,
) => {
  if (!supabase) return;
  try {
    const { error } = await supabase.rpc("sync_room_state", {
      p_room_id: getDeterministicUUID(room.id),
      p_owner_id: getDeterministicUUID(
        Object.values(room.participants).find((p) => p.role === "owner")?.id ||
          room.id,
      ),
      p_state: {
        name: room.name,
        settings: room.settings,
        playlist: room.playlist.map((item, index) => ({
          id: item.id,
          url: item.url,
          provider: item.provider,
          title: item.title,
          duration: item.duration,
          addedBy: item.addedBy,
          position: index,
          lastPosition: item.lastPosition || 0,
          thumbnail: item.thumbnail,
        })),
        playback: {
          mediaItemId: room.currentMediaId,
          status: ["playing", "paused", "buffering", "ended"].includes(
            room.playback.status,
          )
            ? room.playback.status
            : "paused",
          basePosition: room.playback.basePosition,
          baseTimestamp: room.playback.baseTimestamp,
          rate: room.playback.rate,
          updatedBy: room.playback.updatedBy,
        },
        version: room.version,
      },
    });

    if (error) {
      if (error.code === "22P02") {
        console.warn(
          `[Poison Pill] Dropping invalid UUID task for room ${room.id}:`,
          error,
        );
        return;
      }
      console.error(`Failed to persist room ${room.id} via RPC:`, error);
      throw error;
    }
  } catch (err: any) {
    if (err?.code === "22P02") {
      console.warn(`[Poison Pill] Dropping invalid task:`, err);
      return;
    }
    console.error(`Fatal error persisting room ${room.id}`, err);
    throw err;
  }
};

export async function loadRoomFromDB(
  roomId: string,
  supabase: SupabaseClient | null,
): Promise<RoomState | null> {
  if (!supabase) return null;
  try {
    const { data: roomData, error } = await supabase
      .from("rooms")
      .select("state")
      .eq("id", getDeterministicUUID(roomId))
      .single();

    if (error || !roomData) return null;

    const dbState = roomData.state as any;
    if (!dbState || typeof dbState !== "object") return null;

    return {
      id: roomId,
      name: dbState.name || `Room ${roomId}`,
      settings: dbState.settings || {
        controlMode: "open",
        autoplayNext: true,
        looping: false,
      },
      participants: {},
      playlist: Array.isArray(dbState.playlist) ? dbState.playlist : [],
      currentMediaId: dbState.playback?.mediaItemId || null,
      playback: {
        status: dbState.playback?.status || "paused",
        basePosition: dbState.playback?.basePosition || 0,
        baseTimestamp: dbState.playback?.baseTimestamp || Date.now(),
        rate: dbState.playback?.rate || 1,
        updatedBy: dbState.playback?.updatedBy || "system",
      },
      version: dbState.version || 1,
      sequence: 1,
      lastActivity: Date.now(),
    };
  } catch (err) {
    console.error(`Failed to load room ${roomId} from DB:`, err);
    return null;
  }
}

export function startDbSyncWorker(supabase: SupabaseClient | null) {
  if (!supabase) return null;
  return setInterval(async () => {
    const redisClient = getRedisClient();
    let queue: string[] = [];

    if (redisClient) {
      const cutoff = Date.now() - 5000;
      queue = await redisClient
        .zrangebyscore("pending_db_syncs", "-inf", cutoff, "LIMIT", 0, 50)
        .catch(() => []);
    } else {
      if (writeBehindQueue.size === 0) return;
      queue = Array.from(writeBehindQueue).slice(0, 50);
      queue.forEach((q) => writeBehindQueue.delete(q));

      if (writeBehindQueue.size > 3000) {
        console.warn(
          "Write-behind queue exceeded 3000 items. Dropping oldest to prevent OOM.",
        );
        const excess = Array.from(writeBehindQueue).slice(
          0,
          writeBehindQueue.size - 2000,
        );
        excess.forEach((q) => writeBehindQueue.delete(q));
      }
    }

    const BATCH_SIZE = 10;
    for (let i = 0; i < queue.length; i += BATCH_SIZE) {
      const batch = queue.slice(i, i + BATCH_SIZE);
      const promises = batch.map(async (roomId) => {
        let room;
        const roomStr = await getRedisRoom(roomId);
        if (roomStr) room = roomStr;

        if (!room) {
          if (redisClient)
            await redisClient.zrem("pending_db_syncs", roomId).catch(() => {});
          return;
        }

        try {
          const lockAcquired = redisClient
            ? await redisClient.set(
                `db_sync_lock:${roomId}`,
                "1",
                "PX",
                10000,
                "NX",
              )
            : "OK";

          if (lockAcquired !== "OK") return;

          await forcePersistRoom(room, supabase);
          if (redisClient) {
            await redisClient.zrem("pending_db_syncs", roomId).catch(() => {});
            await redisClient.del(`db_sync_lock:${roomId}`).catch(() => {});
          }
        } catch (err) {
          if (redisClient) {
            await redisClient.del(`db_sync_lock:${roomId}`).catch(() => {});
            await redisClient
              .zadd("pending_db_syncs", Date.now() + 60000, roomId)
              .catch(() => {});
          } else {
            writeBehindQueue.add(roomId);
          }
        }
      });
      await Promise.allSettled(promises);
    }
  }, 10000);
}

export async function flushDbSyncQueue(supabase: SupabaseClient | null) {
  if (!supabase) return;
  const redisClient = getRedisClient();
  let queue: string[] = [];

  if (redisClient) {
    queue = await redisClient
      .zrangebyscore("pending_db_syncs", "-inf", "+inf")
      .catch(() => []);
  } else {
    queue = Array.from(writeBehindQueue);
  }

  for (const roomId of queue) {
    let room;
    const roomStr = await getRedisRoom(roomId);
    if (roomStr) room = roomStr;

    if (room) {
      await forcePersistRoom(room, supabase).catch(() => {});
      if (redisClient)
        await redisClient.zrem("pending_db_syncs", roomId).catch(() => {});
    }
  }
}
