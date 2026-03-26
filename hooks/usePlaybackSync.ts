import { useEffect, useRef } from "react";
import { useStore } from "@/lib/store";
import { calculateDrift } from "@/lib/utils";
import { calculatePlaybackRate } from "@/lib/drift-math";
import { PlaybackIntentManager } from "@/lib/playback-intent-manager";
import { PlayerMethods } from "@/lib/types";
import {
  CONTROLLED_OWNER_CORRECTION,
  CONTROLLED_FOLLOWER_SEEK,
  HARD_SEEK_HTML5,
  HARD_SEEK_IFRAME,
  HARD_SEEK_TWITCH,
  PAUSED_HARD_SEEK,
  JOIN_GRACE_PERIOD_MS,
} from "@/lib/sync-config";

export function usePlaybackSync(props: {
  realPlayerRef: React.RefObject<PlayerMethods | null>;
  playerRef: React.RefObject<PlayerMethods | null>;
  getAccurateTime: () => void;
  getPlaying: () => boolean;
  setPlaying: (p: boolean) => void;
  getIsReady: () => boolean;
  getSeeking: () => boolean;
  getIsBuffering: () => boolean;
  intentManager: PlaybackIntentManager;
  performProgrammaticSeek: (pos: number) => void;
  getControlMode: () => string | undefined;
  getMyRole: () => string | undefined | null;
  getCurrentMedia: () => any | undefined;
  getDuration: () => number;
  emitCommand: (type: string, payload: any) => void;
  joinedAt: number;
}) {
  const driftRef = useRef(0);
  const syncTimerRef = useRef<any>(null);
  const lastServerStateChangeRef = useRef<number>(0);
  const isAdjustingRateRef = useRef(false);
  const propsRef = useRef(props);

  // Keep a stable ref to props so we don't restart interval on every render
  useEffect(() => {
    propsRef.current = props;
  });

  useEffect(() => {
    const syncPlayback = () => {
      const p = propsRef.current;
      const state = useStore.getState();
      const playback = state.room?.playback;
      const serverClockOffset = state.serverClockOffset;

      if (!playback || !p.getIsReady() || p.getSeeking()) {
        syncTimerRef.current = setTimeout(syncPlayback, 200) as any;
        return;
      }

      // P1 Fix: Skip sync corrections during buffering — rate adjustments have
      // no effect while the player is stalled. Reset hysteresis state so that
      // buffer recovery starts with a clean correction decision.
      if (p.getIsBuffering()) {
        isAdjustingRateRef.current = false;
        syncTimerRef.current = setTimeout(syncPlayback, 300) as any;
        return;
      }

      // ACK pipeline: acknowledge our pending nonce when the server echoes it back.
      // This deterministically unblocks native events instead of relying on timers.
      p.intentManager.acknowledgeServerNonce(playback.lastActionNonce);

      if (p.intentManager.isAwaitingServerAck()) {
        // Optimistic UI barrier — server hasn't confirmed our command yet
        syncTimerRef.current = setTimeout(syncPlayback, 200) as any;
        return;
      }

      const currentServerTime = Date.now() + serverClockOffset;
      const currentPosition = p.getAccurateTime() as unknown as number;

      if (playback.status === "playing") {
        const { expectedPosition, drift: currentDrift } = calculateDrift(
          playback.status,
          playback.basePosition,
          playback.baseTimestamp,
          currentServerTime,
          currentPosition,
          playback.rate,
        );
        driftRef.current = currentDrift;

        if (!p.getPlaying()) {
          lastServerStateChangeRef.current = Date.now();
          p.setPlaying(true);
        }

        if (p.getControlMode() === "controlled") {
          if (currentDrift > CONTROLLED_OWNER_CORRECTION && p.getMyRole() === "owner") {
            // A4 Fix: tag sync_correction with nonce so the echo-back doesn't trigger OCC rollback flicker
            const nonce = crypto.randomUUID();
            p.intentManager.markCommandEmitted(
              "playing",
              currentPosition,
              nonce,
            );
            p.emitCommand("sync_correction", {
              position: currentPosition,
              nonce,
            });
            return;
          } else if (currentDrift > CONTROLLED_FOLLOWER_SEEK) {
            // P3 Fix: Followers hard seek locally if drift exceeds 2.0s (lowered from 3.0s).
            // The purpose is keeping all viewers in sync — followers must actively correct drift.
            p.performProgrammaticSeek(expectedPosition);
            // P2 Fix: Must return here to prevent falling through to the
            // iframe-aware hard-seek block below, which would fire a SECOND
            // seek for the same drift cycle.
            syncTimerRef.current = setTimeout(syncPlayback, 250) as any;
            return;
          }
          // Note: followers fall through to rate adjustment for 0.6 - 2.0s drift
        }

        const currentMedia = p.getCurrentMedia();
        const isIframeProvider = ["youtube", "vimeo", "twitch"].includes(
          currentMedia?.provider?.toLowerCase() || "",
        );
        const isTwitch = currentMedia?.provider?.toLowerCase() === "twitch";
        const duration = p.getDuration();

        const setPlaybackRateDirectly = (rate: number) => {
          const rP = p.realPlayerRef.current;
          if (rP?.getInternalPlayer) {
            const internal = rP.getInternalPlayer();
            if (internal?.setPlaybackRate) {
              internal.setPlaybackRate(rate);
              return;
            }
          }
          if (
            p.playerRef.current &&
            p.playerRef.current.playbackRate !== undefined
          ) {
            p.playerRef.current.playbackRate = rate;
          }
        };

        // P4 Fix: During the first 3 seconds after joining, skip hard seeks
        // to let clock sync converge. Rate correction still applies.
        const isInJoinGracePeriod = Date.now() - p.joinedAt < JOIN_GRACE_PERIOD_MS;

        if (
          !isInJoinGracePeriod &&
          (currentDrift > HARD_SEEK_HTML5 ||
            (isIframeProvider && currentDrift > HARD_SEEK_IFRAME) ||
            (isTwitch && currentDrift > HARD_SEEK_TWITCH)) &&
          !p.getIsBuffering()
        ) {
          let expectedClamped = expectedPosition;
          if (duration > 0 && expectedClamped > duration) {
            expectedClamped = duration;
          }
          p.performProgrammaticSeek(expectedClamped);

          if (isTwitch && p.getPlaying() && p.realPlayerRef.current?.play) {
            p.realPlayerRef.current.play();
          }

          setPlaybackRateDirectly(playback.rate);
        } else {
          const { rate: newRate, isAdjusting } = calculatePlaybackRate(
            currentDrift,
            currentPosition,
            expectedPosition,
            playback.rate,
            p.getIsBuffering(),
            isIframeProvider,
            currentMedia?.provider,
            isAdjustingRateRef.current,
          );
          isAdjustingRateRef.current = isAdjusting;
          setPlaybackRateDirectly(newRate);
        }
      } else if (playback.status === "paused") {
        const { drift: currentDrift } = calculateDrift(
          playback.status,
          playback.basePosition,
          playback.baseTimestamp,
          currentServerTime,
          currentPosition,
          1.0,
        );
        driftRef.current = currentDrift;

        if (p.getPlaying()) {
          // Don't override to paused if user recently commanded play —
          // the room_state broadcast may just be lagging behind the server mutation.
          // This breaks the death-pause feedback loop.
          if (p.intentManager.getExpectedStatus(undefined) === "playing") {
            syncTimerRef.current = setTimeout(syncPlayback, 200) as any;
            return;
          }
          lastServerStateChangeRef.current = Date.now();
          p.setPlaying(false);
        }

        if (currentDrift > PAUSED_HARD_SEEK && !p.getIsBuffering()) {
          p.intentManager.ignoreEventsFor(1500);
          p.performProgrammaticSeek(playback.basePosition);
        }
      }

      // Adaptive interval based on drift magnitude
      let nextIntervalMs = 500;
      if (driftRef.current > 0.5) nextIntervalMs = 250;
      else if (driftRef.current < 0.1) nextIntervalMs = 2000;

      syncTimerRef.current = setTimeout(syncPlayback, nextIntervalMs) as any;
    };

    syncTimerRef.current = setTimeout(syncPlayback, 500) as any;
    return () => {
      if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    };
  }, []); // Empty deps so the interval sets up once, uses propsRef

  return { driftRef };
}
