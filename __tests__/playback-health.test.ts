import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  PlaybackCoordinator,
  PlaybackHealthController,
} from "../lib/playback-health";
import type { CanonicalPlayback } from "../lib/room-events";
import { normalizeRoomState } from "../lib/types";

function canonical(
  overrides: Partial<CanonicalPlayback> = {},
): CanonicalPlayback {
  return {
    mediaItemId: "media-a",
    status: "playing",
    basePosition: 10,
    baseTimestamp: 10_000,
    rate: 1,
    sequence: 12,
    updatedBy: "p0",
    ...overrides,
  };
}

describe("PlaybackHealthController", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("keeps every buffering participant independent for 1, 3, 5, and 25 friends", () => {
    for (const participantCount of [1, 3, 5, 25]) {
      const canonicalTimeline = canonical({ sequence: 44 });
      const before = structuredClone(canonicalTimeline);
      const controllers = Array.from(
        { length: participantCount },
        () => new PlaybackHealthController(),
      );

      controllers.forEach((controller, index) => {
        if (index % 2 === 0) controller.set("buffering", 1_000);
        if (index % 3 === 0) controller.markReconnecting();
      });

      expect(canonicalTimeline).toEqual(before);
      expect(canonicalTimeline.status).toBe("playing");
      expect(canonicalTimeline.sequence).toBe(44);
      expect(
        controllers.filter(
          (controller) => controller.current() === "buffering",
        ),
      ).toHaveLength(Math.ceil(participantCount / 2));

      controllers.forEach((controller, index) => {
        const coordinator = new PlaybackCoordinator();
        coordinator.beginMediaEpoch("media-a");
        coordinator.acceptCanonical(canonicalTimeline);
        const decision = coordinator.reconcile({
          now: 13_000,
          serverClockOffset: 0,
          currentPosition: 12,
          provider: "youtube",
          duration: 120,
          isReady: true,
          health: controller.current(),
          recoveryMode: controller.recoveryMode(),
          previouslyAdjusting: false,
        });
        if (index % 2 === 0) {
          expect(decision.kind).toBe("waiting");
        } else {
          expect(decision.kind).not.toBe("waiting");
          expect(decision.shouldPlay).toBe(true);
          expect(decision.targetPosition).toBe(13);
        }
      });
    }
  });

  it("coalesces telemetry to one effective update per second and emits the latest state", () => {
    const telemetry = vi.fn(() => true);
    const controller = new PlaybackHealthController({
      emitTelemetry: telemetry,
    });

    controller.set("buffering");
    expect(telemetry).toHaveBeenCalledTimes(1);
    expect(telemetry).toHaveBeenLastCalledWith("buffering");

    vi.advanceTimersByTime(100);
    controller.set("ready");
    vi.advanceTimersByTime(100);
    controller.set("error");
    vi.advanceTimersByTime(100);
    controller.set("ready");
    expect(telemetry).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(700);
    expect(telemetry).toHaveBeenCalledTimes(2);
    expect(telemetry).toHaveBeenLastCalledWith("ready");

    vi.advanceTimersByTime(1_000);
    expect(telemetry).toHaveBeenCalledTimes(2);
  });

  it("cancels pending telemetry exactly when disposed", () => {
    const telemetry = vi.fn(() => true);
    const controller = new PlaybackHealthController({
      emitTelemetry: telemetry,
    });
    controller.set("buffering");
    vi.setSystemTime(100);
    controller.set("ready");

    controller.dispose();
    vi.advanceTimersByTime(2_000);

    expect(telemetry).toHaveBeenCalledTimes(1);
  });

  it("marks only a long stall as forced recovery", () => {
    const controller = new PlaybackHealthController();
    controller.set("buffering", 10_000);
    controller.set("ready", 11_000);
    expect(controller.recoveryMode()).toBe("none");

    controller.set("buffering", 20_000);
    controller.set("ready", 23_000);
    expect(controller.recoveryMode()).toBe("long-stall");
  });

  it("retains the latest offline health and sends it once after reconnect", () => {
    let connected = false;
    const telemetry = vi.fn(() => connected);
    const controller = new PlaybackHealthController({
      emitTelemetry: telemetry,
    });

    controller.set("buffering");
    controller.set("ready");
    connected = true;
    controller.resendCurrent();
    controller.resendCurrent();

    expect(telemetry.mock.calls).toEqual([["buffering"], ["ready"], ["ready"]]);
    vi.advanceTimersByTime(1_000);
    expect(telemetry).toHaveBeenCalledTimes(3);
  });

  it("resends the actual current buffering health and disposes failed retries", () => {
    let connected = false;
    const telemetry = vi.fn(() => connected);
    const controller = new PlaybackHealthController({
      emitTelemetry: telemetry,
    });

    controller.set("buffering");
    connected = true;
    controller.resendCurrent();
    controller.resendCurrent();
    controller.dispose();
    vi.advanceTimersByTime(5_000);

    expect(telemetry.mock.calls).toEqual([["buffering"], ["buffering"]]);
  });

  it("force-resyncs successful health once per connection generation", () => {
    const telemetry = vi.fn(() => true);
    const controller = new PlaybackHealthController({
      emitTelemetry: telemetry,
    });
    controller.set("ready");
    vi.advanceTimersByTime(100);

    controller.resyncCurrent(1);
    controller.resyncCurrent(1);
    expect(telemetry).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(900);
    expect(telemetry.mock.calls).toEqual([["ready"], ["ready"]]);

    controller.resyncCurrent(2);
    controller.resyncCurrent(2);
    vi.advanceTimersByTime(1_000);
    expect(telemetry).toHaveBeenCalledTimes(3);
  });

  it("force-resync sends the latest offline transition and disposal cancels it", () => {
    let connected = false;
    const telemetry = vi.fn(() => connected);
    const controller = new PlaybackHealthController({
      emitTelemetry: telemetry,
    });
    controller.set("buffering");
    controller.set("ready");
    connected = true;
    controller.resyncCurrent(1);
    controller.resyncCurrent(1);
    controller.dispose();
    vi.advanceTimersByTime(5_000);

    expect(telemetry.mock.calls).toEqual([["buffering"], ["ready"], ["ready"]]);
  });

  it("keeps stalled provider callbacks ineligible until reconciliation completes", () => {
    const controller = new PlaybackHealthController();
    controller.set("buffering");
    expect(controller.canAcceptProviderEvents()).toBe(false);

    controller.set("ready", 500);
    expect(controller.canAcceptProviderEvents()).toBe(false);

    controller.completeRecovery();
    expect(controller.canAcceptProviderEvents()).toBe(true);
  });
});

describe("PlaybackCoordinator", () => {
  it("requires a freshly delivered reconnect frame and accepts equal sequence only once", () => {
    const coordinator = new PlaybackCoordinator();
    coordinator.beginMediaEpoch("media-a");
    expect(coordinator.acceptCanonical(canonical(), 1)).toBe(true);

    coordinator.beginConnectionEpoch(1);
    expect(coordinator.acceptCanonical(canonical(), 1)).toBe(false);
    expect(coordinator.awaitingConnectionFrame()).toBe(true);
    expect(coordinator.acceptCanonical(canonical({ sequence: 11 }), 2)).toBe(
      false,
    );
    expect(coordinator.awaitingConnectionFrame()).toBe(true);
    expect(coordinator.acceptCanonical(canonical(), 2)).toBe(true);
    expect(coordinator.awaitingConnectionFrame()).toBe(false);
    expect(coordinator.acceptCanonical(canonical(), 2)).toBe(false);
  });
  it("hard-seeks to current canonical time after a long local stall", () => {
    const coordinator = new PlaybackCoordinator();
    coordinator.beginMediaEpoch("media-a");
    coordinator.acceptCanonical(canonical());

    const decision = coordinator.reconcile({
      now: 18_000,
      serverClockOffset: 0,
      currentPosition: 10,
      provider: "youtube",
      duration: 120,
      isReady: true,
      health: "ready",
      recoveryMode: "long-stall",
      previouslyAdjusting: false,
    });

    expect(decision).toMatchObject({
      kind: "hard-seek",
      targetPosition: 18,
      shouldPlay: true,
    });
  });

  it("uses a provider-aware rate nudge for short drift", () => {
    const coordinator = new PlaybackCoordinator();
    coordinator.beginMediaEpoch("media-a");
    coordinator.acceptCanonical(canonical());

    const decision = coordinator.reconcile({
      now: 11_000,
      serverClockOffset: 0,
      currentPosition: 10,
      provider: "youtube",
      duration: 120,
      isReady: true,
      health: "ready",
      recoveryMode: "none",
      previouslyAdjusting: false,
    });

    expect(decision).toMatchObject({
      kind: "rate-nudge",
      targetPosition: 11,
      playbackRate: 1.03,
      shouldPlay: true,
    });
  });

  it("recovers a paused timeline by seeking without autoplay", () => {
    const coordinator = new PlaybackCoordinator();
    coordinator.beginMediaEpoch("media-a");
    coordinator.acceptCanonical(
      canonical({ status: "paused", basePosition: 25 }),
    );

    const decision = coordinator.reconcile({
      now: 30_000,
      serverClockOffset: 0,
      currentPosition: 10,
      provider: "youtube",
      duration: 120,
      isReady: true,
      health: "ready",
      recoveryMode: "long-stall",
      previouslyAdjusting: false,
    });

    expect(decision).toMatchObject({
      kind: "hard-seek",
      targetPosition: 25,
      shouldPlay: false,
    });
  });

  it.each(["reconnect", "media-change", "provider-reinitialize"] as const)(
    "forces %s recovery to the current canonical time",
    (mode) => {
      const coordinator = new PlaybackCoordinator();
      coordinator.beginMediaEpoch("media-a");
      coordinator.acceptCanonical(canonical());

      expect(
        coordinator.reconcile({
          now: 18_000,
          serverClockOffset: 0,
          currentPosition: 10,
          provider: "youtube",
          duration: 120,
          isReady: true,
          health: "ready",
          recoveryMode: mode,
          previouslyAdjusting: false,
        }),
      ).toMatchObject({
        kind: "hard-seek",
        targetPosition: 18,
        shouldPlay: true,
      });
    },
  );

  it("ignores older, duplicate, and prior-media compact updates", () => {
    const coordinator = new PlaybackCoordinator();
    coordinator.beginMediaEpoch("media-a");

    expect(coordinator.acceptCanonical(canonical({ sequence: 12 }))).toBe(true);
    expect(
      coordinator.acceptCanonical(canonical({ sequence: 11, basePosition: 5 })),
    ).toBe(false);
    expect(
      coordinator.acceptCanonical(
        canonical({ sequence: 12, basePosition: 99 }),
      ),
    ).toBe(false);
    expect(coordinator.currentCanonical()?.basePosition).toBe(10);

    coordinator.beginMediaEpoch("media-b");
    expect(
      coordinator.acceptCanonical(
        canonical({ sequence: 13, basePosition: 2, mediaItemId: "media-a" }),
      ),
    ).toBe(false);
    expect(coordinator.currentCanonical()).toBeNull();
  });
});

describe("legacy playback compatibility", () => {
  it("hydrates a persisted buffering status as paused canonical playback", () => {
    const room = normalizeRoomState({
      id: "legacy-room",
      playback: {
        status: "buffering",
        basePosition: 15,
        baseTimestamp: 10,
        rate: 1,
        updatedBy: "old-client",
      },
    });

    expect(room.playback.status).toBe("paused");
    expect(room.playback.basePosition).toBe(15);
  });
});
