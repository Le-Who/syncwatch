import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { checkRedisRateLimit, getRedisClient } from "../lib/redis-rate-limit";
import { loadRoomFromDB } from "../lib/db-sync";

const mockZadd = vi.fn().mockResolvedValue(1);
const mockZremrangebyscore = vi.fn().mockReturnThis();

vi.mock("ioredis", () => {
  class MockRedis {
    multi() {
      return {
        zremrangebyscore: mockZremrangebyscore,
        zcard: vi.fn().mockReturnThis(),
        zadd: mockZadd,
        expire: vi.fn().mockReturnThis(),
        exec: vi.fn().mockResolvedValue([null, [null, 5]]),
      };
    }
    on() {
      return this;
    }
  }
  return { Redis: MockRedis };
});

describe("Redis Rate Limit & Persistence Fallbacks", () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.REDIS_URL;
    delete process.env.UPSTASH_REDIS_REST_URL;
    (globalThis as any).redisClient = undefined;
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("TC-01: Should return true (fail open) if no Redis is configured", async () => {
    // Arrange & Act
    const result = await checkRedisRateLimit("ws:command:127.0.0.1", 10, 60000);

    // Assert
    expect(result).toBe(true);
    expect(getRedisClient()).toBeNull();
  });

  it("TC-02: Should evaluate limits via multi block when Redis is present", async () => {
    // Arrange
    process.env.REDIS_URL = "redis://localhost:6379";

    // Act
    const allowed = await checkRedisRateLimit(
      "ws:command:192.168.1.1",
      10,
      60000,
    );

    // Assert
    expect(allowed).toBe(true);
  });

  it("normalizes a legacy persisted room during database hydration", async () => {
    const supabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: {
                state: {
                  name: "Legacy Database Room",
                  settings: { autoplayNext: true, looping: false },
                  playlist: [],
                  playback: {
                    status: "buffering",
                    basePosition: 6,
                    baseTimestamp: 1,
                    rate: 1,
                    updatedBy: "legacy",
                  },
                  version: 1,
                },
              },
              error: null,
            }),
          }),
        }),
      }),
    };

    const room = await loadRoomFromDB("legacy-db-room", supabase as any);

    expect(room?.playback.status).toBe("paused");
    expect(room?.chat).toEqual([]);
    expect(room?.leaderId).toBeNull();
    expect(room?.flashbacks).toEqual({});
  });
});
