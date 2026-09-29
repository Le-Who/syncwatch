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

export function getClientIp(request: any): string | null {
  let headerValue: string | string[] | null | undefined = null;

  if (request?.headers) {
    if (typeof request.headers.get === "function") {
      headerValue = request.headers.get("x-forwarded-for");
    } else {
      headerValue = request.headers["x-forwarded-for"];
    }
  }

  if (!headerValue) return null;

  const ips = Array.isArray(headerValue)
    ? headerValue.flatMap((h) => h.split(","))
    : headerValue.split(",");

  for (let i = ips.length - 1; i >= 0; i--) {
    const ip = ips[i].trim();
    if (ip && !isBogon(ip)) {
      return ip;
    }
  }

  return null;
}
