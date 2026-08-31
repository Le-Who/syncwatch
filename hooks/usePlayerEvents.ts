"use client";

import { useCallback } from "react";
import { useStore } from "@/lib/store";
import { PlaybackIntentManager } from "@/lib/playback-intent-manager";
import type { PlayerMethods } from "@/lib/types";
import { getPlayerDuration } from "@/lib/player-adapters";

interface UsePlayerEventsOptions {
  intentManager: PlaybackIntentManager;
  realPlayerRef: React.MutableRefObject<PlayerMethods | null>;
  playerRef: React.MutableRefObject<PlayerMethods | null>;
  currentMediaId: string | null | undefined;
  canControl: boolean;
  playing: boolean;
  isBuffering: boolean;
  setIsReady: (ready: boolean) => void;
  setError: (err: string | null) => void;
  setIsBuffering: (buffering: boolean) => void;
  setPlaying: (playing: boolean) => void;
  setDuration: (dur: number) => void;
  getAccurateTime: () => number;
  emitCommand: (type: string, payload?: any) => void;
  handleNativePlay: () => void;
  handleNativePause: () => void;
}

/**
 * Extracts shared player event handlers used by ReactPlayer-backed providers.
 * 
 * This hook keeps provider lifecycle events centralized.
 */
export function usePlayerEvents({
  intentManager,
  realPlayerRef,
  playerRef,
  currentMediaId,
  canControl,
  playing,
  isBuffering,
  setIsReady,
  setError,
  setIsBuffering,
  setPlaying,
  setDuration,
  getAccurateTime,
  emitCommand,
  handleNativePlay,
  handleNativePause,
}: UsePlayerEventsOptions) {
  /** Shared readiness logic after provider metadata is available. */
  const handleReady = useCallback(
    (rPlayer: PlayerMethods | null | undefined, isTwitch: boolean) => {
      realPlayerRef.current = isTwitch ? playerRef.current : rPlayer || playerRef.current;
      setIsReady(true);
      setError(null);

      const provider = useStore
        .getState()
        .room?.playlist.find((item) => item.id === currentMediaId)
        ?.provider?.toLowerCase();
      const duration = getPlayerDuration(realPlayerRef.current, provider);
      if (duration > 0) setDuration(duration);

      // Clear state-based transition guard for this media
      if (currentMediaId) {
        intentManager.clearMediaTransition(currentMediaId);
        useStore.getState().sendCommand("media_ready", {
          mediaId: currentMediaId,
          ready: true,
        });
      }

      // Auto-resume if server is playing after media switch
      const currentPlayback = useStore.getState().room?.playback;
      if (currentPlayback?.status === "playing") {
        setPlaying(true);
      }
    },
    [
      currentMediaId,
      intentManager,
      playerRef,
      realPlayerRef,
      setDuration,
      setIsReady,
      setError,
      setPlaying,
    ],
  );

  /** Shared onError logic */
  const handleError = useCallback(
    (e: unknown) => {
      console.error("Player error:", e);
      setError("SYSTEM FAILURE. SIGNAL LOST.");
      setIsBuffering(false);
    },
    [setError, setIsBuffering],
  );

  /** Shared onSeek logic — filters programmatic seeks */
  const handleSeek = useCallback(
    (seconds: number, isTwitch: boolean) => {
      if (intentManager.isRecentProgrammaticSeek(1500)) return;
      if (intentManager.isRecentCommand(1500)) return;

      if (canControl) {
        emitCommand("seek", { position: seconds, fromNative: true });

        // Twitch native player auto-pauses when scrubbing.
        // If we were playing before the scrub, auto-resume after a short delay.
        if (isTwitch && playing) {
          intentManager.ignoreEventsFor(2000);
          setTimeout(() => {
            if (realPlayerRef.current?.play) {
              realPlayerRef.current.play();
            }
          }, 200);
        }
      }
    },
    [canControl, playing, intentManager, emitCommand, realPlayerRef],
  );

  /** Shared onDurationChange — handles both Twitch (direct number) and ReactPlayer (event) */
  const handleDurationChange = useCallback(
    (durOrEvent: number | any) => {
      const provider = useStore
        .getState()
        .room?.playlist.find((item) => item.id === currentMediaId)
        ?.provider?.toLowerCase();
      const dur =
        typeof durOrEvent === "number"
          ? durOrEvent
          : getPlayerDuration(realPlayerRef.current, provider) ||
            durOrEvent?.target?.duration ||
            durOrEvent?.duration ||
            0;
      setDuration(dur);
      if (canControl && currentMediaId) {
        emitCommand("update_duration", {
          mediaId: currentMediaId,
          duration: dur,
        });
      }
    },
    [canControl, currentMediaId, emitCommand, realPlayerRef, setDuration],
  );

  /** Shared onEnded handler */
  const handleEnded = useCallback(() => {
    if (canControl) {
      emitCommand("video_ended", { currentMediaId });
    }
  }, [canControl, currentMediaId, emitCommand]);

  /** Shared onWaiting/buffering handler */
  const handleWaiting = useCallback(() => {
    setIsBuffering(true);
    if (canControl) {
      emitCommand("buffering", {
        position: getAccurateTime(),
        fromNative: true,
      });
    }
  }, [canControl, emitCommand, getAccurateTime, setIsBuffering]);

  /** Shared onPlaying handler (buffer recovery) */
  const handlePlaying = useCallback(() => {
    setIsBuffering(false);
  }, [setIsBuffering]);

  /** Shared onSeeked handler (ReactPlayer only, but harmless for Twitch) */
  const handleSeeked = useCallback(() => {
    if (isBuffering) setIsBuffering(false);
  }, [isBuffering, setIsBuffering]);

  return {
    handleReady,
    handleError,
    handleSeek,
    handleDurationChange,
    handleEnded,
    handleWaiting,
    handlePlaying,
    handleSeeked,
    handleNativePlay,
    handleNativePause,
  };
}
