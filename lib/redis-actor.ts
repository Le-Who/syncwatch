import { redisClient } from "./redis-rate-limit";

export const pubClient = redisClient;
export const subClient = redisClient ? redisClient.duplicate() : null;

export async function withLock<T>(
  resourceId: string,
  ttl: number,
  operation: () => Promise<T>,
): Promise<T> {
  if (!redisClient) {
    return await operation();
  }

  const key = `locks:${resourceId}`;
  const val = Math.random().toString(36).substring(2, 15);

  const acquired = await redisClient.set(key, val, "PX", ttl, "NX");
  if (!acquired) {
    throw new Error("Could not acquire distributed lock for " + resourceId);
  }

  try {
    return await operation();
  } finally {
    const script = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
      else
        return 0
      end
    `;
    await redisClient
      .eval(script, 1, key, val)
      .catch((e: any) => console.error("Lock release err:", e));
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
