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
  forwardedFor: string | string[] | undefined | null,
): string | null {
  if (!forwardedFor) return null;

  const joinedStr = Array.isArray(forwardedFor)
    ? forwardedFor.join(",")
    : forwardedFor;
  const parts = joinedStr
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  for (let i = parts.length - 1; i >= 0; i--) {
    const ip = parts[i];
    if (!isBogon(ip)) {
      return ip;
    }
  }
  return null;
}
