import { Redis } from "ioredis";

const redisUrl = process.env.REDIS_URL || process.env.UPSTASH_REDIS_REST_URL;

let redisClient: Redis | null = null;
if (redisUrl) {
  try {
    redisClient = new Redis(redisUrl, {
      maxRetriesPerRequest: 3,
      retryStrategy(times) {
        if (times > 3) return null; // Stop retrying
        return Math.min(times * 100, 3000);
      },
    });
    console.log("✅ IORedis initialized");
  } catch (e) {
    console.error("IORedis initialization failed:", e);
  }
} else {
  console.warn(
    "⚠️ REDIS_URL or UPSTASH_REDIS_REST_URL is missing. Operating without Redis.",
  );
}

export { redisClient };

export async function checkRedisRateLimit(
  identifier: string,
  limit: number,
  windowMs: number,
): Promise<boolean> {
  if (!redisClient) return true; // Fail open if Redis is not configured

  const now = Date.now();
  const windowStart = now - windowMs;
  const key = `ratelimit:${identifier}`;

  try {
    const multi = redisClient.multi();
    // Remove old events
    multi.zremrangebyscore(key, 0, windowStart);
    // Add new event
    multi.zadd(key, now, `${now}-${Math.random()}`);
    // Count current events
    multi.zcard(key);
    // Set expiry to avoid memory leaks
    multi.expire(key, Math.ceil(windowMs / 1000));

    const results = await multi.exec();

    if (results && results[2] && results[2][1] !== null) {
      const count = results[2][1] as number;
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
