"use client";

// default-passive-events removed: Global monkey-patches are dangerous for Radix UI Sliders -> Symptom Masking

import {
  useEffect,
  useRef,
  useState,
  useCallback,
  useLayoutEffect,
} from "react";
import dynamic from "next/dynamic";
import { useStore, useSettingsStore } from "@/lib/store";
import { useShallow } from "zustand/react/shallow";

function useEventCallback<Args extends unknown[], Return>(
  fn: (...args: Args) => Return,
): (...args: Args) => Return {
  const ref = useRef(fn);
  useLayoutEffect(() => {
    ref.current = fn;
  });
  return useCallback((...args: Args) => ref.current(...args), []);
}
import fscreen from "fscreen";
import { calculateDrift } from "@/lib/utils";
import { PlayerMethods } from "@/lib/types";
import { usePlayerShortcuts } from "@/hooks/usePlayerShortcuts";
import { useFlashback } from "@/hooks/useFlashback";
import { usePlaybackSync } from "@/hooks/usePlaybackSync";
import { usePlayerEvents } from "@/hooks/usePlayerEvents";
import { usePlaybackIntentAcknowledgement } from "@/hooks/usePlaybackIntentAcknowledgement";
import {
  getPlayerCurrentTime,
  applyTwitchEventProxy,
  seekPlayerTo,
} from "@/lib/player-adapters";
import { getParticipantPermissions } from "@/lib/permissions";
import { PAUSE_DEBOUNCE_MS } from "@/lib/sync-config";
import { AwaitingSignal } from "./AwaitingSignal";
import { UpNextOverlay } from "./UpNextOverlay";
import { SyncStatusBadge } from "./SyncStatusBadge";
import { PlayerControlBar } from "./PlayerControlBar";
import { PlaybackIntentManager } from "@/lib/playback-intent-manager";
import { PlaybackHealthController } from "@/lib/playback-health";
import { roomSocketService } from "@/lib/socket";
import {
  SleepOverlay,
  BufferingOverlay,
  PausedOverlay,
  UserGestureGuard,
  ErrorOverlay,
} from "./overlays";

const ReactPlayer = dynamic(() => import("react-player"), {
  ssr: false,
}) as any;

const COMMANDS_WITH_COMPACT_PLAYBACK_UPDATE = new Set([
  "play",
  "pause",
  "seek",
  "update_rate",
  "sync_correction",
]);

export default function Player() {
  const participantId = useStore((s) => s.participantId);
  const sendCommand = useStore((s) => s.sendCommand);
  const room = useStore((s) => s.room);
  const serverClockOffset = useStore((s) => s.serverClockOffset);
  const isConnected = useStore((s) => s.isConnected);
  const connectionEpoch = useStore((s) => s.connectionEpoch);
  const connectionDeliveryFloor = useStore((s) => s.connectionDeliveryFloor);
  const canonicalDeliveryVersion = useStore((s) => s.canonicalDeliveryVersion);
  const currentMediaId = useStore((s) => s.room?.currentMediaId);
  const occRollbackTick = useStore((s) => s.occRollbackTick);
  const autoplayNext = useStore((s) => s.room?.settings.autoplayNext);

  const currentMedia = useStore(
    useShallow((s) =>
      s.room?.playlist.find((item) => item.id === s.room?.currentMediaId),
    ),
  );

  const playback = useStore(useShallow((s) => s.room?.playback));

  const participantCount = useStore((s) =>
    s.room ? Object.keys(s.room.participants).length : 0,
  );

  const permissions =
    room && participantId
      ? getParticipantPermissions(room, participantId)
      : null;
  const canControl = permissions?.canControlPlayback ?? false;
  const canAddPlaylist = permissions?.canAddPlaylist ?? false;

  const { volume, muted, theaterMode, setVolume, setMuted, toggleTheaterMode } =
    useSettingsStore();
  const playerRef = useRef<PlayerMethods | null>(null); // React component wrapper ref
  const realPlayerRef = useRef<PlayerMethods | null>(null); // Actual ReactPlayer instance
  const containerRef = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [seeking, setSeeking] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [playbackHealth, setPlaybackHealth] = useState<
    "idle" | "ready" | "buffering" | "error"
  >("idle");
  const isBuffering = playbackHealth === "buffering";
  const [error, setError] = useState<string | null>(null);
  const [hostName, setHostName] = useState<string>("localhost");
  const [mounted, setMounted] = useState(false);
  const [userJoined, setUserJoined] = useState(false);
  const { flashbacks, registerPossibleFlashback, popFlashback } =
    useFlashback();

  const [isSleeping, setIsSleeping] = useState(false);
  const isSleepingRef = useRef(false);
  const idleTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastActivityRef = useRef<number>(0);

  // P5 Fix: Sync ref with state so event handlers never read stale closure
  useEffect(() => {
    isSleepingRef.current = isSleeping;
  }, [isSleeping]);

  // P5 Fix: wakeUp uses ref — stable identity, no event listener churn
  const wakeUp = useCallback(() => {
    if (isSleepingRef.current) {
      setIsSleeping(false);
      const state = useStore.getState();
      if (state.room && !state.isConnected) {
        state.connect(state.room.id, state.nickname);
      }
    }
  }, []);

  useEffect(() => {
    const handleUserActivity = () => {
      const now = Date.now();
      // Throttle activity handling to once per second to avoid rapid timeout churn
      if (now - lastActivityRef.current < 1000) return;
      lastActivityRef.current = now;

      wakeUp();
      if (idleTimeoutRef.current) clearTimeout(idleTimeoutRef.current);
      idleTimeoutRef.current = setTimeout(
        () => {
          const currentStatus = useStore.getState().room?.playback?.status;
          if (currentStatus === "paused" || currentStatus === "ended") {
            setIsSleeping(true);
            useStore.getState().disconnect();
          }
        },
        2 * 60 * 60 * 1000,
      );
    };

    window.addEventListener("mousemove", handleUserActivity, { passive: true });
    window.addEventListener("keydown", handleUserActivity, { passive: true });
    window.addEventListener("touchstart", handleUserActivity, { passive: true });
    window.addEventListener("click", handleUserActivity, { passive: true });

    handleUserActivity();

    return () => {
      window.removeEventListener("mousemove", handleUserActivity);
      window.removeEventListener("keydown", handleUserActivity);
      window.removeEventListener("touchstart", handleUserActivity);
      window.removeEventListener("click", handleUserActivity);
      if (idleTimeoutRef.current) clearTimeout(idleTimeoutRef.current);
    };
  }, [wakeUp]);

  // Removed ResizeObserver dimensions

  const [intentManager] = useState(() => new PlaybackIntentManager());
  const nativePauseResumeRef = useRef<{
    nonce: string;
    mediaId: string | null | undefined;
    providerEpoch: number;
    sequence: number;
  } | null>(null);
  const [providerEventEpoch, setProviderEventEpoch] = useState(0);
  const [providerRetryKey, setProviderRetryKey] = useState(0);
  const mountsAwaitingFreshDelivery =
    connectionEpoch > 0 && canonicalDeliveryVersion <= connectionDeliveryFloor;
  const [isReconnecting, setIsReconnecting] = useState(
    !isConnected || mountsAwaitingFreshDelivery,
  );
  const [healthController] = useState(
    () =>
      new PlaybackHealthController({
        onHealthChange: (health) => {
          setPlaybackHealth(health);
          useStore.getState().setLocalPlaybackHealth?.(health);
        },
        emitTelemetry: (health) => {
          return roomSocketService.sendParticipantHealth(health);
        },
      }),
  );
  usePlaybackIntentAcknowledgement(intentManager);

  useEffect(
    () => () => {
      healthController.dispose();
      intentManager.dispose();
    },
    [healthController, intentManager],
  );

  const observedConnectionEpochRef = useRef(
    mountsAwaitingFreshDelivery ? connectionEpoch - 1 : connectionEpoch,
  );
  const resyncedConnectionEpochRef = useRef<number | null>(
    isConnected && !mountsAwaitingFreshDelivery ? connectionEpoch : null,
  );
  useEffect(() => {
    const epochChanged = observedConnectionEpochRef.current !== connectionEpoch;
    if (epochChanged) {
      observedConnectionEpochRef.current = connectionEpoch;
      setIsReconnecting(true);
      healthController.markReconnecting();
      setProviderEventEpoch(intentManager.advanceProviderEventEpoch());
    }

    if (isConnected && resyncedConnectionEpochRef.current !== connectionEpoch) {
      resyncedConnectionEpochRef.current = connectionEpoch;
      healthController.resyncCurrent(connectionEpoch);
    }
  }, [connectionEpoch, healthController, intentManager, isConnected]);

  const isDocumentVisibleRef = useRef(true);
  useEffect(() => {
    const handleVisibilityChange = () => {
      isDocumentVisibleRef.current = document.visibilityState === "visible";
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    // Set initial value inside useEffect to ensure it runs only on client
    handleVisibilityChange();
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  useEffect(() => {
    intentManager.setUserDraggingScrubber(seeking);
  }, [seeking, intentManager]);

  const getAccurateTime = useCallback(() => {
    const provider = currentMedia?.provider?.toLowerCase();
    const realTime = getPlayerCurrentTime(realPlayerRef.current, provider);
    if (realTime > 0) return realTime;
    return getPlayerCurrentTime(playerRef.current, provider);
  }, [currentMedia?.provider]);

  const providerName = currentMedia?.provider?.toLowerCase() || "";
  const usesNativeProviderControls = ["youtube", "twitch"].includes(
    providerName,
  );

  const handleNativeVolumeChange = useEventCallback((event: any) => {
    const target =
      event?.currentTarget || event?.target || realPlayerRef.current;
    if (!target) return;

    if (typeof target.volume === "number" && Number.isFinite(target.volume)) {
      setVolume(target.volume);
    }
    if (typeof target.muted === "boolean") {
      setMuted(target.muted);
    } else if (typeof target.volume === "number" && target.volume === 0) {
      setMuted(true);
    }
  });

  const playTwitchDuringUserGesture = useCallback(() => {
    if (providerName !== "twitch") return;
    const players = [realPlayerRef.current, playerRef.current];
    for (const player of players) {
      if (typeof player?.play === "function") {
        try {
          player.play();
        } catch {
          // Twitch may still reject if the embed is not visible yet; sync loop retries.
        }
      }
    }
  }, [providerName]);

  const performProgrammaticSeek = (position: number, force = false) => {
    // Soft Mode Guarantee: If we are in "echo protection" (last action was ours),
    // never perform hard seeks during this interval, only drift math updates.
    if (!force && intentManager.isIgnoringNativeEvents()) return;

    nativePauseResumeRef.current = null;
    intentManager.markProgrammaticSeek();
    const provider = currentMedia?.provider?.toLowerCase();
    if (seekPlayerTo(realPlayerRef.current, position, provider)) return;
    seekPlayerTo(playerRef.current, position, provider);
  };

  // Track upNext dismissal per media item
  const [upNextDismissedForMedia, setUpNextDismissedForMedia] = useState<
    string | null
  >(null);

  useEffect(() => {
    setProviderEventEpoch(intentManager.advanceProviderEventEpoch());
    setError(null);
    setIsReady(false);
    healthController.beginMedia(currentMediaId ?? null);
    setUpNextDismissedForMedia(null);

    // STATE-BASED MEDIA TRANSITION GUARD: Block native play/pause events until
    // onReady fires for this specific media ID. This replaces the old blunt 3s timer.
    // YouTube iframe fires a pause during load — this guard catches it precisely.
    if (currentMediaId) {
      intentManager.setMediaTransition(currentMediaId);
      sendCommand("media_ready", { mediaId: currentMediaId, ready: false });
    }
    // Safety net: 1.5s ignoreEventsFor as fallback in case onReady never fires
    intentManager.ignoreEventsFor(1500);
  }, [
    currentMediaId,
    room?.mediaRun,
    room?.generation,
    healthController,
    intentManager,
    sendCommand,
  ]);

  // Handle Server-Side OCC Rejections (Race Condition Flashback)
  useEffect(() => {
    if (occRollbackTick > 0 && playback && currentMediaId && canControl) {
      console.warn("OCC Rollback Triggered! Reverting optimistic UI state.");
      // The local player state (playing/paused/position) is wrong.
      const accurateCurrentTime = getAccurateTime();
      // Calculate where the server actually is *right now* mathematically
      const { expectedPosition } = calculateDrift(
        playback.status,
        playback.basePosition,
        playback.baseTimestamp,
        Date.now() + serverClockOffset,
        accurateCurrentTime,
        playback.rate,
      );

      // Flashback animation for the user to understand they "lost the click race"
      registerPossibleFlashback(
        accurateCurrentTime,
        expectedPosition,
        currentMediaId,
      );

      // Hard apply the server truth
      intentManager.ignoreEventsFor(2000);
      setPlaying(playback.status === "playing");
      performProgrammaticSeek(expectedPosition);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [occRollbackTick]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      setHostName(window.location.hostname);
      (window as any).__store = useStore;
    }
    setMounted(true);
  }, []);

  // Removed ResizeObserver effect

  // In strict server state, we don't emit commands from native events
  const emitCommand = useCallback(
    (type: string, payload: any) => {
      // BACKGROUND TAB FIX: Block false-positive pause/seek events from throttled tabs
      if (
        !isDocumentVisibleRef.current &&
        payload?.fromNative &&
        ["play", "pause", "seek"].includes(type)
      ) {
        return;
      }
      // Respect existing nonce if provided (e.g. from usePlaybackSync sync_correction),
      // otherwise generate a fresh one for UI-driven actions.
      const nonce = payload?.nonce || crypto.randomUUID();

      // Normalize command types to playback statuses for getExpectedStatus comparisons
      // ("play" → "playing", "pause" → "paused") so guards like
      // `expectedStatus !== "playing"` work correctly.
      const statusMap: Record<string, string> = {
        play: "playing",
        pause: "paused",
        seek: "playing",
        sync_correction: "playing",
      };
      const completion = COMMANDS_WITH_COMPACT_PLAYBACK_UPDATE.has(type)
        ? "playback_update"
        : "command_ack";
      intentManager.markCommandEmitted(
        statusMap[type] || type,
        payload?.position,
        nonce,
        completion,
        completion === "playback_update"
          ? {
              sequence: useStore.getState().room?.sequence ?? -1,
              mediaId: useStore.getState().room?.currentMediaId ?? null,
            }
          : null,
      );
      sendCommand(type, { ...payload, nonce });
      return nonce;
    },
    [intentManager, sendCommand],
  );

  const { driftRef } = usePlaybackSync({
    realPlayerRef,
    playerRef,
    getAccurateTime,
    getPlaying: () => playing,
    setPlaying,
    getIsReady: () => isReady,
    getSeeking: () => seeking,
    getIsConnected: () => isConnected,
    getConnectionEpoch: () => connectionEpoch,
    getConnectionDeliveryFloor: () => connectionDeliveryFloor,
    intentManager,
    healthController,
    performProgrammaticSeek,
    getCurrentMedia: () => currentMedia,
    getDuration: () => duration,
    getCanonicalDeliveryVersion: () => canonicalDeliveryVersion,
    onReconnecting: () => setIsReconnecting(true),
    onReconciled: () => setIsReconnecting(false),
  });

  const handlePlay = () => {
    if (!currentMediaId || !participantId || !canControl) return;
    setPlaying(true);
    let pos = getAccurateTime();
    if (pos === 0 && playback && playback.basePosition > 2) {
      pos = playback.basePosition;
    }

    // Bypass iframe autoplay restrictions for Twitch by calling play synchronously during the click event
    playTwitchDuringUserGesture();

    emitCommand("play", { position: pos });
  };

  const handlePause = () => {
    if (!currentMediaId || !participantId || !canControl) return;
    setPlaying(false);
    emitCommand("pause", { position: getAccurateTime() });
  };

  const handleNativePlay = useEventCallback(() => {
    const nativePause = nativePauseResumeRef.current;
    nativePauseResumeRef.current = null;
    const currentRoom = useStore.getState().room;
    // Only a current, emitted native Pause can authorize a rapid resume inside
    // the seek window. A later seek clears this correlation, including paused
    // seeks whose synthetic Play must remain suppressed.
    const resumesNativePause =
      providerName === "youtube" &&
      healthController.canAcceptProviderEvents() &&
      nativePause !== null &&
      intentManager.isProviderEventEpochCurrent(nativePause.providerEpoch) &&
      currentRoom?.currentMediaId === nativePause.mediaId &&
      ((currentRoom?.sequence === nativePause.sequence &&
        intentManager.isAwaitingServerAck() &&
        intentManager.lastStateEmittedRef?.nonce === nativePause.nonce) ||
        ((currentRoom?.sequence ?? -1) > nativePause.sequence &&
          currentRoom?.playback.status === "paused" &&
          currentRoom.playback.lastActionNonce === nativePause.nonce));
    // Canonical reconciliation holds the provider paused during the native
    // pause debounce, so an intervening Play is a fresh local resume.
    intentManager.clearPauseDebounce();
    healthController.set("ready");
    setPlaying(true);

    if (
      intentManager.isInMediaTransition() ||
      intentManager.isUserDraggingScrubber() ||
      (intentManager.isRecentProgrammaticSeek(1500) && !resumesNativePause)
    ) {
      return;
    }

    // YouTube native controls should not lose deliberate play clicks during the
    // short post-command ACK window.
    if (providerName !== "youtube" && intentManager.shouldBlockNativeEvent()) {
      return;
    }

    // [Problem 1 Fix/Race Condition Fix]: Rely on local Optimistic UI identity if recent action fired,
    // otherwise fallback to websocket state.
    const expectedStatus = intentManager.getExpectedStatus(playback?.status);

    if (canControl && expectedStatus !== "playing") {
      emitCommand("play", { position: getAccurateTime(), fromNative: true });
    }
  });

  const handleNativePause = useEventCallback(() => {
    intentManager.clearPauseDebounce();

    // A recent canonical seek alone does not identify a synthetic YouTube
    // Pause. Its current-provider health gate and deferred validation still
    // reject unavailable/stale events; other providers retain seek suppression.
    if (
      intentManager.isInMediaTransition() ||
      intentManager.isUserDraggingScrubber() ||
      (providerName !== "youtube" &&
        intentManager.isRecentProgrammaticSeek(1500))
    ) {
      return;
    }

    if (providerName !== "youtube" && intentManager.shouldBlockNativeEvent()) {
      return;
    }

    // A3 Fix: Twitch fires a ghost PAUSE after seek ops. Its async pipeline
    // can delay the event beyond the standard shouldBlockNativeEvent window.
    // Use a wider 2500ms seek-detection window specifically for Twitch.
    if (
      providerName === "twitch" &&
      (intentManager.isRecentProgrammaticSeek(2500) ||
        intentManager.isRecentCommand(2500))
    ) {
      console.log("[PLAYER] Blocked Twitch phantom pause after recent seek");
      return;
    }

    setPlaying(false);

    const deferredEpoch = intentManager.currentProviderEventEpoch();
    const deferredMediaId = currentMediaId;
    const deferredSequence = room?.sequence ?? -1;
    intentManager.setPauseDebounce(() => {
      const deferredRoom = useStore.getState().room;
      if (
        !healthController.canAcceptProviderEvents() ||
        !intentManager.isProviderEventEpochCurrent(deferredEpoch) ||
        deferredRoom?.currentMediaId !== deferredMediaId ||
        (deferredRoom?.sequence ?? -1) !== deferredSequence
      ) {
        return;
      }
      // Look at local state first
      const currentPlayback = useStore.getState().room?.playback;
      const expectedStatus = intentManager.getExpectedStatus(
        currentPlayback?.status,
      );

      if (canControl && expectedStatus !== "paused") {
        const nonce = emitCommand("pause", {
          position: getAccurateTime(),
          fromNative: true,
        });
        if (providerName === "youtube" && nonce) {
          nativePauseResumeRef.current = {
            nonce,
            mediaId: deferredMediaId,
            providerEpoch: deferredEpoch,
            sequence: deferredSequence,
          };
        }
      }
    }, PAUSE_DEBOUNCE_MS);
  });

  const playerEvents = usePlayerEvents({
    intentManager,
    healthController,
    realPlayerRef,
    playerRef,
    currentMediaId,
    canonicalSequence: room?.sequence ?? -1,
    providerEventEpoch,
    canControl,
    playing,
    setIsReady,
    setError,
    setPlaying,
    setDuration,
    emitCommand,
    handleNativePlay,
    handleNativePause,
  });

  useEffect(() => {
    if (!isReady || providerName !== "twitch") return;
    return applyTwitchEventProxy(
      playerRef,
      realPlayerRef,
      playerEvents.handleNativePlay,
      playerEvents.handleNativePause,
    );
  }, [
    isReady,
    providerName,
    playerRef,
    realPlayerRef,
    playerEvents.handleNativePlay,
    playerEvents.handleNativePause,
  ]);

  // C1: Keyboard seek handler
  const handleKeyboardSeek = useCallback(
    (delta: number) => {
      const currentPos = getAccurateTime();
      const newPos = Math.max(0, Math.min(duration, currentPos + delta));
      // P6: Allow user play/pause clicks during seek ignore window
      intentManager.ignoreEventsFor(2000, true);
      const provider = providerName;
      if (!seekPlayerTo(realPlayerRef.current, newPos, provider)) {
        seekPlayerTo(playerRef.current, newPos, provider);
      }
      if (canControl) {
        if (playing) {
          emitCommand("play", { position: newPos, forceSeek: true });
        } else {
          emitCommand("seek", { position: newPos });
        }
      }
    },
    [
      getAccurateTime,
      duration,
      intentManager,
      canControl,
      playing,
      emitCommand,
      providerName,
    ],
  );

  // C2: Double-click fullscreen toggle
  const toggleFullscreen = useCallback(() => {
    if (fscreen.fullscreenEnabled && containerRef.current) {
      if (fscreen.fullscreenElement) {
        fscreen.exitFullscreen();
      } else {
        fscreen.requestFullscreen(containerRef.current);
      }
    }
  }, []);

  usePlayerShortcuts({
    canControl,
    playing,
    muted,
    handlePlay,
    handlePause,
    setMuted,
    handleSeek: handleKeyboardSeek,
    setVolume,
    getVolume: () => volume,
    toggleFullscreen,
    toggleTheaterMode,
  });

  const handleSeekMouseDown = () => {
    setSeeking(true);
  };

  const handleSeekMouseUp = (percent: number) => {
    setSeeking(false);
    const newPosition = percent * duration;

    // Register flashback for large jumps
    if (currentMediaId && canControl) {
      registerPossibleFlashback(getAccurateTime(), newPosition, currentMediaId);
    }

    // **INTENT MASK**: Vital for preventing rewind rollback. Drop native buffering events caused by this manual seek.
    // P6: Allow user play/pause clicks during this window
    intentManager.ignoreEventsFor(2000, true);

    const provider = providerName;
    const didSeekRealPlayer = seekPlayerTo(
      realPlayerRef.current,
      newPosition,
      provider,
    );
    if (didSeekRealPlayer) {
      // Explicitly call .play() since Twitch pauses on seek
      const realPlayer = realPlayerRef.current;
      if (
        playing &&
        provider === "twitch" &&
        typeof realPlayer?.play === "function"
      ) {
        realPlayer.play();
      }
    } else if (seekPlayerTo(playerRef.current, newPosition, provider)) {
      const player = playerRef.current;
      if (
        playing &&
        provider === "twitch" &&
        typeof player?.play === "function"
      ) {
        player.play();
      }
    }

    if (canControl) {
      if (playing) {
        emitCommand("play", { position: newPosition, forceSeek: true });
      } else {
        emitCommand("seek", { position: newPosition });
      }
    }
  };

  const handleNext = () => {
    emitCommand("next", { currentMediaId });
  };

  const reinitializeProvider = useCallback(() => {
    if (!currentMediaId) return;

    setProviderEventEpoch(intentManager.advanceProviderEventEpoch());
    healthController.beginMedia(currentMediaId);
    setError(null);
    setIsReady(false);
    setDuration(0);
    setProviderRetryKey((key) => key + 1);
  }, [currentMediaId, healthController, intentManager]);

  const canSkipUnavailable = Boolean(
    currentMediaId && (permissions?.isLeader || permissions?.isOwnerOrMod),
  );

  // formatTime is now imported from @/lib/utils

  const nextItem = useStore(
    useShallow((s) => {
      if (!s.room || !currentMediaId) return null;
      const idx = s.room.playlist.findIndex((i) => i.id === currentMediaId);
      if (idx === -1) return null;
      let n = s.room.playlist[idx + 1];
      if (!n && s.room.settings.looping) n = s.room.playlist[0];
      return n;
    }),
  );

  const [upNextState, setUpNextState] = useState({ show: false, remaining: 0 });

  useEffect(() => {
    if (!autoplayNext || !canControl || duration === 0) return;

    const interval = setInterval(() => {
      const remaining = duration - getAccurateTime();
      const shouldShow = remaining <= 5 && remaining > 0;

      setUpNextState((prev) => {
        if (
          prev.show === shouldShow &&
          (!shouldShow || Math.ceil(prev.remaining) === Math.ceil(remaining))
        ) {
          return prev; // Avoid unnecessary re-renders
        }
        return { show: shouldShow, remaining };
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [duration, getAccurateTime, autoplayNext, canControl, playing]);

  if (!currentMedia) {
    return (
      <AwaitingSignal
        canAddPlaylist={canAddPlaylist}
        participantCount={participantCount}
        sendCommand={sendCommand}
      />
    );
  }

  // (Hooks merged upwards, see top of render)

  const timeRemaining = upNextState.remaining;
  const showUpNext = upNextState.show && nextItem !== null;

  return (
    <div
      ref={containerRef}
      className="bg-theme-bg group react-player-wrapper border-theme-border/50 font-theme relative flex h-full w-full flex-1 flex-col border-y-2 lg:border-x-2 lg:border-y-0"
      data-testid="player-interaction-layer"
    >
      <div
        className="relative h-full min-h-[40vh] w-full flex-1 md:min-h-full"
        onClick={() => {
          // Click outside player area — no-op (quality menu is now self-contained)
        }}
        onDoubleClick={(e) => {
          // C2: Double-click to toggle fullscreen (ignore if clicking controls)
          const target = e.target as HTMLElement;
          if (target.closest("button") || target.closest("input")) return;
          toggleFullscreen();
        }}
      >
        <div
          className="absolute top-0 left-0 h-full w-full origin-top-left transition-transform duration-700"
          style={{ pointerEvents: "auto" }}
        >
          {mounted && (
            <ReactPlayer
              key={`${room?.generation ?? "legacy"}-${room?.mediaRun ?? 0}-${currentMediaId}-${providerRetryKey}`}
              ref={playerRef}
              src={currentMedia.url}
              width="100%"
              height="100%"
              controls={usesNativeProviderControls}
              playing={userJoined ? playing : false}
              volume={volume}
              muted={userJoined ? muted : true}
              onVolumeChange={handleNativeVolumeChange}
              onLoadedMetadata={() =>
                playerEvents.handleReady(
                  playerRef.current,
                  providerName === "twitch",
                )
              }
              onError={playerEvents.handleError}
              onSeeked={() => {
                playerEvents.handleSeek(
                  getAccurateTime(),
                  providerName === "twitch",
                );
                playerEvents.handleSeeked();
              }}
              onDurationChange={playerEvents.handleDurationChange}
              onEnded={playerEvents.handleEnded}
              onWaiting={playerEvents.handleWaiting}
              onPlaying={playerEvents.handlePlaying}
              onPlay={playerEvents.handleNativePlay}
              onPause={playerEvents.handleNativePause}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                visibility: "visible",
                opacity: 1,
              }}
              config={{
                youtube: {
                  controls: 1,
                  disablekb: 0,
                  modestbranding: 1,
                  rel: 1,
                  showinfo: 0,
                  origin:
                    typeof window !== "undefined"
                      ? window.location.origin
                      : process.env.NEXT_PUBLIC_APP_URL,
                  enablejsapi: 1,
                },
                twitch: { parent: hostName },
                vimeo: { playerOptions: { controls: canControl } },
              }}
            />
          )}
        </div>

        {/* Up Next Overlay Layer */}
        {showUpNext && upNextDismissedForMedia !== currentMediaId && (
          <UpNextOverlay
            timeRemaining={timeRemaining}
            nextItem={nextItem}
            onSkip={handleNext}
            onDismiss={() => setUpNextDismissedForMedia(currentMediaId ?? null)}
          />
        )}

        {/* Universal Sync Status Badge — visible for ALL providers */}
        <SyncStatusBadge
          driftRef={driftRef}
          playbackHealth={playbackHealth}
          reconnecting={isReconnecting}
        />

        {/* Thematic Scanline Overlay */}
        {currentMedia.provider?.toLowerCase() !== "youtube" && (
          <div className="pointer-events-none absolute inset-0 z-0 bg-[linear-gradient(rgba(0,0,0,0)_50%,rgba(0,0,0,0.1)_50%)] bg-size-[100%_4px] opacity-30 mix-blend-overlay" />
        )}

        {/* Interaction overlay - Blocks native interaction but allows custom controls */}
        {currentMedia.provider?.toLowerCase() !== "youtube" &&
          currentMedia.provider?.toLowerCase() !== "twitch" && (
            <>
              {/* Main click capture layer */}
              <button
                type="button"
                aria-label={playing ? "Pause" : "Play"}
                className={`absolute inset-0 z-10 ${canControl ? "cursor-pointer" : "cursor-default"}`}
                onClick={() => {
                  if (canControl) {
                    playing ? handlePause() : handlePlay();
                  }
                }}
                disabled={!canControl}
              />
            </>
          )}

        {error && (
          <ErrorOverlay
            message={error}
            onRetry={reinitializeProvider}
            onReinitializeSync={reinitializeProvider}
            onSkip={canSkipUnavailable ? handleNext : undefined}
          />
        )}

        {isBuffering && playing && !error && <BufferingOverlay />}

        {/* PAUSED Overlay */}
        {!playing && isReady && !error && userJoined && (
          <PausedOverlay canControl={canControl} onPlay={handlePlay} />
        )}

        {/* User Gesture Guard Overlay */}
        {!userJoined && (
          <UserGestureGuard
            onActivate={() => {
              setUserJoined(true);
              if (playback?.status === "playing") {
                setPlaying(true);
                playTwitchDuringUserGesture();
              }
            }}
          />
        )}

        {/* Smart Sleep Mode Overlay */}
        {isSleeping && <SleepOverlay onWakeUp={wakeUp} />}
      </div>

      {/* Custom Controls Panel */}
      {currentMedia.provider?.toLowerCase() !== "youtube" &&
        currentMedia.provider?.toLowerCase() !== "twitch" && (
          <PlayerControlBar
            playerRef={realPlayerRef}
            containerRef={containerRef}
            duration={duration}
            playing={playing}
            canControl={canControl}
            currentMedia={currentMedia}
            playback={playback}
            currentMediaId={currentMediaId ?? null}
            flashbacks={flashbacks}
            popFlashback={popFlashback}
            onPlay={handlePlay}
            onPause={handlePause}
            onNext={handleNext}
            onSeekStart={handleSeekMouseDown}
            onSeekEnd={handleSeekMouseUp}
          />
        )}
    </div>
  );
}
