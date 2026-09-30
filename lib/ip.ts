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

export function getClientIp(requestOrHeaders: any): string | null {
  let forwardedFor: string | null | undefined = null;

  if (!requestOrHeaders) return null;

  if (typeof requestOrHeaders === "string") {
    forwardedFor = requestOrHeaders;
  } else if (
    requestOrHeaders.headers &&
    typeof requestOrHeaders.headers.get === "function"
  ) {
    forwardedFor = requestOrHeaders.headers.get("x-forwarded-for");
  } else if (requestOrHeaders.headers) {
    const header = requestOrHeaders.headers["x-forwarded-for"];
    forwardedFor = Array.isArray(header) ? header.join(",") : header;
  } else if (typeof requestOrHeaders.get === "function") {
    forwardedFor = requestOrHeaders.get("x-forwarded-for");
  } else {
    const header = requestOrHeaders["x-forwarded-for"];
    if (header) {
      forwardedFor = Array.isArray(header) ? header.join(",") : header;
    }
  }

  if (!forwardedFor) return null;

  const ips = forwardedFor
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
