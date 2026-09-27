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
  let forwardedFor: string | null = null;

  if (req?.headers?.get && typeof req.headers.get === "function") {
    forwardedFor = req.headers.get("x-forwarded-for");
  } else if (req?.headers && typeof req.headers === "object") {
    forwardedFor = req.headers["x-forwarded-for"];
  }

  if (!forwardedFor || typeof forwardedFor !== "string") {
    return null;
  }

  const ips = forwardedFor.split(",").map((ip) => ip.trim());
  for (let i = ips.length - 1; i >= 0; i--) {
    if (!isBogon(ips[i])) {
      return ips[i];
    }
  }

  return null;
}
