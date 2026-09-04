import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { checkRateLimit, getClientIp } from "../lib/rate-limit";
import { createRateLimiter } from "../lib/redis-rate-limit";

describe("rate-limit", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should allow requests up to the default limit", () => {
    const ip = "192.168.1.1";
    for (let i = 0; i < 20; i++) {
      expect(checkRateLimit(ip)).toBe(true);
    }
  });

  it("should block requests exceeding the default limit", () => {
    const ip = "192.168.1.2";
    for (let i = 0; i < 20; i++) {
      expect(checkRateLimit(ip)).toBe(true);
    }
    expect(checkRateLimit(ip)).toBe(false);
  });

  it("should allow requests up to the custom limit", () => {
    const ip = "192.168.1.3";
    for (let i = 0; i < 5; i++) {
      expect(checkRateLimit(ip, 5, 60000)).toBe(true);
    }
  });

  it("should block requests exceeding the custom limit", () => {
    const ip = "192.168.1.4";
    for (let i = 0; i < 5; i++) {
      expect(checkRateLimit(ip, 5, 60000)).toBe(true);
    }
    expect(checkRateLimit(ip, 5, 60000)).toBe(false);
  });

  it("should allow requests again after the window expires", () => {
    const ip = "192.168.1.5";
    for (let i = 0; i < 20; i++) {
      checkRateLimit(ip, 20, 60000);
    }
    expect(checkRateLimit(ip, 20, 60000)).toBe(false);

    vi.advanceTimersByTime(60001);

    expect(checkRateLimit(ip, 20, 60000)).toBe(true);
  });

  it("should maintain independent limits for different IPs", () => {
    const ip1 = "192.168.1.6";
    const ip2 = "192.168.1.7";

    // Max out IP1
    for (let i = 0; i < 20; i++) {
      expect(checkRateLimit(ip1)).toBe(true);
    }
    expect(checkRateLimit(ip1)).toBe(false);

    // IP2 should still be allowed
    expect(checkRateLimit(ip2)).toBe(true);
  });

  it("should clean up old entries occasionally when map grows too large", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.005); // Force the cleanup condition to be true

    // Fill with entries that will expire quickly
    for (let i = 0; i < 10005; i++) {
      checkRateLimit(`10.0.0.${i}`, 1, 10);
    }

    // Advance time so all of those expire
    vi.advanceTimersByTime(20);

    // Trigger one more check which should trigger the cleanup
    expect(checkRateLimit("10.0.0.99999", 1, 1000)).toBe(true);
  });
});

describe("Redis/local rate-limit adapter", () => {
  it("allows exactly the configured number of events without Redis", async () => {
    const limiter = createRateLimiter({ redis: null, now: () => 1_000 });

    for (let index = 0; index < 20; index++) {
      await expect(limiter.check("ip", 20, 60_000)).resolves.toBe(true);
    }
    await expect(limiter.check("ip", 20, 60_000)).resolves.toBe(false);
  });

  it("falls back to the bounded local limit when Redis becomes unavailable", async () => {
    const redis = {
      eval: vi.fn().mockRejectedValue(new Error("redis unavailable")),
    };
    const limiter = createRateLimiter({ redis, now: () => 1_000 });

    await expect(limiter.check("ip", 2, 60_000)).resolves.toBe(true);
    await expect(limiter.check("ip", 2, 60_000)).resolves.toBe(true);
    await expect(limiter.check("ip", 2, 60_000)).resolves.toBe(false);
  });

  it("uses distinct sorted-set members for simultaneous events", async () => {
    const redis = { eval: vi.fn().mockResolvedValue(1) };
    let nonce = 0;
    const limiter = createRateLimiter({
      redis,
      now: () => 1_000,
      randomUUID: () => `event-${++nonce}`,
    });

    await limiter.check("ip", 20, 60_000);
    await limiter.check("ip", 20, 60_000);

    expect(redis.eval.mock.calls[0]?.[7]).toBe("1000:event-1");
    expect(redis.eval.mock.calls[1]?.[7]).toBe("1000:event-2");
  });
});

describe("trusted proxy client addresses", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("ignores forwarded addresses unless trusted forwarding is enabled", () => {
    const headers = new Headers({ "x-forwarded-for": "203.0.113.7" });
    vi.stubEnv("TRUST_PROXY", "false");

    expect(getClientIp(headers, "127.0.0.1")).toBe("127.0.0.1");
  });

  it("uses the first forwarded address when trusted forwarding is enabled", () => {
    const headers = new Headers({
      "x-forwarded-for": "203.0.113.7, 10.0.0.4",
    });
    vi.stubEnv("TRUST_PROXY", "true");

    expect(getClientIp(headers, "127.0.0.1")).toBe("203.0.113.7");
  });
});
