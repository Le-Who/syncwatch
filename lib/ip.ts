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
  let xff: string | null | undefined;

  if (request.headers && typeof request.headers.get === "function") {
    xff = request.headers.get("x-forwarded-for");
  } else if (request.headers) {
    xff = request.headers["x-forwarded-for"];
  }

  if (typeof xff === "string" && xff.length > 0) {
    const ips = xff.split(",").map((ip) => ip.trim());
    for (let i = ips.length - 1; i >= 0; i--) {
      if (!isBogon(ips[i])) {
        return ips[i];
      }
    }
  } else if (Array.isArray(xff) && xff.length > 0) {
    const ips = (xff[0] as string).split(",").map((ip) => ip.trim());
    for (let i = ips.length - 1; i >= 0; i--) {
      if (!isBogon(ips[i])) {
        return ips[i];
      }
    }
  }
  return null;
}
