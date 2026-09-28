import ipaddr from "ipaddr.js";

export function getClientIp(request: any): string | null {
  if (!request) return null;

  let headerValue = "";

  if (request.headers && typeof request.headers.get === "function") {
    headerValue = request.headers.get("x-forwarded-for") || "";
  } else if (request.handshake && request.handshake.headers) {
    const val = request.handshake.headers["x-forwarded-for"];
    headerValue = Array.isArray(val) ? val.join(",") : (val || "");
  } else if (request.headers) {
    const val = request.headers["x-forwarded-for"];
    headerValue = Array.isArray(val) ? val.join(",") : (val || "");
  }

  if (!headerValue) return null;

  const ips = headerValue.split(",").map((ip: string) => ip.trim()).filter(Boolean);

  for (let i = ips.length - 1; i >= 0; i--) {
    if (!isBogon(ips[i])) {
      return ips[i];
    }
  }

  return null;
}

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
