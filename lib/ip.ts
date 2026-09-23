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

export function getClientIp(req: any): string | null {
  let headerValue: string | null = null;

  if (req?.headers && typeof req.headers.get === "function") {
    // Standard Request or NextRequest
    headerValue = req.headers.get("x-forwarded-for");
  } else if (req?.headers && typeof req.headers === "object") {
    // Node.js IncomingMessage or Socket.IO handshake
    const val = req.headers["x-forwarded-for"];
    headerValue = Array.isArray(val) ? val.join(",") : val;
  } else if (typeof req?.get === "function") {
    headerValue = req.get("x-forwarded-for");
  }

  if (!headerValue) {
    return null;
  }

  const ips = headerValue
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
