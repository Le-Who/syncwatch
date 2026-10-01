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

export function getClientIp(requestOrHeaders: any): string | null {
  const forwardedFor =
    typeof requestOrHeaders?.get === "function"
      ? requestOrHeaders.get("x-forwarded-for")
      : requestOrHeaders?.["x-forwarded-for"];
  if (forwardedFor && typeof forwardedFor === "string") {
    const ips = forwardedFor.split(",").map((ip: string) => ip.trim());
    // traverse from right to left
    for (let i = ips.length - 1; i >= 0; i--) {
      const ip = ips[i];
      if (!isBogon(ip)) {
        return ip;
      }
    }
  }
  return null;
}
