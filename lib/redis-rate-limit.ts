import { Redis } from "ioredis";

const globalForRedis = globalThis as unknown as {
  redisClient: Redis | null | undefined; // Changed to undefined to differentiate between not initialized and explicitly null
};

export const getRedisClient = (): Redis | null => {
  if (globalForRedis.redisClient !== undefined) {
    return globalForRedis.redisClient;
  }

  // Read directly from process.env at runtime to ensure Next/Server .env loaders have completed
  const redisUrl = process.env.REDIS_URL || process.env.UPSTASH_REDIS_REST_URL;

  if (!redisUrl) {
    console.warn(
      "⚠️ REDIS_URL or UPSTASH_REDIS_REST_URL is missing. Operating without Redis.",
    );
    globalForRedis.redisClient = null; // Assign null to global to remember it's not available
    return null;
  }

  try {
    const client = new Redis(redisUrl, {
      maxRetriesPerRequest: 3,
      retryStrategy(times) {
        if (times > 3) return null; // Stop retrying
        return Math.min(times * 100, 3000);
      },
    });
    console.log("✅ IORedis initialized");
    globalForRedis.redisClient = client; // Assign client to global
    return client;
  } catch (e) {
    console.error("IORedis initialization failed:", e);
    globalForRedis.redisClient = null; // Assign null to global on error
    return null;
  }
};

// The previous global assignment logic is now handled within getRedisClient
// if (process.env.NODE_ENV !== "production" || redisClient) {
//   globalForRedis.redisClient = redisClient;
// }

export async function checkRedisRateLimit(
  identifier: string,
  limit: number,
  windowMs: number,
): Promise<boolean> {
  const client = getRedisClient();
  if (!client) {
    return true; // Fail open if Redis is not configured
  }

  const now = Date.now();
  const windowStart = now - windowMs;
  const key = `ratelimit:${identifier}`;
  try {
    const multi = client.multi();
    // Remove old events
    multi.zremrangebyscore(key, 0, windowStart);
    // Count events in the window
    multi.zcard(key);
    // Add current event
    multi.zadd(key, now, now.toString());
    // Set expiry to clean up keys
    multi.expire(key, Math.ceil(windowMs / 1000));

    const results = await multi.exec();

    if (results && results[1] && results[1][1] !== null) {
      const count = results[1][1] as number;
      if (count > limit) {
        return false;
      }
    }
    return true;
  } catch (error) {
    console.error("Redis rate limit error:", error);
    return true; // Fail open
  }
}
