import { redisClient } from "./redis-rate-limit";
import Redlock from "redlock";

export const pubClient = redisClient;
export const subClient = redisClient ? redisClient.duplicate() : null;

export const redlock = redisClient
  ? new Redlock([redisClient as any], {
      driftFactor: 0.01,
      retryCount: 3,
      retryDelay: 200, // time in ms
      retryJitter: 200,
    })
  : null;

/**
 * Perform a Redlock-protected atomic operation.
 * If Redis isn't configured, bypass lock seamlessly.
 */
export async function withLock<T>(
  resourceId: string,
  ttl: number,
  operation: () => Promise<T>,
): Promise<T> {
  if (!redlock || !redisClient) {
    return await operation();
  }

  const key = `locks:${resourceId}`;
  let lock;
  try {
    lock = await redlock.acquire([key], ttl);
    return await operation();
  } catch (err: any) {
    if (err.name === "ExecutionError") {
      throw new Error("Could not acquire distributed lock for " + resourceId);
    }
    throw err;
  } finally {
    if (lock) {
      await (lock as any)
        .release()
        .catch((e: any) => console.error("Lock release err:", e));
    }
  }
}

/**
 * Load room state from Redis cache
 */
export async function getRedisRoom(roomId: string): Promise<any | null> {
  if (!redisClient) return null;
  const data = await redisClient.get(`room_state:${roomId}`);
  return data ? JSON.parse(data) : null;
}

/**
 * Save room state to Redis cache
 */
export async function setRedisRoom(roomId: string, room: any): Promise<void> {
  if (!redisClient) return;
  await redisClient.set(
    `room_state:${roomId}`,
    JSON.stringify(room),
    "EX",
    60 * 60 * 24,
  ); // 24hr expiry
}

/**
 * Broadcast event to all instances
 */
export async function publishRoomEvent(
  roomId: string,
  type: string,
  payload: any,
): Promise<void> {
  if (!pubClient) return;
  await pubClient.publish(
    `room_events:${roomId}`,
    JSON.stringify({ type, roomId, payload }),
  );
}
