import ipaddr from "ipaddr.js";

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

export function getClientIp(
  forwardedFor: string | null | undefined,
): string | null {
  if (!forwardedFor) return null;

  const ips = forwardedFor.split(",").map((ip) => ip.trim());

  // Parse from right to left (most trusted to least trusted)
  // Skip bogons (private IPs, etc. which are often internal proxies)
  for (let i = ips.length - 1; i >= 0; i--) {
    const ip = ips[i];
    if (ip && !isBogon(ip)) {
      return ip;
    }
  }

  return null;
}
