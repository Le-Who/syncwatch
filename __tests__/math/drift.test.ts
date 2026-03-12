import { describe, it, expect } from "vitest";
import { calculatePlaybackRate } from "../../lib/drift-math";
import { calculateDrift } from "../../lib/utils";

describe("Calculate Drift (lib/utils.ts)", () => {
  it("TC-01: Correctly calculates expected position when playing", () => {
    // Media was at 10.0 seconds at server time 1000. It is now 1500. Rate is 1.0.
    // It should be at 10.5 seconds.
    const { expectedPosition, drift } = calculateDrift(
      "playing",
      10.0,
      1000,
      1500,
      // Local position is 10.2 (we are 300ms behind the expected 10.5)
      10.2,
      1.0,
    );

    expect(expectedPosition).toBe(10.5);
    expect(drift).toBeCloseTo(0.3, 2);
  });

  it("TC-02: Reflects basePosition directly if paused without advancing", () => {
    const { expectedPosition, drift } = calculateDrift(
      "paused",
      10.0,
      1000,
      1500,
      10.8, // Local position kept drifting (ReactPlayer bug)
      1.0,
    );

    expect(expectedPosition).toBe(10.0);
    // Drift is expected position (10.0) compared to local (10.8) -> 0.8s
    expect(drift).toBeCloseTo(0.8, 2);
  });
});

describe("Playback Rate Adjustment (lib/drift-math.ts)", () => {
  const SERVER_RATE = 1.0;

  it("TC-03: Ignores adjustment if buffering", () => {
    const { rate } = calculatePlaybackRate(
      1.0,
      10.0,
      11.0,
      SERVER_RATE,
      true,
      false,
    );
    expect(rate).toBe(1.0);
  });

  it("TC-04: Ignores adjustment for iframe providers (YouTube, Twitch, Vimeo)", () => {
    // Iframes manage their own low-level clock buffering, we shouldn't pitch-shift them
    const { rate } = calculatePlaybackRate(
      1.0,
      10.0,
      11.0,
      SERVER_RATE,
      false,
      true,
    );
    expect(rate).toBe(1.0);
  });

  it("TC-05: Returns to normal rate if drift is MASSIVE (> 3 seconds)", () => {
    // Huge drift -> hard seek is incoming. Do not speed up to 1.05.
    const { rate } = calculatePlaybackRate(
      4.5,
      10.0,
      14.5,
      SERVER_RATE,
      false,
      false,
    );
    expect(rate).toBe(1.0);
  });

  it("TC-06: ACCELERATES playback if local position is BEHIND expected position (drift > 0.6s, not previously adjusting)", () => {
    // Expected = 12.0s. Local = 11.0s. Drift = 1.0s. Not previously adjusting.
    // Hysteresis: starts at 0.6s when not previously adjusting.
    const { rate, isAdjusting } = calculatePlaybackRate(
      1.0,
      11.0,
      12.0,
      SERVER_RATE,
      false,
      false,
    );
    expect(rate).toBe(1.05);
    expect(isAdjusting).toBe(true);
  });

  it("TC-07: DECELERATES playback if local position is AHEAD of expected position (drift > 0.6s)", () => {
    // Expected = 11.0s. Local = 12.0s. Drift = 1.0s.
    const { rate, isAdjusting } = calculatePlaybackRate(
      1.0,
      12.0,
      11.0,
      SERVER_RATE,
      false,
      false,
    );
    expect(rate).toBe(0.95);
    expect(isAdjusting).toBe(true);
  });

  it("TC-08: EXACT sync returns normal rate", () => {
    // Drift = 0.1s (which is < 0.3 threshold)
    const { rate } = calculatePlaybackRate(
      0.1,
      10.0,
      10.1,
      SERVER_RATE,
      false,
      false,
    );
    expect(rate).toBe(1.0);
  });

  // Hysteresis tests
  it("TC-09: Does NOT start correction at 0.5s drift when not previously adjusting (hysteresis)", () => {
    // Drift = 0.55s, below the 0.6s start threshold
    const { rate, isAdjusting } = calculatePlaybackRate(
      0.55,
      10.0,
      10.55,
      SERVER_RATE,
      false,
      false,
      undefined,
      false,
    );
    expect(rate).toBe(1.0);
    expect(isAdjusting).toBe(false);
  });

  it("TC-10: CONTINUES correction at 0.4s drift when previously adjusting (hysteresis)", () => {
    // Drift = 0.4s, above the 0.3s stop threshold, previously adjusting
    const { rate, isAdjusting } = calculatePlaybackRate(
      0.4,
      10.0,
      10.4,
      SERVER_RATE,
      false,
      false,
      undefined,
      true,
    );
    expect(rate).toBeGreaterThan(1.0);
    expect(isAdjusting).toBe(true);
  });

  it("TC-11: STOPS correction at 0.2s drift even when previously adjusting (hysteresis)", () => {
    // Drift = 0.2s, below the 0.3s stop threshold
    const { rate, isAdjusting } = calculatePlaybackRate(
      0.2,
      10.0,
      10.2,
      SERVER_RATE,
      false,
      false,
      undefined,
      true,
    );
    expect(rate).toBe(1.0);
    expect(isAdjusting).toBe(false);
  });
});
