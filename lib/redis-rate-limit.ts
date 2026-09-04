import { randomUUID } from "node:crypto";
import { Redis } from "ioredis";
import {
  createInMemoryRateLimiter,
  type InMemoryRateLimiter,
} from "./rate-limit";

const globalForRedis = globalThis as unknown as {
  redisClient: Redis | null | undefined;
};

export const getRedisClient = (): Redis | null => {
  if (globalForRedis.redisClient !== undefined) {
    return globalForRedis.redisClient;
  }

  const redisUrl = process.env.REDIS_URL || process.env.UPSTASH_REDIS_REST_URL;

  if (!redisUrl) {
    console.warn(
      "REDIS_URL or UPSTASH_REDIS_REST_URL is missing. Using bounded in-memory rate limits.",
    );
    globalForRedis.redisClient = null;
    return null;
  }

  try {
    const client = new Redis(redisUrl, {
      maxRetriesPerRequest: 3,
      retryStrategy(times) {
        if (times > 3) return null;
        return Math.min(times * 100, 3000);
      },
    });
    console.log("IORedis initialized");
    globalForRedis.redisClient = client;
    return client;
  } catch (error) {
    console.error(
      "IORedis initialization failed; using bounded local limits:",
      error instanceof Error ? error.message : "unknown error",
    );
    globalForRedis.redisClient = null;
    return null;
  }
};

interface RedisEvalClient {
  eval(
    script: string,
    numberOfKeys: number,
    ...args: Array<string | number>
  ): Promise<unknown>;
}

interface CreateRateLimiterOptions {
  redis: RedisEvalClient | null;
  now?: () => number;
  randomUUID?: () => string;
  local?: InMemoryRateLimiter;
}

const CHECK_AND_ADD = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window_start = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local ttl_ms = tonumber(ARGV[4])
local member = ARGV[5]

redis.call("ZREMRANGEBYSCORE", key, 0, window_start)
local count = redis.call("ZCARD", key)
if count >= limit then
  return 0
end
redis.call("ZADD", key, now, member)
redis.call("PEXPIRE", key, ttl_ms)
return 1
`;

export function createRateLimiter(options: CreateRateLimiterOptions) {
  const now = options.now ?? (() => Date.now());
  const createMemberId = options.randomUUID ?? randomUUID;
  const local =
    options.local ?? createInMemoryRateLimiter({ now, maxKeys: 10_000 });

  return {
    async check(identifier: string, limit: number, windowMs: number) {
      if (!options.redis) {
        return local.check(identifier, limit, windowMs);
      }

      const currentTime = now();
      const member = `${currentTime}:${createMemberId()}`;
      try {
        const result = await options.redis.eval(
          CHECK_AND_ADD,
          1,
          `ratelimit:${identifier}`,
          currentTime,
          currentTime - windowMs,
          limit,
          windowMs,
          member,
        );
        return Number(result) === 1;
      } catch (error) {
        console.error(
          "Redis rate limit unavailable; using bounded local limit:",
          error instanceof Error ? error.message : "unknown error",
        );
        return local.check(identifier, limit, windowMs);
      }
    },
  };
}

const localFallback = createInMemoryRateLimiter({ maxKeys: 10_000 });

export async function checkRedisRateLimit(
  identifier: string,
  limit: number,
  windowMs: number,
): Promise<boolean> {
  return createRateLimiter({
    redis: getRedisClient(),
    local: localFallback,
  }).check(identifier, limit, windowMs);
}
