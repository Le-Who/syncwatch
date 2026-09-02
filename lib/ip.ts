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

export function getClientIp(request: Request | any): string {
  // Try to safely extract the real client IP, ignoring forged x-forwarded-for
  // if not from a trusted proxy or taking the rightmost IP as the most trusted.
  let forwardedFor = null;
  if (request.headers && typeof request.headers.get === "function") {
    forwardedFor = request.headers.get("x-forwarded-for");
  } else if (request.headers && request.headers["x-forwarded-for"]) {
    forwardedFor = request.headers["x-forwarded-for"];
  }

  if (forwardedFor && typeof forwardedFor === "string") {
    const ips = forwardedFor.split(",").map((i: string) => i.trim());
    // The rightmost IP is added by the last proxy (the one closest to our server).
    // Since a client can spoof 'X-Forwarded-For: fake-ip', the proxy will append the real IP: 'fake-ip, real-ip'.
    // Therefore, the rightmost IP is the actual IP of the connection that hit the proxy.
    if (ips.length > 0) {
      return ips[ips.length - 1];
    }
  }

  if (request.socket && request.socket.remoteAddress) {
    return request.socket.remoteAddress;
  }

  if (request.address) {
    return request.address;
  }

  return "unknown";
}
