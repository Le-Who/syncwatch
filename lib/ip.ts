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

export function getClientIp(requestOrSocket: any): string | null {
  let forwardedFor: string | null = null;

  if (requestOrSocket && typeof requestOrSocket.headers?.get === 'function') {
    forwardedFor = requestOrSocket.headers.get("x-forwarded-for");
  } else if (requestOrSocket?.headers?.['x-forwarded-for']) {
    forwardedFor = requestOrSocket.headers['x-forwarded-for'];
  } else if (requestOrSocket?.handshake?.headers?.['x-forwarded-for']) {
    forwardedFor = requestOrSocket.handshake.headers['x-forwarded-for'];
  }

  if (forwardedFor) {
    const ips = forwardedFor.split(',').map((ip: string) => ip.trim());
    for (let i = ips.length - 1; i >= 0; i--) {
      if (!isBogon(ips[i])) {
        return ips[i];
      }
    }
  }

  return null;
}
