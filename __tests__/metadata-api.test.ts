import { describe, it, expect } from "vitest";
import { isBogon } from "../lib/ip";

describe("isBogon Helper", () => {
  it("TC-BOGON-01: Correctly identifies private IPs", () => {
    // IPv4 Private
    expect(isBogon("10.0.0.1")).toBe(true);
    expect(isBogon("172.16.0.1")).toBe(true);
    expect(isBogon("192.168.1.1")).toBe(true);

    // IPv6 Unique Local Address
    expect(isBogon("fc00::1")).toBe(true);
    expect(isBogon("fd12:3456:789a:1::1")).toBe(true);
  });

  it("TC-BOGON-02: Correctly identifies loopback addresses", () => {
    // IPv4 Loopback
    expect(isBogon("127.0.0.1")).toBe(true);
    expect(isBogon("127.255.255.254")).toBe(true);

    // IPv6 Loopback
    expect(isBogon("::1")).toBe(true);
  });

  it("TC-BOGON-03: Correctly identifies other restricted ranges", () => {
    // Link Local
    expect(isBogon("169.254.169.254")).toBe(true); // AWS Metadata endpoint
    expect(isBogon("fe80::1ff:fe23:4567:890a")).toBe(true);

    // Multicast
    expect(isBogon("224.0.0.1")).toBe(true);
    expect(isBogon("ff02::1")).toBe(true);

    // Broadcast
    expect(isBogon("255.255.255.255")).toBe(true);

    // Unspecified
    expect(isBogon("0.0.0.0")).toBe(true);
    expect(isBogon("::")).toBe(true);

    // Carrier Grade NAT
    expect(isBogon("100.64.1.1")).toBe(true);
  });

  it("TC-BOGON-04: Allows valid public IPs", () => {
    // Google DNS
    expect(isBogon("8.8.8.8")).toBe(false);
    expect(isBogon("8.8.4.4")).toBe(false);

    // Cloudflare DNS
    expect(isBogon("1.1.1.1")).toBe(false);

    // IPv6 Public
    expect(isBogon("2001:4860:4860::8888")).toBe(false);
    expect(isBogon("2606:4700:4700::1111")).toBe(false);
  });

  it("TC-BOGON-05: Fails safely (returns true) for invalid inputs", () => {
    expect(isBogon("not-an-ip")).toBe(true);
    expect(isBogon("999.999.999.999")).toBe(true);
    expect(isBogon("")).toBe(true);
    expect(isBogon("127.0.0.1.5")).toBe(true);
  });
});
