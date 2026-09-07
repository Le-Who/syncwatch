import ipaddr from "ipaddr.js";

export function getClientIp(
  xForwardedFor: string | string[] | null | undefined,
): string | null {
  if (!xForwardedFor) return null;

  const headerValue = Array.isArray(xForwardedFor)
    ? xForwardedFor[0]
    : xForwardedFor;

  if (!headerValue) return null;

  const ips = headerValue.split(",").map((ip) => ip.trim());

  // Parse from right to left (skip bogons like internal proxy IPs)
  for (let i = ips.length - 1; i >= 0; i--) {
    const ip = ips[i];
    if (!isBogon(ip)) {
      return ip;
    }
  }

  return null;
}

export function isBogon(ipStr: string): boolean {
  try {
    const ip = ipaddr.process(ipStr);
    const range = ip.range();
    return [
      "private",
      "loopback",
      "linkLocal",
      "multicast",
      "unspecified",
      "carrierGradeNat",
      "broadcast",
      "uniqueLocal",
    ].includes(range);
  } catch (e) {
    // If it can't be parsed, treat it as a potential risk and block it
    return true;
  }
}
