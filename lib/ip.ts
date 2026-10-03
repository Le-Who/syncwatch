import ipaddr from "ipaddr.js";

export function isBogon(ipStr: string): boolean {
  try {
    const ip = ipaddr.process(ipStr);
    const range = ip.range();
    // Only ordinary globally routable unicast may be dialed. Special-use
    // transition/NAT prefixes can otherwise translate into private IPv4.
    return range !== "unicast";
  } catch (e) {
    // If it can't be parsed, treat it as a potential risk and block it
    return true;
  }
}

export type HeaderSource = Pick<Headers, "get"> | Record<string, unknown>;

export function readHeader(headers: HeaderSource, name: string): string | undefined {
  if (typeof (headers as Pick<Headers, "get">).get === "function") {
    return (headers as Pick<Headers, "get">).get(name) ?? undefined;
  }
  const value = (headers as Record<string, unknown>)[name];
  if (Array.isArray(value)) return String(value[0]);
  return typeof value === "string" ? value : undefined;
}

export function getClientIp(headers: HeaderSource): string | null {
  if (process.env.TRUST_PROXY === "true") {
    const forwardedFor = readHeader(headers, "x-forwarded-for");
    if (forwardedFor) {
      const ips = forwardedFor.split(",");
      for (let i = ips.length - 1; i >= 0; i--) {
        const ip = ips[i].trim();
        if (ip && !isBogon(ip)) {
          return ip;
        }
      }
    }
  }
  return null;
}

export function getAppRouteClientIp(headers: HeaderSource): string | null {
  const directAddress = readHeader(headers, "x-syncwatch-client-ip");
  if (process.env.TRUST_PROXY === "true") {
    const forwardedFor = readHeader(headers, "x-forwarded-for");
    if (forwardedFor) {
      const ips = forwardedFor.split(",");
      for (let i = ips.length - 1; i >= 0; i--) {
        const ip = ips[i].trim();
        if (ip && !isBogon(ip)) {
          return ip;
        }
      }
    }
  }
  return directAddress || null;
}
