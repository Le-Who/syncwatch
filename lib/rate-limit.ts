import ipaddr from "ipaddr.js";

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

type HeaderSource = Pick<Headers, "get"> | Record<string, unknown>;

function readHeader(headers: HeaderSource, name: string): string | undefined {
  if (typeof (headers as Pick<Headers, "get">).get === "function") {
    return (headers as Pick<Headers, "get">).get(name) ?? undefined;
  }
  const value = (headers as Record<string, unknown>)[name];
  if (Array.isArray(value)) return String(value[0]);
  return typeof value === "string" ? value : undefined;
}

function parseForwardedFor(forwardedFor: string | undefined): string | null {
  if (!forwardedFor) return null;
  const ips = forwardedFor.split(",").map((ip) => ip.trim());
  for (let i = ips.length - 1; i >= 0; i--) {
    const ipStr = ips[i];
    if (!ipaddr.isValid(ipStr)) continue;
    try {
      let parsed = ipaddr.parse(ipStr);
      if (
        parsed.kind() === "ipv6" &&
        (parsed as ipaddr.IPv6).isIPv4MappedAddress()
      ) {
        parsed = (parsed as ipaddr.IPv6).toIPv4Address();
      }
      const range = parsed.range();
      if (
        range !== "private" &&
        range !== "loopback" &&
        range !== "linkLocal"
      ) {
        return ipStr;
      }
    } catch {
      // Ignore parsing errors
    }
  }
  return null;
}

export function getClientIp(
  headers: HeaderSource,
  directAddress: string = "unknown",
): string {
  if (process.env.TRUST_PROXY === "true") {
    const forwardedFor = readHeader(headers, "x-forwarded-for");
    const parsedIp = parseForwardedFor(forwardedFor);
    if (parsedIp) return parsedIp;
  }
  return directAddress || "unknown";
}

/**
 * App Routes do not expose a peer address. The custom server sets this private
 * header immediately before delegating to Next; Socket.IO must instead pass its
 * peer address directly to `getClientIp` and never consume this header.
 */
export function getAppRouteClientIp(headers: HeaderSource): string {
  const directAddress =
    readHeader(headers, "x-syncwatch-client-ip") || "unknown";
  if (process.env.TRUST_PROXY === "true") {
    const forwardedFor = readHeader(headers, "x-forwarded-for");
    const parsedIp = parseForwardedFor(forwardedFor);
    if (parsedIp) return parsedIp;
  }
  return directAddress;
}
