import ipaddr from "ipaddr.js";

export function isBogon(ipStr: string): boolean {
  try {
    const ip = ipaddr.process(ipStr);
    const range = ip.range();
    // Only ordinary globally routable unicast may be dialed. Special-use
    // transition/NAT prefixes can otherwise translate into private IPv4.
    return range !== "unicast";
  } catch (e) {
    // If it can't be parsed, treat it as a potential risk and block it
    return true;
  }
}
