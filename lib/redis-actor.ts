import { getRedisClient } from "./redis-rate-limit";

export const pubClient = getRedisClient;
export const subClient = () => getRedisClient()?.duplicate();

// LRU Cache for fallback when Redis is unavailable to prevent OOM
class SimpleLRU {
  private cache = new Map<string, { value: any; lastAccessed: number }>();
  private readonly maxSize: number;

  constructor(maxSize: number = 1000) {
    this.maxSize = maxSize;
  }

  get(key: string) {
    const item = this.cache.get(key);
    if (item) {
      item.lastAccessed = Date.now();
      return JSON.parse(JSON.stringify(item.value)); // Clone to prevent mutation
    }
    return null;
  }

  set(key: string, value: any) {
    if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
      // Find oldest key
      let oldestKey: string | null = null;
      let oldestTime = Infinity;
      for (const [k, v] of this.cache.entries()) {
        if (v.lastAccessed < oldestTime) {
          oldestTime = v.lastAccessed;
          oldestKey = k;
        }
      }
      if (oldestKey) this.cache.delete(oldestKey);
    }
    this.cache.set(key, {
      value: JSON.parse(JSON.stringify(value)),
      lastAccessed: Date.now(),
    });
  }
}
const localRooms = new SimpleLRU(500);

export async function withLock<T>(
  resourceId: string,
  ttl: number,
  operation: () => Promise<T>,
  maxRetries = 20, // 20 retries (~1 second max queue wait)
): Promise<T> {
  const redisClient = getRedisClient();
  if (!redisClient) {
    return await operation();
  }

  const key = `locks:${resourceId}`;
  const val = Math.random().toString(36).substring(2, 15);

  let acquired = false;
  for (let i = 0; i < maxRetries; i++) {
    acquired = (await redisClient.set(key, val, "PX", ttl, "NX")) === "OK";
    if (acquired) break;
    // Jittered backoff: 30ms to 70ms wait to avoid stampedes
    await new Promise((resolve) =>
      setTimeout(resolve, 30 + Math.random() * 40),
    );
  }

  if (!acquired) {
    throw new Error("Could not acquire distributed lock for " + resourceId);
  }

  try {
    // Watchdog implementation: forceful reject if operation stalls longer than lock TTL to prevent Split-Brain
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Lock operation timeout")), ttl - 500),
    );
    return await Promise.race([operation(), timeoutPromise]);
  } finally {
    const script = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
      else
        return 0
      end
    `;
    const redisClient = getRedisClient();
    if (redisClient) {
      await redisClient
        .eval(script, 1, key, val)
        .catch((e: any) => console.error("Lock release err:", e));
    }
  }
}

/**
 * Load room state from Redis cache
 */
export async function getRedisRoom(roomId: string): Promise<any | null> {
  const redisClient = getRedisClient();
  if (!redisClient) {
    return localRooms.get(roomId);
  }
  const data = await redisClient.get(`room_state:${roomId}`);
  return data ? JSON.parse(data) : null;
}

/**
 * Save room state to Redis cache
 */
export async function setRedisRoom(roomId: string, state: any): Promise<void> {
  const redisClient = getRedisClient();
  if (!redisClient) {
    localRooms.set(roomId, JSON.parse(JSON.stringify(state)));
    return;
  }
  await redisClient.set(`room_state:${roomId}`, JSON.stringify(state));
  await redisClient.expire(`room_state:${roomId}`, 86400); // 1 day
}

/**
 * Save room state to Redis cache with OCC Version Check
 * Returns true if successful, false if version conflict
 */
export async function setRedisRoomCAS(
  roomId: string,
  state: any,
  expectedVersion: number,
): Promise<boolean> {
  const redisClient = getRedisClient();
  if (!redisClient) {
    // Local memory fallback CAS
    const existing = localRooms.get(roomId);
    if (!existing || existing.version === expectedVersion) {
      localRooms.set(roomId, JSON.parse(JSON.stringify(state)));
      return true;
    }
    return false;
  }

  const script = `
    local val = redis.call("get", KEYS[1])
    if not val then
      redis.call("set", KEYS[1], ARGV[1])
      redis.call("expire", KEYS[1], 86400)
      return 1
    end
    local decoded = cjson.decode(val)
    if decoded.version == tonumber(ARGV[2]) then
      redis.call("set", KEYS[1], ARGV[1])
      redis.call("expire", KEYS[1], 86400)
      return 1
    end
    return 0
  `;
  try {
    const result = await redisClient.eval(
      script,
      1,
      `room_state:${roomId}`,
      JSON.stringify(state),
      expectedVersion,
    );
    return result === 1;
  } catch (e) {
    console.error("CAS Lua Error:", e);
    return false;
  }
}

/**
 * Publish an event to other nodes (in a multi-node deployment)
 */
export async function publishRoomEvent(
  roomId: string,
  event: any,
): Promise<void> {
  const pClient = pubClient();
  if (!pClient) return;
  await pClient.publish(`room_events:${roomId}`, JSON.stringify(event));
}
