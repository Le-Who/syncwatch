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

export function getClientIp(req: any): string {
  let forwarded = null;

  if (req.headers && typeof req.headers.get === 'function') {
    forwarded = req.headers.get('x-forwarded-for');
  } else if (req.handshake && req.handshake.headers && req.handshake.headers['x-forwarded-for']) {
    forwarded = req.handshake.headers['x-forwarded-for'];
  } else if (req.headers && req.headers['x-forwarded-for']) {
    forwarded = req.headers['x-forwarded-for'];
  }

  if (forwarded) {
    let parts: string[] = [];
    if (typeof forwarded === 'string') {
        parts = forwarded.split(',');
    } else if (Array.isArray(forwarded) && forwarded.length > 0) {
        parts = forwarded[0].split(',');
    }

    // Traverse the list from right to left (most trusted proxy to client)
    // and find the first IP that is NOT a bogon (private, loopback, etc.)
    // If all IPs are bogons or the list is empty, we fall back to the rightmost IP.
    // This correctly handles multiple untrusted proxies spoofing the header,
    // and correctly identifies the client IP if it's public.
    if (parts.length > 0) {
        let clientIp = parts[parts.length - 1].trim(); // Fallback to rightmost

        for (let i = parts.length - 1; i >= 0; i--) {
            const currentIp = parts[i].trim();
            if (!isBogon(currentIp)) {
                clientIp = currentIp;
                break;
            }
        }
        return clientIp;
    }
  }

  if (req.socket && req.socket.remoteAddress) {
    return req.socket.remoteAddress;
  }
  if (req.handshake && req.handshake.address) {
    return req.handshake.address;
  }
  if (req.ip) return req.ip;
  if (req.address) return req.address;

  return 'unknown';
}
