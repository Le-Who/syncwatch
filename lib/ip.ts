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
  let forwardedFor = null;

  if (req.headers && typeof req.headers.get === 'function') {
    forwardedFor = req.headers.get('x-forwarded-for');
  } else if (req.headers) {
    forwardedFor = req.headers['x-forwarded-for'];
  } else if (req.handshake && req.handshake.headers) {
    forwardedFor = req.handshake.headers['x-forwarded-for'];
  }

  if (typeof forwardedFor === 'string') {
    const ips = forwardedFor.split(',').map((ip: string) => ip.trim());
    for (let i = ips.length - 1; i >= 0; i--) {
      const ip = ips[i];
      if (!isBogon(ip)) {
        return ip;
      }
    }
  }

  return null;
}
