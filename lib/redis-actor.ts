import { getRedisClient } from "./redis-rate-limit";
import { normalizeRoomState } from "./types";
import type { Redis } from "ioredis";

export const pubClient = getRedisClient;
let cachedSubClient: Redis | null = null;
export const subClient = () => {
  if (!cachedSubClient) {
    cachedSubClient = getRedisClient()?.duplicate() || null;
  }
  return cachedSubClient;
};

import { LRUCache } from "./lru-cache";

// LRU Cache for fallback when Redis is unavailable to prevent OOM
const rawLocalRooms = new LRUCache<string, any>(500);
const localRoomExpiryTimers = new Map<string, ReturnType<typeof setTimeout>>();

const localRooms = {
  get: (key: string) => {
    const val = rawLocalRooms.get(key);
    return val ? JSON.parse(JSON.stringify(val)) : null; // Clone to prevent mutation
  },
  set: (key: string, value: any) => {
    rawLocalRooms.set(key, JSON.parse(JSON.stringify(value)));
  },
};

/**
 * Load room state from Redis cache
 */
export async function getRedisRoom(roomId: string): Promise<any | null> {
  const redisClient = getRedisClient();
  if (!redisClient) {
    const room = localRooms.get(roomId);
    return room ? normalizeRoomState(room) : null;
  }
  const data = await redisClient.get(`room_state:${roomId}`);
  return data ? normalizeRoomState(JSON.parse(data)) : null;
}

/**
 * Save room state to Redis cache
 */
export async function setRedisRoom(roomId: string, state: any): Promise<void> {
  const redisClient = getRedisClient();
  if (!redisClient) {
    const expiryTimer = localRoomExpiryTimers.get(roomId);
    if (expiryTimer) {
      clearTimeout(expiryTimer);
      localRoomExpiryTimers.delete(roomId);
    }
    localRooms.set(roomId, JSON.parse(JSON.stringify(state)));
    return;
  }
  await redisClient.set(`room_state:${roomId}`, JSON.stringify(state));
  await redisClient.expire(`room_state:${roomId}`, 86400); // 1 day
}

export async function expireRedisRoom(
  roomId: string,
  ttlSeconds: number,
): Promise<void> {
  const redisClient = getRedisClient();
  if (redisClient) {
    await redisClient.expire(`room_state:${roomId}`, ttlSeconds);
    return;
  }

  const existingTimer = localRoomExpiryTimers.get(roomId);
  if (existingTimer) clearTimeout(existingTimer);
  const timer = setTimeout(() => {
    localRooms.set(roomId, null);
    localRoomExpiryTimers.delete(roomId);
  }, ttlSeconds * 1_000);
  timer.unref?.();
  localRoomExpiryTimers.set(roomId, timer);
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
    if (
      (!existing && expectedVersion === 0) ||
      (existing && existing.version === expectedVersion)
    ) {
      localRooms.set(roomId, JSON.parse(JSON.stringify(state)));
      return true;
    }
    return false;
  }

  const script = `
    local val = redis.call("get", KEYS[1])
    if not val then
      if tonumber(ARGV[2]) ~= 0 then return 0 end
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
