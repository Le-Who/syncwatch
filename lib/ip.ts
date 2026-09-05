import ipaddr from "ipaddr.js";

export function isBogon(ipStr: string): boolean {
  try {
    if (!ipStr) return true;
    const ipStrClean = ipStr.trim();
    if (!ipStrClean) return true;
    const ip = ipaddr.process(ipStrClean);
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
  xForwardedFor: string | null | undefined | string[],
  socketAddress: string | null | undefined = null,
): string {
  // If we have an X-Forwarded-For header, parse it
  if (xForwardedFor) {
    let headerStr = "";
    if (Array.isArray(xForwardedFor)) {
      headerStr = xForwardedFor.join(",");
    } else {
      headerStr = xForwardedFor;
    }

    if (headerStr) {
      // Parse X-Forwarded-For from right to left (skip bogons, find first public IP)
      const ips = headerStr
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s);
      for (let i = ips.length - 1; i >= 0; i--) {
        const ip = ips[i];
        if (!isBogon(ip)) {
          return ip;
        }
      }
    }
  }

  // Fallback to socket address if no public IP found in X-Forwarded-For
  if (socketAddress && !isBogon(socketAddress)) {
    return socketAddress;
  }

  // If all else fails or even socket address is a bogon, just return it or "unknown"
  if (socketAddress) {
    return socketAddress;
  }

  return "unknown";
}
