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
  intentManager: PlaybackIntentManager;
  healthController: PlaybackHealthController;
  performProgrammaticSeek: (position: number, force?: boolean) => void;
  getCurrentMedia: () => { provider?: string } | undefined;
  getDuration: () => number;
};

/** Reconciles this provider to monotonic canonical playback without room writes. */
export function usePlaybackSync(props: PlaybackSyncProps) {
  const driftRef = useRef(0);
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isAdjustingRateRef = useRef(false);
  const coordinatorRef = useRef(new PlaybackCoordinator());
  const propsRef = useRef(props);

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

      coordinator.beginMediaEpoch(mediaId);
      if (!room || !playback || !mediaId) {
        driftRef.current = 0;
        schedule(syncPlayback, 300);
        return;
      }

      coordinator.acceptCanonical({
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
      });

      // Task 4's exact event/ACK path remains authoritative. Polling is only an
      // idempotent safety net and never blocks newer canonical reconciliation.
      current.intentManager.acknowledgeServerNonce(playback.lastActionNonce);

      if (!current.getIsConnected()) {
        current.healthController.markReconnecting();
        isAdjustingRateRef.current = false;
        schedule(syncPlayback, 300);
        return;
      }

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
      current.healthController.completeRecovery();

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
