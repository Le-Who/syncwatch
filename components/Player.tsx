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
import { MediaApiService } from "@/lib/MediaApiService";
import {
  RoomState,
  PlaybackState,
  PlaybackStatus,
  PlayerMethods,
} from "@/lib/types";
import { TwitchPlayer } from "./TwitchPlayer";
import { usePlayerShortcuts } from "@/hooks/usePlayerShortcuts";
import { useFlashback } from "@/hooks/useFlashback";
import { usePlaybackSync } from "@/hooks/usePlaybackSync";
import { usePlayerEvents } from "@/hooks/usePlayerEvents";
import { applyTwitchEventProxy } from "@/lib/player-adapters";
import { PAUSE_DEBOUNCE_MS } from "@/lib/sync-config";
import { AwaitingSignal } from "./AwaitingSignal";
import { UpNextOverlay } from "./UpNextOverlay";
import { SyncStatusBadge } from "./SyncStatusBadge";
import { PlayerControlBar } from "./PlayerControlBar";
import { PlaybackIntentManager } from "@/lib/playback-intent-manager";
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

export default function Player() {
  const participantId = useStore((s) => s.participantId);
  const sendCommand = useStore((s) => s.sendCommand);
  const serverClockOffset = useStore((s) => s.serverClockOffset);
  const currentMediaId = useStore((s) => s.room?.currentMediaId);
  const occRollbackTick = useStore((s) => s.occRollbackTick);
  const isLooping = useStore((s) => s.room?.settings.looping);
  const autoplayNext = useStore((s) => s.room?.settings.autoplayNext);
  const controlMode = useStore((s) => s.room?.settings.controlMode);

  const myRole = useStore(
    (s) => s.participantId && s.room?.participants[s.participantId]?.role,
  );

  const currentMedia = useStore(
    useShallow((s) =>
      s.room?.playlist.find((item) => item.id === s.room?.currentMediaId),
    ),
  );

  const playback = useStore(useShallow((s) => s.room?.playback));

  const participantCount = useStore((s) =>
    s.room ? Object.keys(s.room.participants).length : 0,
  );

  const canControl =
    controlMode === "open" ||
    controlMode === "hybrid" ||
    myRole === "owner" ||
    myRole === "moderator";

  const canEditPlaylist =
    controlMode === "open" || myRole === "owner" || myRole === "moderator";

  const { volume, muted, theaterMode, setVolume, setMuted, toggleTheaterMode } =
    useSettingsStore();
  const playerRef = useRef<PlayerMethods | null>(null); // React component wrapper ref
  const realPlayerRef = useRef<PlayerMethods | null>(null); // Actual ReactPlayer instance
  const containerRef = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [seeking, setSeeking] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hostName, setHostName] = useState<string>("localhost");
  const [mounted, setMounted] = useState(false);
  const [userJoined, setUserJoined] = useState(false);
  const [useNativeTwitch, setUseNativeTwitch] = useState(false);
  const { flashbacks, registerPossibleFlashback, popFlashback } =
    useFlashback();

  const [isSleeping, setIsSleeping] = useState(false);
  const isSleepingRef = useRef(false);
  const idleTimeoutRef = useRef<NodeJS.Timeout | null>(null);

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

    window.addEventListener("mousemove", handleUserActivity);
    window.addEventListener("keydown", handleUserActivity);
    window.addEventListener("touchstart", handleUserActivity);
    window.addEventListener("click", handleUserActivity);

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
    if (realPlayerRef.current?.getCurrentTime) {
      return realPlayerRef.current.getCurrentTime();
    }
    return playerRef.current?.currentTime || 0;
  }, []);

  const performProgrammaticSeek = (position: number) => {
    // Soft Mode Guarantee: If we are in "echo protection" (last action was ours),
    // never perform hard seeks during this interval, only drift math updates.
    if (intentManager.isIgnoringNativeEvents()) return;

    intentManager.markProgrammaticSeek();
    if (
      realPlayerRef.current &&
      typeof realPlayerRef.current.seekTo === "function"
    ) {
      realPlayerRef.current.seekTo(position, "seconds");
    } else if (playerRef.current) {
      playerRef.current.currentTime = position; // Fallback
    }
  };

  // Track upNext dismissal per media item
  const [upNextDismissedForMedia, setUpNextDismissedForMedia] = useState<
    string | null
  >(null);

  useEffect(() => {
    setError(null);
    setIsReady(false);
    setIsBuffering(false);
    setUpNextDismissedForMedia(null);

    // STATE-BASED MEDIA TRANSITION GUARD: Block native play/pause events until
    // onReady fires for this specific media ID. This replaces the old blunt 3s timer.
    // YouTube iframe fires a pause during load — this guard catches it precisely.
    if (currentMediaId) {
      intentManager.setMediaTransition(currentMediaId);
    }
    // Safety net: 1.5s ignoreEventsFor as fallback in case onReady never fires
    intentManager.ignoreEventsFor(1500);
  }, [currentMediaId, intentManager]);

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
  const emitCommand = useCallback((type: string, payload: any) => {
    // BACKGROUND TAB FIX: Block false-positive pause/seek events from throttled tabs
    if (
      !isDocumentVisibleRef.current &&
      payload?.fromNative &&
      ["play", "pause", "seek", "buffering"].includes(type)
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
      buffering: "buffering",
      sync_correction: "playing",
    };
    intentManager.markCommandEmitted(
      statusMap[type] || type,
      payload?.position,
      nonce,
    );
    sendCommand(type, { ...payload, nonce });
  }, [intentManager, sendCommand]);

  // P4 Fix: Capture join time for clock sync grace period
  const [joinedAt] = useState(() => Date.now());

  const { driftRef } = usePlaybackSync({
    realPlayerRef,
    playerRef,
    getAccurateTime,
    getPlaying: () => playing,
    setPlaying,
    getIsReady: () => isReady,
    getSeeking: () => seeking,
    getIsBuffering: () => isBuffering,
    intentManager,
    performProgrammaticSeek,
    getControlMode: () => controlMode,
    getMyRole: () => myRole,
    getCurrentMedia: () => currentMedia,
    getDuration: () => duration,
    emitCommand,
    joinedAt,
  });

  const handlePlay = () => {
    if (!currentMediaId || !participantId || !canControl) return;
    setPlaying(true);
    let pos = getAccurateTime();
    if (pos === 0 && playback && playback.basePosition > 2) {
      pos = playback.basePosition;
    }

    // Bypass iframe autoplay restrictions for Twitch by calling play synchronously during the click event
    if (
      currentMedia?.provider?.toLowerCase() === "twitch" &&
      realPlayerRef.current &&
      typeof realPlayerRef.current.play === "function"
    ) {
      realPlayerRef.current.play();
    }

    emitCommand("play", { position: pos });
  };

  const handlePause = () => {
    if (!currentMediaId || !participantId || !canControl) return;
    setPlaying(false);
    emitCommand("pause", { position: getAccurateTime() });
  };

  const handleNativePlay = useEventCallback(() => {
    intentManager.clearPauseDebounce();
    setIsBuffering(false);
    setPlaying(true);

    // **INTENT MASK**: Drop events caused by programmatic seek buffer locks or scrubber dragging
    if (intentManager.shouldBlockNativeEvent()) {
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
    setIsBuffering(false);
    intentManager.clearPauseDebounce();

    // **INTENT MASK**: Drop events caused by programmatic seek buffer locks,
    // scrubber dragging, or media transitions (currentMediaId change).
    // Must guard BEFORE setPlaying(false) to prevent local state corruption
    // that causes the player to stay paused after queue advancement.
    if (intentManager.shouldBlockNativeEvent()) {
      return;
    }

    // A3 Fix: Twitch fires a ghost PAUSE after seek ops. Its async pipeline
    // can delay the event beyond the standard shouldBlockNativeEvent window.
    // Use a wider 2500ms seek-detection window specifically for Twitch.
    if (
      currentMedia?.provider?.toLowerCase() === "twitch" &&
      (intentManager.isRecentProgrammaticSeek(2500) ||
        intentManager.isRecentCommand(2500))
    ) {
      console.log("[PLAYER] Blocked Twitch phantom pause after recent seek");
      return;
    }

    setPlaying(false);

    intentManager.setPauseDebounce(() => {
      // Look at local state first
      const currentPlayback = useStore.getState().room?.playback;
      const expectedStatus = intentManager.getExpectedStatus(
        currentPlayback?.status,
      );

      if (canControl && expectedStatus !== "paused") {
        emitCommand("pause", { position: getAccurateTime(), fromNative: true });
      }
    }, PAUSE_DEBOUNCE_MS);
  });

  const playerEvents = usePlayerEvents({
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
  });

  // C1: Keyboard seek handler
  const handleKeyboardSeek = useCallback(
    (delta: number) => {
      const currentPos = getAccurateTime();
      const newPos = Math.max(0, Math.min(duration, currentPos + delta));
      // P6: Allow user play/pause clicks during seek ignore window
      intentManager.ignoreEventsFor(2000, true);
      if (
        realPlayerRef.current &&
        typeof realPlayerRef.current.seekTo === "function"
      ) {
        realPlayerRef.current.seekTo(newPos, "seconds");
      } else if (playerRef.current) {
        playerRef.current.currentTime = newPos;
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

    if (
      realPlayerRef.current &&
      typeof realPlayerRef.current.seekTo === "function"
    ) {
      realPlayerRef.current.seekTo(newPosition, "seconds");
      // Explicitly call .play() since Twitch pauses on seek
      if (
        playing &&
        currentMedia?.provider?.toLowerCase() === "twitch" &&
        realPlayerRef.current.play
      ) {
        realPlayerRef.current.play();
      }
    } else if (playerRef.current) {
      playerRef.current.currentTime = newPosition;
      if (
        playing &&
        currentMedia?.provider?.toLowerCase() === "twitch" &&
        typeof playerRef.current.play === "function"
      ) {
        playerRef.current.play();
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

  // formatTime is now imported from @/lib/utils

  const nextItem = useStore(useShallow((s) => {
    if (!s.room || !currentMediaId) return null;
    const idx = s.room.playlist.findIndex((i) => i.id === currentMediaId);
    if (idx === -1) return null;
    let n = s.room.playlist[idx + 1];
    if (!n && s.room.settings.looping) n = s.room.playlist[0];
    return n;
  }));

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
        canEditPlaylist={canEditPlaylist}
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
          {mounted &&
            (currentMedia.provider?.toLowerCase() !== "twitch" ||
              userJoined) && (
              <>
                {currentMedia.provider?.toLowerCase() === "twitch" ? (
                  <TwitchPlayer
                    ref={playerRef}
                    url={currentMedia.url}
                    width="100%"
                    height="100%"
                    playing={userJoined ? playing : false}
                    volume={volume}
                    muted={userJoined ? muted : true}
                    controls={true}
                    onReady={(rPlayer: PlayerMethods) => playerEvents.handleReady(rPlayer, true)}
                    onError={playerEvents.handleError}
                    onSeek={(seconds: number) => playerEvents.handleSeek(seconds, true)}
                    onDurationChange={playerEvents.handleDurationChange}
                    onEnded={playerEvents.handleEnded}
                    onWaiting={playerEvents.handleWaiting}
                    onPlaying={playerEvents.handlePlaying}
                    onPlay={playerEvents.handleNativePlay}
                    onPause={playerEvents.handleNativePause}
                  />
                ) : (
                  <ReactPlayer
                    ref={playerRef}
                    src={currentMedia.url}
                    width="100%"
                    height="100%"
                    controls={
                      currentMedia.provider?.toLowerCase() === "youtube"
                    }
                    playing={userJoined ? playing : false}
                    volume={volume}
                    muted={userJoined ? muted : true}
                    onReady={(rPlayer: PlayerMethods) => playerEvents.handleReady(rPlayer, false)}
                    onError={playerEvents.handleError}
                    onSeek={(seconds: number) => playerEvents.handleSeek(seconds, false)}
                    onSeeked={playerEvents.handleSeeked}
                    onDurationChange={playerEvents.handleDurationChange}
                    onEnded={playerEvents.handleEnded}
                    onWaiting={playerEvents.handleWaiting}
                    onPlaying={playerEvents.handlePlaying}
                    onPlay={playerEvents.handleNativePlay}
                    onPause={playerEvents.handleNativePause}
                    style={{ position: "absolute", top: 0, left: 0 }}
                    config={{
                      youtube: {
                        playerVars: {
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
                      },
                      vimeo: { playerOptions: { controls: false } },
                    }}
                  />
                )}
              </>
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
        <SyncStatusBadge driftRef={driftRef} />

        {/* Thematic Scanline Overlay */}
        {currentMedia.provider?.toLowerCase() !== "youtube" && (
          <div className="pointer-events-none absolute inset-0 z-0 bg-[linear-gradient(rgba(0,0,0,0)_50%,rgba(0,0,0,0.1)_50%)] bg-size-[100%_4px] opacity-30 mix-blend-overlay" />
        )}

        {/* Interaction overlay - Blocks native interaction but allows custom controls */}
        {currentMedia.provider?.toLowerCase() !== "youtube" &&
          currentMedia.provider?.toLowerCase() !== "twitch" && (
            <>
              {/* Main click capture layer */}
              <div
                className={`absolute inset-0 z-10 ${canControl ? "cursor-pointer" : "cursor-default"}`}
                onClick={() => {
                  if (canControl) {
                    playing ? handlePause() : handlePlay();
                  }
                }}
              />
            </>
          )}

        {error && <ErrorOverlay message={error} />}

        {/* Buffering Overlay - Yield to explicit Pause state */}
        {(isBuffering || playback?.status === "buffering") &&
          playing &&
          !error && (
            <BufferingOverlay playback={playback} isLocalBuffering={isBuffering} />
          )}

        {/* PAUSED Overlay */}
        {!playing && !isBuffering && isReady && !error && userJoined && (
          <PausedOverlay canControl={canControl} onPlay={handlePlay} />
        )}

        {/* User Gesture Guard Overlay */}
        {!userJoined && (
          <UserGestureGuard onActivate={() => setUserJoined(true)} />
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

