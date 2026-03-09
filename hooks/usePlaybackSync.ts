import { useEffect, useRef, useState } from "react";
import { useStore } from "@/lib/store";
import { calculateDrift } from "@/lib/utils";
import { calculatePlaybackRate } from "@/lib/drift-math";

export function usePlaybackSync(props: {
  realPlayerRef: React.MutableRefObject<any>;
  playerRef: React.MutableRefObject<any>;
  getAccurateTime: () => void;
  playing: boolean;
  setPlaying: (p: boolean) => void;
  isReady: boolean;
  seeking: boolean;
  isBuffering: boolean;
  lastCommandEmitTimeRef: React.MutableRefObject<number>;
  lastStateEmittedRef: React.MutableRefObject<{
    status: string;
    position: number;
    time: number;
    nonce?: string;
  } | null>;
  ignoreNativeEventsUntilRef: React.MutableRefObject<number>;
  performProgrammaticSeek: (pos: number) => void;
  setLocalPlaybackRate: (rate: number) => void;
  controlMode: string | undefined;
  myRole: string | undefined | null;
  currentMedia: any | undefined;
  duration: number;
  emitCommand: (type: string, payload: any) => void;
}) {
  const playback = useStore((s) => s.room?.playback);
  const serverClockOffset = useStore((s) => s.serverClockOffset);

  const driftRef = useRef(0);
  const lastServerStateChangeRef = useRef<number>(0);

  const syncPlayback = () => {
    if (!playback || !props.isReady || props.seeking) return;

    if (Date.now() - props.lastCommandEmitTimeRef.current < 1500) {
      // Optimistic UI barrier: ignore server discrepancy immediately after manual UI action
      return;
    }

    // [Problem 1 Fix]: Nonce-based Identity (Anti-Echo Rollback)
    if (
      playback.lastActionNonce &&
      props.lastStateEmittedRef.current?.nonce === playback.lastActionNonce
    ) {
      // Server just repeated back our own recent action.
      // Enter "Soft Mode": grant another 2 seconds of immunity against hard `seekTo` corrections
      props.ignoreNativeEventsUntilRef.current = Date.now() + 2000;
      // We clear the local tracking so we only grant immunity once per nonce resolution
      props.lastStateEmittedRef.current.nonce = undefined;
    }

    const currentServerTime = Date.now() + serverClockOffset;
    const currentPosition = props.getAccurateTime() as unknown as number;

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

      if (!props.playing) {
        lastServerStateChangeRef.current = Date.now();
        props.setPlaying(true);
      }

      // [Problem 5 Fix]: Owner As Oracle in Controlled Mode
      if (props.controlMode === "controlled" && props.myRole === "owner") {
        // The owner dictates time. If the owner's local player drifts from the server's math
        // by more than 600ms, the owner forces the server to accept the local position.
        if (currentDrift > 0.6) {
          props.emitCommand("sync_correction", { position: currentPosition });
          // No local seek required, we are the authority.
          return;
        }
      }

      const isIframeProvider = ["youtube", "vimeo", "twitch"].includes(
        props.currentMedia?.provider?.toLowerCase() || "",
      );
      const isTwitch = props.currentMedia?.provider?.toLowerCase() === "twitch";

      // [Problem 3 Fix]: Dual-Threshold Adaptive Rate (Hard Sink vs Smooth Rate Shift)
      // Twitch DOES NOT support playback rates, so we must force a hard seek for any sync drift.
      if (
        (currentDrift > 3.0 ||
          (isIframeProvider && currentDrift > 2.0) ||
          (isTwitch && currentDrift > 1.0)) &&
        !props.isBuffering
      ) {
        // [THRESHOLD 1]: Massive drift or Twitch drift. Requires a violent hard seek.
        let expectedClamped = expectedPosition;
        if (props.duration > 0 && expectedClamped > props.duration) {
          expectedClamped = props.duration;
        }
        props.performProgrammaticSeek(expectedClamped);

        // Twitch inherently pauses when instructed to seek, so force a resume.
        if (isTwitch && props.playing && props.realPlayerRef.current?.play) {
          props.realPlayerRef.current.play();
        }

        props.setLocalPlaybackRate(playback.rate);
      } else {
        const newRate = calculatePlaybackRate(
          currentDrift,
          currentPosition,
          expectedPosition,
          playback.rate,
          props.isBuffering,
          isIframeProvider,
        );
        props.setLocalPlaybackRate(newRate);
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

      if (props.playing) {
        lastServerStateChangeRef.current = Date.now();
        props.setPlaying(false);
      }

      if (currentDrift > 1.0 && !props.isBuffering) {
        props.ignoreNativeEventsUntilRef.current = Date.now() + 1500;
        props.performProgrammaticSeek(playback.basePosition);
      }
    }
  };

  useEffect(() => {
    const interval = setInterval(syncPlayback, 1000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    playback,
    props.isReady,
    props.seeking,
    props.playing,
    props.isBuffering,
    props.controlMode,
    props.myRole,
    props.currentMedia,
    props.duration,
  ]);

  return { driftRef };
}
