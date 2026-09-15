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
  remoteAddress: string | null | undefined,
): string | null {
  if (forwardedFor) {
    const ips = forwardedFor.split(",").map((ip) => ip.trim());
    for (let i = ips.length - 1; i >= 0; i--) {
      if (!isBogon(ips[i])) {
        return ips[i];
      }
    }
  }

  if (remoteAddress && !isBogon(remoteAddress)) {
    return remoteAddress;
  }

  return null;
}
