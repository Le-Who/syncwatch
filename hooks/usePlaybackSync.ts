import { useEffect, useRef } from "react";
import { useStore } from "@/lib/store";
import {
  PlaybackCoordinator,
  PlaybackHealthController,
} from "@/lib/playback-health";
import { PlaybackIntentManager } from "@/lib/playback-intent-manager";
import type { PlayerMethods } from "@/lib/types";
import { setPlayerPlaybackRate } from "@/lib/player-adapters";

type PlaybackSyncProps = {
  realPlayerRef: React.RefObject<PlayerMethods | null>;
  playerRef: React.RefObject<PlayerMethods | null>;
  getAccurateTime: () => number;
  getPlaying: () => boolean;
  setPlaying: (playing: boolean) => void;
  getIsReady: () => boolean;
  getSeeking: () => boolean;
  getIsConnected: () => boolean;
  getConnectionEpoch?: () => number;
  getConnectionDeliveryFloor?: () => number;
  intentManager: PlaybackIntentManager;
  healthController: PlaybackHealthController;
  performProgrammaticSeek: (position: number, force?: boolean) => void;
  getCurrentMedia: () => { provider?: string } | undefined;
  getDuration: () => number;
  getCanonicalDeliveryVersion?: () => number;
  onReconnecting?: () => void;
  onReconciled?: () => void;
};

/** Reconciles this provider to monotonic canonical playback without room writes. */
export function usePlaybackSync(props: PlaybackSyncProps) {
  const driftRef = useRef(0);
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isAdjustingRateRef = useRef(false);
  const coordinatorRef = useRef(new PlaybackCoordinator());
  const propsRef = useRef(props);
  const wasConnectedRef = useRef(props.getIsConnected());
  const initialConnectionEpoch = props.getConnectionEpoch?.() ?? 0;
  const initialDeliveryVersion = props.getCanonicalDeliveryVersion?.() ?? 0;
  const initialConnectionFloor =
    props.getConnectionDeliveryFloor?.() ?? Number.NEGATIVE_INFINITY;
  const mountsAwaitingFreshDelivery =
    initialConnectionEpoch > 0 &&
    initialDeliveryVersion <= initialConnectionFloor;
  const connectionEpochRef = useRef(
    mountsAwaitingFreshDelivery
      ? initialConnectionEpoch - 1
      : initialConnectionEpoch,
  );
  const lastObservedDeliveryRef = useRef(initialDeliveryVersion);

  useEffect(() => {
    propsRef.current = props;
  });

  useEffect(() => {
    const schedule = (callback: () => void, delay: number) => {
      syncTimerRef.current = setTimeout(callback, delay);
    };

    const syncPlayback = () => {
      const current = propsRef.current;
      const state = useStore.getState();
      const room = state.room;
      const playback = room?.playback;
      const mediaId = room?.currentMediaId ?? null;
      const coordinator = coordinatorRef.current;
      const connected = current.getIsConnected();
      const deliveryVersion = current.getCanonicalDeliveryVersion?.() ?? 0;
      const connectionEpoch = current.getConnectionEpoch?.() ?? 0;
      let beganConnectionEpoch = false;

      coordinator.beginMediaEpoch(mediaId);
      if (connectionEpoch !== connectionEpochRef.current) {
        connectionEpochRef.current = connectionEpoch;
        coordinator.beginConnectionEpoch(
          current.getConnectionDeliveryFloor?.() ??
            lastObservedDeliveryRef.current,
        );
        current.healthController.markReconnecting();
        current.onReconnecting?.();
        beganConnectionEpoch = true;
      }
      lastObservedDeliveryRef.current = deliveryVersion;

      if (!room || !playback || !mediaId) {
        driftRef.current = 0;
        schedule(syncPlayback, 300);
        return;
      }

      if (!connected) {
        if (wasConnectedRef.current && !beganConnectionEpoch) {
          coordinator.beginConnectionEpoch(deliveryVersion);
        }
        wasConnectedRef.current = false;
        current.healthController.markReconnecting();
        isAdjustingRateRef.current = false;
        schedule(syncPlayback, 300);
        return;
      }
      wasConnectedRef.current = true;

      const canonicalFrame = {
        mediaItemId: mediaId,
        status: playback.status,
        basePosition: playback.basePosition,
        baseTimestamp: playback.baseTimestamp,
        rate: playback.rate,
        sequence: room.sequence,
        updatedBy: playback.updatedBy,
        ...(playback.lastActionNonce
          ? { lastActionNonce: playback.lastActionNonce }
          : {}),
      } as const;

      if (
        current.intentManager.shouldDeferCanonicalFrame(
          room.sequence,
          mediaId,
          playback.lastActionNonce,
        )
      ) {
        schedule(syncPlayback, 300);
        return;
      }
      coordinator.acceptCanonical(canonicalFrame, deliveryVersion);

      if (coordinator.awaitingConnectionFrame()) {
        schedule(syncPlayback, 300);
        return;
      }

      // Task 4's exact event/ACK path remains authoritative. Polling is only an
      // idempotent safety net and never blocks newer canonical reconciliation.
      current.intentManager.acknowledgeServerNonce(playback.lastActionNonce);

      const media = current.getCurrentMedia();
      const decision = coordinator.reconcile({
        now: Date.now(),
        serverClockOffset: state.serverClockOffset,
        currentPosition: current.getAccurateTime(),
        provider: media?.provider,
        duration: current.getDuration(),
        isReady: current.getIsReady() && !current.getSeeking(),
        health: current.healthController.current(),
        recoveryMode: current.healthController.recoveryMode(),
        previouslyAdjusting: isAdjustingRateRef.current,
      });
      driftRef.current = decision.drift;

      if (decision.kind === "waiting") {
        if (!decision.shouldPlay && current.getPlaying()) {
          current.setPlaying(false);
        }
        isAdjustingRateRef.current = false;
        schedule(syncPlayback, 300);
        return;
      }

      if (current.getPlaying() !== decision.shouldPlay) {
        current.setPlaying(decision.shouldPlay);
      }

      const provider = media?.provider?.toLowerCase();
      const setPlaybackRate = (rate: number) => {
        if (
          setPlayerPlaybackRate(current.realPlayerRef.current, rate, provider)
        ) {
          return;
        }
        setPlayerPlaybackRate(current.playerRef.current, rate, provider);
      };

      if (decision.kind === "hard-seek") {
        current.intentManager.ignoreEventsFor(1_500);
        current.performProgrammaticSeek(decision.targetPosition, true);
        if (
          provider === "twitch" &&
          decision.shouldPlay &&
          current.realPlayerRef.current?.play
        ) {
          current.realPlayerRef.current.play();
        }
      }
      setPlaybackRate(decision.playbackRate);
      isAdjustingRateRef.current = decision.isAdjusting;
      const completedRecovery = current.healthController.needsReconciliation();
      current.healthController.completeRecovery();
      if (completedRecovery) current.onReconciled?.();

      let nextIntervalMs = 500;
      if (decision.drift > 0.5) nextIntervalMs = 250;
      else if (decision.drift < 0.1) nextIntervalMs = 2_000;
      schedule(syncPlayback, nextIntervalMs);
    };

    schedule(syncPlayback, 500);
    return () => {
      if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
      syncTimerRef.current = null;
    };
  }, []);

  return { driftRef };
}
