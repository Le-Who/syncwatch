import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { checkRateLimit } from '../lib/rate-limit';

describe('rate-limit', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should allow requests up to the default limit', () => {
    const ip = '192.168.1.1';
    for (let i = 0; i < 20; i++) {
      expect(checkRateLimit(ip)).toBe(true);
    }
  });

  it('should block requests exceeding the default limit', () => {
    const ip = '192.168.1.2';
    for (let i = 0; i < 20; i++) {
      expect(checkRateLimit(ip)).toBe(true);
    }
    expect(checkRateLimit(ip)).toBe(false);
  });

  it('should allow requests up to the custom limit', () => {
    const ip = '192.168.1.3';
    for (let i = 0; i < 5; i++) {
      expect(checkRateLimit(ip, 5, 60000)).toBe(true);
    }
  });

  it('should block requests exceeding the custom limit', () => {
    const ip = '192.168.1.4';
    for (let i = 0; i < 5; i++) {
      expect(checkRateLimit(ip, 5, 60000)).toBe(true);
    }
    expect(checkRateLimit(ip, 5, 60000)).toBe(false);
  });

  it('should allow requests again after the window expires', () => {
    const ip = '192.168.1.5';
    for (let i = 0; i < 20; i++) {
      checkRateLimit(ip, 20, 60000);
    }
    expect(checkRateLimit(ip, 20, 60000)).toBe(false);

    vi.advanceTimersByTime(60001);

    expect(checkRateLimit(ip, 20, 60000)).toBe(true);
  });

  it('should maintain independent limits for different IPs', () => {
    const ip1 = '192.168.1.6';
    const ip2 = '192.168.1.7';

    // Max out IP1
    for (let i = 0; i < 20; i++) {
      expect(checkRateLimit(ip1)).toBe(true);
    }
    expect(checkRateLimit(ip1)).toBe(false);

    // IP2 should still be allowed
    expect(checkRateLimit(ip2)).toBe(true);
  });

  it('should clean up old entries occasionally when map grows too large', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.005); // Force the cleanup condition to be true

    // Fill with entries that will expire quickly
    for (let i = 0; i < 10005; i++) {
      checkRateLimit(`10.0.0.${i}`, 1, 10);
    }

    // Advance time so all of those expire
    vi.advanceTimersByTime(20);

    // Trigger one more check which should trigger the cleanup
    expect(checkRateLimit('10.0.0.99999', 1, 1000)).toBe(true);
  });
});
