import { useEffect, useRef } from "react";
import { useStore } from "@/lib/store";
import { calculateDrift } from "@/lib/utils";
import { calculatePlaybackRate } from "@/lib/drift-math";
import { PlaybackIntentManager } from "@/lib/playback-intent-manager";

export function usePlaybackSync(props: {
  realPlayerRef: React.MutableRefObject<any>;
  playerRef: React.MutableRefObject<any>;
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
}) {
  const driftRef = useRef(0);
  const syncTimerRef = useRef<any>(null);
  const lastServerStateChangeRef = useRef<number>(0);
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

      if (p.intentManager.isRecentCommand(1500)) {
        // Optimistic UI barrier — reschedule to retry shortly
        syncTimerRef.current = setTimeout(syncPlayback, 200) as any;
        return;
      }

      p.intentManager.checkAndConsumeNonce(playback.lastActionNonce);

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
          if (currentDrift > 0.6 && p.getMyRole() === "owner") {
            p.emitCommand("sync_correction", { position: currentPosition });
            return;
          } else if (currentDrift > 3.0) {
            // Followers hard seek locally if drift is massive
            p.performProgrammaticSeek(playback.basePosition);
          }
          // Note: followers fall through to rate adjustment for 0.6 - 3.0s drift
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

        if (
          (currentDrift > 3.0 ||
            (isIframeProvider && currentDrift > 2.0) ||
            (isTwitch && currentDrift > 1.0)) &&
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
          const newRate = calculatePlaybackRate(
            currentDrift,
            currentPosition,
            expectedPosition,
            playback.rate,
            p.getIsBuffering(),
            isIframeProvider,
          );
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

        if (currentDrift > 3.0 && !p.getIsBuffering()) {
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
