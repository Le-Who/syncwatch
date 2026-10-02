"use client";

import { useCallback, useEffect, useRef } from "react";
import { useStore } from "@/lib/store";
import { PlaybackIntentManager } from "@/lib/playback-intent-manager";
import type { PlayerMethods } from "@/lib/types";
import { getPlayerDuration } from "@/lib/player-adapters";
import { PlaybackHealthController } from "@/lib/playback-health";

export interface UsePlayerEventsOptions {
  intentManager: PlaybackIntentManager;
  healthController: PlaybackHealthController;
  realPlayerRef: React.MutableRefObject<PlayerMethods | null>;
  playerRef: React.MutableRefObject<PlayerMethods | null>;
  currentMediaId: string | null | undefined;
  canonicalSequence: number;
  providerEventEpoch?: number;
  canControl: boolean;
  playing: boolean;
  setIsReady: (ready: boolean) => void;
  setError: (err: string | null) => void;
  setPlaying: (playing: boolean) => void;
  setDuration: (dur: number) => void;
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
  healthController,
  realPlayerRef,
  playerRef,
  currentMediaId,
  canonicalSequence,
  providerEventEpoch = 0,
  canControl,
  playing,
  setIsReady,
  setError,
  setPlaying: _setPlaying,
  setDuration,
  emitCommand,
  handleNativePlay,
  handleNativePause,
}: UsePlayerEventsOptions) {
  const ownedTimers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const isCurrentProviderEpoch = useCallback(() => {
    const room = useStore.getState().room;
    if (!room) return false;
    return (
      room.currentMediaId === currentMediaId &&
      (room.sequence ?? -1) === canonicalSequence &&
      intentManager.isProviderEventEpochCurrent(providerEventEpoch)
    );
  }, [canonicalSequence, currentMediaId, intentManager, providerEventEpoch]);
  const canAcceptProviderEvent = useCallback(
    () =>
      isCurrentProviderEpoch() && healthController.canAcceptProviderEvents(),
    [healthController, isCurrentProviderEpoch],
  );

  useEffect(
    () => () => {
      for (const timer of ownedTimers.current) clearTimeout(timer);
      ownedTimers.current.clear();
    },
    [],
  );

  /** Shared readiness logic after provider metadata is available. */
  const handleReady = useCallback(
    (rPlayer: PlayerMethods | null | undefined, isTwitch: boolean) => {
      if (!isCurrentProviderEpoch()) return;
      realPlayerRef.current = isTwitch
        ? playerRef.current
        : rPlayer || playerRef.current;
      setIsReady(true);
      setError(null);
      healthController.set("ready");

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
    },
    [
      currentMediaId,
      healthController,
      intentManager,
      isCurrentProviderEpoch,
      playerRef,
      realPlayerRef,
      setDuration,
      setIsReady,
      setError,
    ],
  );

  /** Shared onError logic */
  const handleError = useCallback(
    (e: unknown) => {
      if (!isCurrentProviderEpoch()) return;
      console.error("Player error:", e);
      const title =
        useStore
          .getState()
          .room?.playlist.find((item) => item.id === currentMediaId)?.title ||
        "this video";
      setError(`Could not play “${title}”. Retry or reinitialize your player.`);
      healthController.set("error");
    },
    [currentMediaId, healthController, isCurrentProviderEpoch, setError],
  );

  /** Shared onSeek logic — filters programmatic seeks */
  const handleSeek = useCallback(
    (seconds: number, isTwitch: boolean) => {
      if (!canAcceptProviderEvent()) return;
      if (intentManager.isRecentProgrammaticSeek(1500)) return;
      if (intentManager.isRecentCommand(1500)) return;

      if (canControl) {
        emitCommand("seek", { position: seconds, fromNative: true });

        // Twitch native player auto-pauses when scrubbing.
        // If we were playing before the scrub, auto-resume after a short delay.
        if (isTwitch && playing) {
          intentManager.ignoreEventsFor(2000);
          const timer = setTimeout(() => {
            ownedTimers.current.delete(timer);
            if (canAcceptProviderEvent() && realPlayerRef.current?.play) {
              realPlayerRef.current.play();
            }
          }, 200);
          ownedTimers.current.add(timer);
        }
      }
    },
    [
      canControl,
      playing,
      intentManager,
      emitCommand,
      canAcceptProviderEvent,
      realPlayerRef,
    ],
  );

  /** Shared onDurationChange — handles both Twitch (direct number) and ReactPlayer (event) */
  const handleDurationChange = useCallback(
    (durOrEvent: number | any) => {
      if (!isCurrentProviderEpoch()) return;
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
    [
      canControl,
      currentMediaId,
      emitCommand,
      isCurrentProviderEpoch,
      realPlayerRef,
      setDuration,
    ],
  );

  /** Shared onEnded handler */
  const handleEnded = useCallback(() => {
    if (!canAcceptProviderEvent()) return;
    if (canControl) {
      emitCommand("video_ended", { currentMediaId });
    }
  }, [canAcceptProviderEvent, canControl, currentMediaId, emitCommand]);

  /** Shared onWaiting/buffering handler */
  const handleWaiting = useCallback(() => {
    if (!isCurrentProviderEpoch()) return;
    healthController.set("buffering");
  }, [healthController, isCurrentProviderEpoch]);

  /** Shared onPlaying handler (buffer recovery) */
  const handlePlaying = useCallback(() => {
    if (!isCurrentProviderEpoch()) return;
    healthController.set("ready");
  }, [healthController, isCurrentProviderEpoch]);

  /** Shared onSeeked handler (ReactPlayer only, but harmless for Twitch) */
  const handleSeeked = useCallback(() => {
    if (!isCurrentProviderEpoch()) return;
  }, [isCurrentProviderEpoch]);

  const guardedNativePlay = useCallback(() => {
    if (isCurrentProviderEpoch()) handleNativePlay();
  }, [handleNativePlay, isCurrentProviderEpoch]);

  const guardedNativePause = useCallback(() => {
    if (canAcceptProviderEvent()) handleNativePause();
  }, [canAcceptProviderEvent, handleNativePause]);

  return {
    handleReady,
    handleError,
    handleSeek,
    handleDurationChange,
    handleEnded,
    handleWaiting,
    handlePlaying,
    handleSeeked,
    handleNativePlay: guardedNativePlay,
    handleNativePause: guardedNativePause,
  };
}
