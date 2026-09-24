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

export function getClientIp(reqOrHeaders: any): string | null {
  let forwardedFor: string | null = null;

  if (reqOrHeaders?.headers && typeof reqOrHeaders.headers.get === "function") {
    forwardedFor = reqOrHeaders.headers.get("x-forwarded-for");
  } else if (typeof reqOrHeaders?.get === "function") {
    forwardedFor = reqOrHeaders.get("x-forwarded-for");
  } else if (reqOrHeaders?.["x-forwarded-for"]) {
    forwardedFor = typeof reqOrHeaders["x-forwarded-for"] === "string"
      ? reqOrHeaders["x-forwarded-for"]
      : Array.isArray(reqOrHeaders["x-forwarded-for"])
        ? reqOrHeaders["x-forwarded-for"][0]
        : null;
  }

  if (!forwardedFor) {
    return null;
  }

  const ips = forwardedFor.split(",").map((ip: string) => ip.trim()).filter(Boolean);
  for (let i = ips.length - 1; i >= 0; i--) {
    if (!isBogon(ips[i])) {
      return ips[i];
    }
  }

  return null;
}
