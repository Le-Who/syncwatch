interface RateLimitRecord {
  count: number;
  resetTime: number;
}

export interface InMemoryRateLimiter {
  check(identifier: string, limit: number, windowMs: number): boolean;
}

export function createInMemoryRateLimiter(options?: {
  now?: () => number;
  maxKeys?: number;
}): InMemoryRateLimiter {
  const now = options?.now ?? (() => Date.now());
  const maxKeys = options?.maxKeys ?? 10_000;
  const records = new Map<string, RateLimitRecord>();

  function removeExpired(currentTime: number) {
    for (const [key, record] of records) {
      if (record.resetTime <= currentTime) records.delete(key);
    }
  }

  return {
    check(identifier, limit, windowMs) {
      const currentTime = now();
      const record = records.get(identifier);

      if (!record || record.resetTime <= currentTime) {
        if (!record && records.size >= maxKeys) {
          removeExpired(currentTime);
          if (records.size >= maxKeys) {
            const oldestKey = records.keys().next().value as string | undefined;
            if (oldestKey) records.delete(oldestKey);
          }
        }
        records.delete(identifier);
        records.set(identifier, {
          count: 1,
          resetTime: currentTime + windowMs,
        });
        return true;
      }

      if (record.count >= limit) return false;
      record.count++;
      return true;
    },
  };
}

const defaultLimiter = createInMemoryRateLimiter();

export function checkRateLimit(
  ip: string,
  limit: number = 20,
  windowMs: number = 60_000,
): boolean {
  return defaultLimiter.check(ip, limit, windowMs);
}

