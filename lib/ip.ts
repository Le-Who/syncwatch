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

export function getClientIp(headerStr: string | null | undefined): string | null {
  if (!headerStr) return null;
  const ips = headerStr.split(',').map(s => s.trim());
  for (let i = ips.length - 1; i >= 0; i--) {
    const ip = ips[i];
    if (!isBogon(ip)) {
      return ip;
    }
  }
  return null;
}
