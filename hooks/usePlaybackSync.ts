import { useEffect, useRef } from "react";
import { useStore } from "@/lib/store";
import { calculateDrift } from "@/lib/utils";
import { calculatePlaybackRate } from "@/lib/drift-math";
import { PlaybackIntentManager } from "@/lib/playback-intent-manager";
import { PlayerMethods } from "@/lib/types";
import { setPlayerPlaybackRate } from "@/lib/player-adapters";
import {
  HARD_SEEK_HTML5,
  HARD_SEEK_IFRAME,
  HARD_SEEK_TWITCH,
  PAUSED_HARD_SEEK,
  JOIN_GRACE_PERIOD_MS,
} from "@/lib/sync-config";

export function usePlaybackSync(props: {
  realPlayerRef: React.RefObject<PlayerMethods | null>;
  playerRef: React.RefObject<PlayerMethods | null>;
  getAccurateTime: () => number;
  getPlaying: () => boolean;
  setPlaying: (p: boolean) => void;
  getIsReady: () => boolean;
  getSeeking: () => boolean;
  getIsBuffering: () => boolean;
  intentManager: PlaybackIntentManager;
  performProgrammaticSeek: (pos: number) => void;
  getCurrentMedia: () => any | undefined;
  getDuration: () => number;
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
      const currentPosition = p.getAccurateTime();

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

        const currentMedia = p.getCurrentMedia();
        const isIframeProvider = ["youtube", "vimeo", "twitch"].includes(
          currentMedia?.provider?.toLowerCase() || "",
        );
        const isTwitch = currentMedia?.provider?.toLowerCase() === "twitch";
        const duration = p.getDuration();

        const setPlaybackRateDirectly = (rate: number) => {
          const provider = currentMedia?.provider?.toLowerCase();
          if (setPlayerPlaybackRate(p.realPlayerRef.current, rate, provider)) return;
          setPlayerPlaybackRate(p.playerRef.current, rate, provider);
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
