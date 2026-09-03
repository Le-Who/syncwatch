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

export function getClientIp(req: any): string {
  const isSocket = !!req.handshake;
  const headers = isSocket ? req.handshake.headers : req.headers;
  const fallbackIp =
    req.ip ||
    (isSocket ? req.handshake.address : req.socket?.remoteAddress) ||
    "unknown";

  const getHeader = (key: string): string | null => {
    if (!headers) return null;
    if (typeof headers.get === "function") return headers.get(key) as string;
    const val = headers[key];
    return Array.isArray(val) ? val[0] : (val as string) || null;
  };

  const trueClient =
    getHeader("true-client-ip") || getHeader("cf-connecting-ip");
  if (trueClient) {
    return trueClient.split(",")[0].trim();
  }

  const forwardedFor = getHeader("x-forwarded-for");
  if (forwardedFor) {
    const ips = forwardedFor
      .split(",")
      .map((i) => i.trim())
      .filter(Boolean);
    for (let i = ips.length - 1; i >= 0; i--) {
      if (!isBogon(ips[i])) {
        return ips[i];
      }
    }
    return ips[0];
  }

  const realIp = getHeader("x-real-ip");
  if (realIp) return realIp;

  return fallbackIp;
}
