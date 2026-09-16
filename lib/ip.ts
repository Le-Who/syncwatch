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

export function getClientIp(requestOrHeaders: any): string {
  let xForwardedFor = "";
  let remoteAddress = "";

  if (requestOrHeaders.headers && typeof requestOrHeaders.headers.get === "function") {
    // NextRequest or Request object
    xForwardedFor = requestOrHeaders.headers.get("x-forwarded-for") || "";
  } else if (typeof requestOrHeaders.get === "function") {
    // Headers object
    xForwardedFor = requestOrHeaders.get("x-forwarded-for") || "";
  } else if (requestOrHeaders.headers) {
    // HTTP Request or Socket.io handshake
    xForwardedFor = requestOrHeaders.headers["x-forwarded-for"] || "";
    remoteAddress = requestOrHeaders.socket?.remoteAddress || requestOrHeaders.address || "";
  } else {
    // Plain object (headers)
    xForwardedFor = requestOrHeaders["x-forwarded-for"] || "";
  }

  if (Array.isArray(xForwardedFor)) {
      xForwardedFor = xForwardedFor.join(",");
  }

  if (xForwardedFor) {
    const ips = xForwardedFor.split(",").map((ip) => ip.trim());
    // Iterate from right to left (most trusted to least trusted)
    for (let i = ips.length - 1; i >= 0; i--) {
      const ip = ips[i];
      if (ip && !isBogon(ip)) {
        return ip;
      }
    }
  }

  return remoteAddress || "unknown";
}
