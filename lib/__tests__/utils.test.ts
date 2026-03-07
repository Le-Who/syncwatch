import { describe, it, expect } from "vitest";
import { formatTime, calculateDrift } from "../utils";

describe("formatTime", () => {
  it("should format seconds under a minute correctly", () => {
    expect(formatTime(45)).toBe("0:45");
    expect(formatTime(9)).toBe("0:09");
  });

  it("should format exact minutes without hours", () => {
    expect(formatTime(120)).toBe("2:00");
    expect(formatTime(60)).toBe("1:00");
  });

  it("should format minutes and seconds combined", () => {
    expect(formatTime(125)).toBe("2:05");
    expect(formatTime(3599)).toBe("59:59");
  });

  it("should include hours when duration exceeds 60 minutes", () => {
    expect(formatTime(3600)).toBe("1:00:00");
    expect(formatTime(7265)).toBe("2:01:05");
  });

  it("should handle edge cases like negative values or NaN gracefully", () => {
    expect(formatTime(-10)).toBe("0:00");
    expect(formatTime(NaN)).toBe("0:00");
    expect(formatTime(undefined)).toBe("0:00");
    expect(formatTime(null as any)).toBe("0:00");
    expect(formatTime(0)).toBe("0:00");
  });

  it("should appropriately round down floating point seconds", () => {
    expect(formatTime(45.9)).toBe("0:45");
  });
});

describe("calculateDrift", () => {
  it("should calculate zero drift when paused and perfectly in sync", () => {
    const result = calculateDrift(
      "paused",
      10.0,
      Date.now(),
      Date.now(),
      10.0,
      1.0,
    );
    expect(result.drift).toBe(0);
    expect(result.expectedPosition).toBe(10.0);
  });

  it("should identify drift when paused but local player is further ahead/behind", () => {
    const result = calculateDrift(
      "paused",
      10.0,
      Date.now(),
      Date.now(),
      15.0,
      1.0,
    );
    expect(result.drift).toBe(5.0); // Absolute value check
    expect(result.expectedPosition).toBe(10.0); // Baseline expects 10.0
  });

  it("should calculate correct playing drift by adding elapsed server time", () => {
    const baseTime = 100000;
    const currentTime = 105000; // 5 seconds later

    // Server says we started at 10.0s, 5 seconds ago
    // Local player thinks it's at 12.0s
    // Therefore expected is 15.0s, and drift is 3 seconds
    const result = calculateDrift(
      "playing",
      10.0,
      baseTime,
      currentTime,
      12.0,
      1.0,
    );
    expect(result.drift).toBe(3.0);
    expect(result.expectedPosition).toBe(15.0);
  });

  it("should scale the projected time drift correctly if payback rate is 2x", () => {
    const baseTime = 100000;
    const currentTime = 105000; // 5 seconds later

    // At 2x speed, 5 seconds of real time is 10 seconds of video time.
    // Base 10 + 10 = 20s expected
    // Local is at 20s. Drift = 0.
    const result = calculateDrift(
      "playing",
      10.0,
      baseTime,
      currentTime,
      20.0,
      2.0,
    );
    expect(result.drift).toBe(0.0);
    expect(result.expectedPosition).toBe(20.0);
  });
});
