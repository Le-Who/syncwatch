import ipaddr from "ipaddr.js";

export function getClientIp(requestOrHeaders: any): string | null {
  if (!requestOrHeaders) return null;

  let headerValue: string | null = null;

  if (requestOrHeaders.headers && typeof requestOrHeaders.headers.get === 'function') {
    headerValue = requestOrHeaders.headers.get('x-forwarded-for');
  } else if (typeof requestOrHeaders.get === 'function') {
    headerValue = requestOrHeaders.get('x-forwarded-for');
  } else if (requestOrHeaders.headers && typeof requestOrHeaders.headers === 'object') {
    const val = requestOrHeaders.headers['x-forwarded-for'];
    headerValue = Array.isArray(val) ? val.join(',') : val || null;
  } else if (typeof requestOrHeaders === 'object') {
    const val = requestOrHeaders['x-forwarded-for'];
    headerValue = Array.isArray(val) ? val.join(',') : typeof val === 'string' ? val : null;
  }

  if (!headerValue) {
    return requestOrHeaders.socket?.remoteAddress || null;
  }

  const ips = headerValue.split(',').map(ip => ip.trim()).filter(Boolean);

  for (let i = ips.length - 1; i >= 0; i--) {
    const ip = ips[i];
    if (!isBogon(ip)) {
      return ip;
    }
  }

  return requestOrHeaders.socket?.remoteAddress || null;
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
