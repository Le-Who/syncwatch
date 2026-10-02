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

export function getClientIp(reqOrHeaders: any): string | null {
  if (!reqOrHeaders) return null;

  let xff: any = null;

  if (typeof reqOrHeaders.headers?.get === "function") {
    xff = reqOrHeaders.headers.get("x-forwarded-for");
  } else if (reqOrHeaders.headers && typeof reqOrHeaders.headers === "object") {
    xff = reqOrHeaders.headers["x-forwarded-for"];
  } else if (typeof reqOrHeaders.get === "function") {
    xff = reqOrHeaders.get("x-forwarded-for");
  } else if (typeof reqOrHeaders === "object") {
    xff = reqOrHeaders["x-forwarded-for"];
  }

  if (typeof xff !== "string" || !xff.trim()) {
    return null;
  }

  const ips = xff
    .split(",")
    .map((ip) => ip.trim())
    .filter(Boolean);

  // Parse from right to left, skipping bogons
  for (let i = ips.length - 1; i >= 0; i--) {
    const ip = ips[i];
    if (!isBogon(ip)) {
      return ip;
    }
  }

  return null;
}
