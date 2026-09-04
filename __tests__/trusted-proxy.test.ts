import { describe, expect, it } from "vitest";

import { createTrustedForwardedAddressResolver } from "../e2e/trusted-proxy";

describe("test trusted-proxy client isolation", () => {
  it("assigns unique forwarded addresses only to valid independent context IDs", () => {
    const resolveAddress = createTrustedForwardedAddressResolver();

    expect(resolveAddress("not-a-context-id")).toBeNull();
    expect(resolveAddress(undefined)).toBeNull();
    expect(resolveAddress("01890f3e-4c4d-7cc2-8d8c-123456789398")).toBe(
      "203.0.113.1",
    );
    expect(resolveAddress("01890f3e-4c4d-7cc2-8d8c-123456789399")).toBe(
      "203.0.113.2",
    );
    expect(resolveAddress("01890f3e-4c4d-7cc2-8d8c-123456789398")).toBe(
      "203.0.113.1",
    );
  });
});
