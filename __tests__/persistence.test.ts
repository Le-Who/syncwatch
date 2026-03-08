import { describe, it, expect, vi, beforeEach } from "vitest";
import { checkRedisRateLimit, getRedisClient } from "../lib/redis-rate-limit";

vi.mock("ioredis", () => {
  return {
    Redis: vi.fn().mockImplementation(() => {
      // Mock basic Redis methods
      return {
        multi: vi.fn().mockReturnValue({
          zremrangebyscore: vi.fn().mockReturnThis(),
          zcard: vi.fn().mockReturnThis(),
          zadd: vi.fn().mockReturnThis(),
          expire: vi.fn().mockReturnThis(),
          exec: vi.fn().mockResolvedValue([null, [null, 5]]), // Example output: count of 5
        }),
      };
    }),
  };
});

describe("Redis Rate Limit & Persistence Fallbacks", () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.REDIS_URL;
    delete process.env.UPSTASH_REDIS_REST_URL;
    (globalThis as any).redisClient = undefined;
  });

  it("TC-05: Should return true (fail open) if no Redis is configured", async () => {
    const result = await checkRedisRateLimit("ws:command:127.0.0.1", 10, 60000);
    expect(result).toBe(true);
    expect(getRedisClient()).toBeNull();
  });

  it("TC-05: Should evaluate limits via multi block when Redis is present", async () => {
    process.env.REDIS_URL = "redis://localhost:6379";

    // Test with limit 10, mock returns 5
    const allowed = await checkRedisRateLimit(
      "ws:command:192.168.1.1",
      10,
      60000,
    );
    expect(allowed).toBe(true);
  });
});
