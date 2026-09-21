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

export function getClientIp(reqOrHeader: any): string | null {
  let xff: string | null = null;

  if (typeof reqOrHeader === "string") {
    xff = reqOrHeader;
  } else if (reqOrHeader) {
    if (typeof reqOrHeader.headers?.get === "function") {
      xff = reqOrHeader.headers.get("x-forwarded-for");
    } else if (reqOrHeader.handshake?.headers?.["x-forwarded-for"]) {
      const val = reqOrHeader.handshake.headers["x-forwarded-for"];
      xff = Array.isArray(val) ? val.join(",") : val;
    } else if (reqOrHeader.headers?.["x-forwarded-for"]) {
      xff = reqOrHeader.headers["x-forwarded-for"];
    }
  }

  if (!xff) return null;

  const ips = xff
    .split(",")
    .map((ip) => ip.trim())
    .filter(Boolean);

  for (let i = ips.length - 1; i >= 0; i--) {
    if (!isBogon(ips[i])) {
      return ips[i];
    }
  }

  return null;
}
