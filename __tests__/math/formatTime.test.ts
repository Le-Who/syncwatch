import { describe, it, expect } from "vitest";
import { formatTime } from "../../lib/utils";

describe("formatTime (lib/utils.ts)", () => {
  it("formats 0 seconds correctly", () => {
    expect(formatTime(0)).toBe("0:00");
  });

  it("formats less than 1 minute correctly", () => {
    expect(formatTime(45)).toBe("0:45");
    expect(formatTime(9)).toBe("0:09");
  });

  it("formats exactly 1 minute correctly", () => {
    expect(formatTime(60)).toBe("1:00");
  });

  it("formats more than 1 minute, less than 1 hour correctly", () => {
    expect(formatTime(65)).toBe("1:05");
    expect(formatTime(3599)).toBe("59:59");
  });

  it("formats exactly 1 hour correctly", () => {
    expect(formatTime(3600)).toBe("1:00:00");
  });

  it("formats more than 1 hour correctly", () => {
    expect(formatTime(3665)).toBe("1:01:05");
    expect(formatTime(7200)).toBe("2:00:00");
    expect(formatTime(7265)).toBe("2:01:05");
  });

  it("handles edge case: undefined", () => {
    expect(formatTime(undefined)).toBe("0:00");
  });

  it("handles edge case: null", () => {
    expect(formatTime(null)).toBe("0:00");
  });

  it("handles edge case: negative numbers", () => {
    expect(formatTime(-10)).toBe("0:00");
    expect(formatTime(-3600)).toBe("0:00");
  });

  it("handles edge case: NaN", () => {
    expect(formatTime(NaN)).toBe("0:00");
  });

  it("handles fractional seconds (should be rounded down)", () => {
    expect(formatTime(65.9)).toBe("1:05");
    expect(formatTime(0.9)).toBe("0:00");
  });
});
