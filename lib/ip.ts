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

export function getClientIp(req: Request | { headers: any }): string | null {
  let xff: string | null = null;

  if (req instanceof Request) {
    xff = req.headers.get("x-forwarded-for");
  } else if (req && req.headers && typeof req.headers.get === "function") {
    xff = req.headers.get("x-forwarded-for");
  } else if (req && req.headers && typeof req.headers === "object") {
    const val = req.headers["x-forwarded-for"];
    if (Array.isArray(val)) {
      xff = val.join(",");
    } else if (typeof val === "string") {
      xff = val;
    }
  }

  if (!xff) return null;

  const ips = xff.split(",").map((ip) => ip.trim());
  for (let i = ips.length - 1; i >= 0; i--) {
    const ip = ips[i];
    if (!ip) continue;
    if (!isBogon(ip)) {
      return ip;
    }
  }

  return null;
}
