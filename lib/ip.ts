import ipaddr from "ipaddr.js";

export function getClientIp(reqOrSocket: any): string | null {
  let forwardedFor: string | null = null;

  if (reqOrSocket?.headers?.get) {
    // Next.js Request object
    forwardedFor = reqOrSocket.headers.get("x-forwarded-for");
  } else if (reqOrSocket?.handshake?.headers) {
    // Socket.io Socket object
    forwardedFor = reqOrSocket.handshake.headers["x-forwarded-for"] as string;
  }

  if (forwardedFor) {
    // Parse the comma-separated list from right to left
    const ips = forwardedFor.split(",").map((ip) => ip.trim());
    for (let i = ips.length - 1; i >= 0; i--) {
      const ip = ips[i];
      if (ip && !isBogon(ip)) {
        return ip;
      }
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
