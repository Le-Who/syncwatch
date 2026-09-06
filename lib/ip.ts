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
  requestOrHeaders: any,
  fallback: string | null = null
): string | null {
  let headerValue: string | null = null;

  if (typeof requestOrHeaders === "string") {
    headerValue = requestOrHeaders;
  } else if (requestOrHeaders && typeof requestOrHeaders.headers?.get === "function") {
    headerValue = requestOrHeaders.headers.get("x-forwarded-for");
  } else if (requestOrHeaders && typeof requestOrHeaders.get === "function") {
    headerValue = requestOrHeaders.get("x-forwarded-for");
  } else if (requestOrHeaders && typeof requestOrHeaders === "object") {
    const val = requestOrHeaders["x-forwarded-for"];
    if (Array.isArray(val)) {
      headerValue = val.join(",");
    } else if (typeof val === "string") {
      headerValue = val;
    }
  }

  if (!headerValue) return fallback;

  const ips = headerValue.split(",").map((ip) => ip.trim()).filter(Boolean);

  if (ips.length === 0) return fallback;

  // parse from right to left
  for (let i = ips.length - 1; i >= 0; i--) {
    if (!isBogon(ips[i])) {
      return ips[i];
    }
  }

  // If all are bogons, return the rightmost one
  return ips[ips.length - 1];
}
