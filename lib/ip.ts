import ipaddr from "ipaddr.js";

export function isBogon(ipStr: string): boolean {
  try {
    const ip = ipaddr.process(ipStr);
    const range = ip.range();
    return range !== "unicast";
  } catch (e) {
    return true;
  }
}
