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
import {
  Play,
  Pause,
  SkipForward,
  SkipBack,
  Volume2,
  VolumeX,
  Maximize,
  MonitorPlay,
  AlertCircle,
  Settings,
  ExternalLink,
} from "lucide-react";
import fscreen from "fscreen";
import { motion } from "motion/react";
import { formatTime, calculateDrift } from "@/lib/utils";
import { Scrubber } from "./Scrubber";
import { MediaApiService } from "@/lib/MediaApiService";
import { RoomState, PlaybackState, PlaybackStatus } from "@/lib/types";
import { TwitchPlayer } from "./TwitchPlayer";
import { usePlayerShortcuts } from "@/hooks/usePlayerShortcuts";
import { useFlashback } from "@/hooks/useFlashback";
import { Undo2 } from "lucide-react";
import { usePlaybackSync } from "@/hooks/usePlaybackSync";
import { applyTwitchEventProxy } from "@/lib/player-adapters";
import { AwaitingSignal } from "./AwaitingSignal";
import { UpNextOverlay } from "./UpNextOverlay";
import { SyncStatusBadge } from "./SyncStatusBadge";
import { PlaybackIntentManager } from "@/lib/playback-intent-manager";

const ReactPlayer = dynamic(() => import("react-player"), {
  ssr: false,
}) as any;

export default function Player() {
  const participantId = useStore((s) => s.participantId);
  const sendCommand = useStore((s) => s.sendCommand);
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
  const playerRef = useRef<any>(null); // React component wrapper ref
  const realPlayerRef = useRef<any>(null); // Actual ReactPlayer instance
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

  const isDocumentVisibleRef = useRef(true);

  useEffect(() => {
    if (typeof document !== "undefined") {
      const handleVisibilityChange = () => {
        isDocumentVisibleRef.current = !document.hidden;
      };
      document.addEventListener("visibilitychange", handleVisibilityChange);
      return () =>
        document.removeEventListener(
          "visibilitychange",
          handleVisibilityChange,
        );
    }
  }, []);

  const [isSleeping, setIsSleeping] = useState(false);
  const idleTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const wakeUp = useCallback(() => {
    if (isSleeping) {
      setIsSleeping(false);
      const state = useStore.getState();
      if (state.room && !state.isConnected) {
        state.connect(state.room.id, state.nickname);
      }
    }
  }, [isSleeping]);

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

  const [qualityMenuOpen, setQualityMenuOpen] = useState(false);
  const [providerQualities, setProviderQualities] = useState<string[]>([]);
  const [currentProviderQuality, setCurrentProviderQuality] =
    useState<string>("auto");
  const [hlsLevels, setHlsLevels] = useState<{ height: number }[]>([]);
  const [currentHlsLevel, setCurrentHlsLevel] = useState<number>(-1);

  // Removed ResizeObserver dimensions

  const [intentManager] = useState(() => new PlaybackIntentManager());

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
        Date.now() + useStore.getState().serverClockOffset,
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
      ["play", "pause", "seek", "buffering"].includes(type)
    ) {
      return;
    }
    const nonce = crypto.randomUUID(); // Manually create a nonce to track our own UI actions locally before store
    // Normalize command types to playback statuses for getExpectedStatus comparisons
    // ("play" → "playing", "pause" → "paused") so guards like
    // `expectedStatus !== "playing"` work correctly.
    const statusMap: Record<string, string> = {
      play: "playing",
      pause: "paused",
      seek: "playing",
      buffering: "buffering",
    };
    intentManager.markCommandEmitted(
      statusMap[type] || type,
      payload?.position,
      nonce,
    );
    sendCommand(type, { ...payload, nonce });
  }, [intentManager, sendCommand]);

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
      emitCommand("play", { position: getAccurateTime() });
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
    // Use a wider 500ms seek-detection window specifically for Twitch.
    if (
      currentMedia?.provider?.toLowerCase() === "twitch" &&
      intentManager.isRecentSeek(500)
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
        emitCommand("pause", { position: getAccurateTime() });
      }
    }, 50);
  });

  // C1: Keyboard seek handler
  const handleKeyboardSeek = useCallback(
    (delta: number) => {
      const currentPos = getAccurateTime();
      const newPos = Math.max(0, Math.min(duration, currentPos + delta));
      intentManager.ignoreEventsFor(2000);
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
    [getAccurateTime, duration, intentManager, canControl, playing, emitCommand],
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
    intentManager.ignoreEventsFor(2000);

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

  const nextItem = useStore((s) => {
    if (!s.room || !currentMediaId) return null;
    const idx = s.room.playlist.findIndex((i) => i.id === currentMediaId);
    if (idx === -1) return null;
    let n = s.room.playlist[idx + 1];
    if (!n && s.room.settings.looping) n = s.room.playlist[0];
    return n;
  });

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
          if (qualityMenuOpen) setQualityMenuOpen(false);
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
                    onReady={(rPlayer: any) => {
                      realPlayerRef.current = playerRef.current;
                      setIsReady(true);
                      setError(null);

                      // Clear state-based transition guard for this media
                      if (currentMediaId) {
                        intentManager.clearMediaTransition(currentMediaId);
                      }

                      // Auto-resume if server is playing after media switch
                      const currentPlayback =
                        useStore.getState().room?.playback;
                      if (currentPlayback?.status === "playing") {
                        setPlaying(true);
                      }
                    }}
                    onError={(e: any) => {
                      console.error("Twitch Player error:", e);
                      setError("SYSTEM FAILURE. SIGNAL LOST.");
                      setIsBuffering(false);
                    }}
                    onSeek={(seconds: number) => {
                      // If it's a programmatic seek responding to the server, ignore it.
                      if (intentManager.isRecentProgrammaticSeek(1500)) return;

                      // If it's a local seek via scrubber, it would have already emitted
                      if (intentManager.isRecentCommand(1500)) return;

                      if (canControl) {
                        emitCommand("seek", { position: seconds });

                        // Twitch native player auto-pauses when scrubbing.
                        // If we were playing before the scrub, auto-resume after a short delay.
                        if (playing) {
                          intentManager.ignoreEventsFor(2000); // Suppress incoming Twitch native pause
                          setTimeout(() => {
                            if (realPlayerRef.current?.play) {
                              realPlayerRef.current.play();
                            }
                          }, 200);
                        }
                      }
                    }}
                    onDurationChange={(dur: number) => {
                      setDuration(dur);
                      if (canControl && currentMediaId) {
                        emitCommand("update_duration", {
                          itemId: currentMediaId,
                          duration: dur,
                        });
                      }
                    }}
                    onEnded={() => {
                      if (canControl) {
                        emitCommand("video_ended", {
                          currentMediaId,
                        });
                      }
                    }}
                    onWaiting={() => {
                      setIsBuffering(true);
                      if (canControl) {
                        emitCommand("buffering", {
                          position: getAccurateTime(),
                        });
                      }
                    }}
                    onPlaying={() => {
                      setIsBuffering(false);
                    }}
                    onPlay={() => {
                      // removed undefined lastCommandEmitTimeRef debug log
                      handleNativePlay();
                    }}
                    onPause={() => {
                      // removed undefined lastCommandEmitTimeRef debug log
                      handleNativePause();
                    }}
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
                    onReady={(rPlayer: any) => {
                      realPlayerRef.current = rPlayer;
                      setIsReady(true);
                      setError(null);

                      // Clear state-based transition guard for this media
                      if (currentMediaId) {
                        intentManager.clearMediaTransition(currentMediaId);
                      }

                      // Auto-resume if server is playing after media switch
                      const currentPlayback =
                        useStore.getState().room?.playback;
                      if (currentPlayback?.status === "playing") {
                        setPlaying(true);
                      }

                      // Extract HLS Levels if it's a direct stream
                      if (
                        currentMedia.provider?.toLowerCase() !== "youtube" &&
                        currentMedia.provider?.toLowerCase() !== "twitch" &&
                        currentMedia.provider?.toLowerCase() !== "vimeo"
                      ) {
                        try {
                          const el = playerRef.current as any;
                          if (el && el.levels) {
                            setHlsLevels(el.levels);
                            setCurrentHlsLevel(el.currentLevel);
                          }
                        } catch (e) {
                          console.log(
                            "Not an HLS stream or levels unavailable.",
                          );
                        }
                      }
                    }}
                    onError={(e: any) => {
                      console.error("Player error:", e);
                      setError("SYSTEM FAILURE. SIGNAL LOST.");
                      setIsBuffering(false);
                    }}
                    onSeek={(seconds: number) => {
                      if (intentManager.isRecentProgrammaticSeek(1500)) return;
                      if (intentManager.isRecentCommand(1500)) return;

                      if (canControl) {
                        emitCommand("seek", { position: seconds });
                      }
                    }}
                    onSeeked={(e: any) => {
                      if (isBuffering) setIsBuffering(false);
                    }}
                    onDurationChange={(e: any) => {
                      const dur =
                        realPlayerRef.current?.getDuration?.() ||
                        e?.target?.duration ||
                        e?.duration ||
                        0;
                      setDuration(dur);
                      if (canControl && currentMediaId) {
                        emitCommand("update_duration", {
                          itemId: currentMediaId,
                          duration: dur,
                        });
                      }
                    }}
                    onEnded={() => {
                      if (canControl) {
                        emitCommand("video_ended", {
                          currentMediaId,
                        });
                      }
                    }}
                    onWaiting={() => {
                      setIsBuffering(true);
                      if (canControl) {
                        emitCommand("buffering", {
                          position: getAccurateTime(),
                        });
                      }
                    }}
                    onPlaying={() => {
                      setIsBuffering(false);
                    }}
                    onPlay={() => {
                      handleNativePlay();
                    }}
                    onPause={() => {
                      handleNativePause();
                    }}
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
                              : "https://69.tri.mom",
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
                className={`absolute inset-0 z-10 ${canControl ? "cursor-pointer" : "cursor-default"} ${qualityMenuOpen ? "pointer-events-none" : ""}`}
                onClick={() => {
                  if (qualityMenuOpen) {
                    return;
                  }
                  if (canControl) {
                    playing ? handlePause() : handlePlay();
                  }
                }}
              />
            </>
          )}

        {error && (
          <div className="bg-theme-bg/95 border-theme-danger absolute inset-0 z-20 flex flex-col items-center justify-center border-4 shadow-[inset_0_0_50px_var(--color-theme-danger)] backdrop-blur-sm">
            <AlertCircle className="text-theme-danger mb-4 h-16 w-16 animate-pulse" />
            <div className="bg-theme-danger text-theme-bg mb-2 rounded-full px-4 py-1 text-sm font-bold tracking-[0.2em] uppercase">
              Critical Error
            </div>
            <p className="text-theme-danger font-theme max-w-md text-center text-lg tracking-wider uppercase">
              {error}
            </p>
          </div>
        )}

        {/* Buffering Overlay - Yield to explicit Pause state */}
        {(isBuffering || playback?.status === "buffering") &&
          playing &&
          !error && (
            <div className="bg-theme-bg/80 absolute inset-0 z-20 flex flex-col items-center justify-center backdrop-blur-sm">
              <div className="border-theme-accent border-b-theme-danger mb-6 h-16 w-16 animate-spin rounded-full border-4 border-t-transparent" />
              <div className="bg-theme-accent text-theme-bg shadow-theme rounded-full px-4 py-1 text-xs font-bold tracking-[0.2em] uppercase">
                {(() => {
                  if (playback?.status === "buffering" && !isBuffering) {
                    // Another participant is buffering — resolve nickname
                    const bufferingParticipant = playback.updatedBy
                      ? useStore.getState().room?.participants[playback.updatedBy]
                      : null;
                    const displayName = bufferingParticipant?.nickname || playback.updatedBy || "someone";
                    return `Waiting for ${displayName}...`;
                  }
                  return "Buffering...";
                })()}
              </div>
            </div>
          )}

        {/* PAUSED Overlay — backdrop is pointer-events-none so YouTube/Twitch native controls remain clickable underneath. Only the play button itself captures clicks. */}
        {!playing && !isBuffering && isReady && !error && userJoined && (
          <div className="pointer-events-none absolute inset-0 z-20 flex flex-col items-center justify-center bg-black/40 backdrop-blur-[2px] transition-opacity duration-300">
            <button
              className="bg-theme-bg/80 border-theme-accent text-theme-accent pointer-events-auto flex h-24 w-24 cursor-pointer items-center justify-center rounded-full border-4 shadow-[0_0_30px_var(--color-theme-accent)] backdrop-blur-md transition-transform hover:scale-110 active:scale-95"
              onClick={(e) => {
                e.stopPropagation();
                if (canControl) handlePlay();
              }}
            >
              <Play className="ml-2 h-12 w-12" />
            </button>
          </div>
        )}

        {/* User Gesture Guard Overlay */}
        {!userJoined && (
          <div className="pointer-events-auto absolute inset-0 z-40 flex flex-col items-center justify-center bg-black/80 backdrop-blur-md">
            <button
              onClick={(e) => {
                e.stopPropagation();
                setUserJoined(true);
              }}
              className="bg-theme-accent text-theme-bg flex items-center gap-3 rounded-full px-8 py-4 font-bold tracking-widest uppercase shadow-[0_0_40px_var(--color-theme-accent)] transition-all hover:scale-105 active:scale-95"
            >
              <MonitorPlay className="h-6 w-6" />
              Initialize Stream Sync
            </button>
            <p className="text-theme-muted mt-6 text-xs tracking-widest uppercase">
              Browser policy requires manual activation
            </p>
          </div>
        )}

        {/* Smart Sleep Mode Overlay */}
        {isSleeping && (
          <div
            className="absolute inset-0 z-50 flex cursor-pointer flex-col items-center justify-center bg-black/90 backdrop-blur-md"
            onClick={wakeUp}
          >
            <MonitorPlay className="text-theme-muted mb-6 h-16 w-16 opacity-50" />
            <h2 className="text-theme-text mb-2 text-2xl font-bold tracking-widest uppercase">
              Sleep Mode
            </h2>
            <p className="text-theme-muted text-sm tracking-wider uppercase">
              Connection paused to save resources.
            </p>
            <p className="text-theme-accent mt-6 animate-pulse text-xs font-bold tracking-widest uppercase">
              Click anywhere to awake
            </p>
          </div>
        )}
      </div>

      {/* Custom Controls Panel */}
      {currentMedia.provider?.toLowerCase() !== "youtube" &&
        currentMedia.provider?.toLowerCase() !== "twitch" && (
          <div className="font-theme absolute right-0 bottom-0 left-0 z-50 p-4 opacity-0 transition-opacity duration-300 group-hover:opacity-100 focus-within:opacity-100">
            <div className="bg-theme-bg/80 border-theme-border/50 rounded-theme border-2 p-3 shadow-lg backdrop-blur-md">
              {/* Timeline */}
              <div className="mb-3 flex items-center space-x-4">
                <Scrubber
                  playerRef={realPlayerRef}
                  duration={duration}
                  canControl={canControl}
                  onSeekStart={handleSeekMouseDown}
                  onSeekEnd={handleSeekMouseUp}
                />
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-6">
                  {/* Play/Pause */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      playing ? handlePause() : handlePlay();
                    }}
                    disabled={!canControl}
                    className={`ring-theme-accent rounded-theme flex h-10 w-10 items-center justify-center border-2 border-inherit transition-all outline-none focus-visible:ring-2 ${
                      canControl
                        ? "border-theme-accent text-theme-accent hover:bg-theme-accent hover:text-theme-bg shadow-theme active:translate-y-0.5 active:shadow-none"
                        : "border-theme-border text-theme-muted cursor-not-allowed"
                    }`}
                  >
                    {playing ? (
                      <Pause className="h-5 w-5 fill-current" />
                    ) : (
                      <Play className="ml-1 h-5 w-5 fill-current" />
                    )}
                  </button>

                  {/* Next */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleNext();
                    }}
                    disabled={!canControl}
                    className={`ring-theme-accent rounded-full transition-all outline-none hover:scale-110 focus-visible:ring-2 ${canControl ? "text-theme-accent hover:text-theme-danger" : "text-theme-muted cursor-not-allowed"}`}
                  >
                    <SkipForward className="h-5 w-5 fill-current" />
                  </button>

                  {/* Undo Seek (Flashback) */}
                  {canControl &&
                    flashbacks.some((f) => f.mediaId === currentMediaId) && (
                      <button
                        title="Undo accidental seek"
                        onClick={(e) => {
                          e.stopPropagation();
                          const restoredPos = popFlashback(currentMediaId!);
                          if (restoredPos !== null) {
                            emitCommand("seek", { position: restoredPos });
                          }
                        }}
                        className="text-theme-bg bg-theme-accent hover:bg-theme-danger animate-in fade-in zoom-in ring-theme-accent rounded-full p-2 transition-all outline-none focus-visible:ring-2"
                      >
                        <Undo2 className="h-5 w-5" />
                      </button>
                    )}

                  {/* Playback Speed */}
                  <div className="group/speed relative flex items-center space-x-2">
                    <button className="text-theme-accent hover:text-theme-danger ring-theme-accent border-theme-accent/30 rounded-sm border px-1.5 py-1 text-[10px] font-bold tracking-widest uppercase transition-colors outline-none focus-visible:ring-2">
                      {playback?.rate || 1}x
                    </button>
                    {/* Add a transparent bridge area using pb-2 on the outer container so hovering the gap keeps it open */}
                    <div className="absolute bottom-full left-1/2 z-50 hidden -translate-x-1/2 flex-col pb-2 group-hover/speed:flex">
                      <div className="bg-theme-bg/95 border-theme-border/50 rounded-theme flex flex-col overflow-hidden border-2 shadow-xl backdrop-blur-md">
                        <div className="text-theme-muted border-theme-border/30 bg-theme-bg/50 border-b py-1.5 text-center text-[9px] font-bold tracking-widest uppercase">
                          SPEED
                        </div>
                        {[0.5, 1, 1.25, 1.5, 2].map((r) => (
                          <button
                            key={r}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (canControl) {
                                emitCommand("update_rate", { rate: r });
                              }
                            }}
                            disabled={!canControl}
                            className={`border-theme-border/10 hover:bg-theme-accent/20 border-b px-4 py-2.5 text-xs font-bold transition-all last:border-0 ${
                              !canControl ? "cursor-not-allowed opacity-50" : ""
                            } ${
                              playback?.rate === r
                                ? "text-theme-accent bg-theme-accent/10 shadow-[inset_2px_0_0_var(--color-theme-accent)]"
                                : "text-theme-text"
                            }`}
                          >
                            {r}x
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Volume */}
                  <div className="group/volume relative flex items-center space-x-3">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setMuted(!muted);
                      }}
                      className="text-theme-accent hover:text-theme-danger ring-theme-accent rounded-full transition-colors outline-none focus-visible:ring-2"
                    >
                      {muted || volume === 0 ? (
                        <VolumeX className="h-5 w-5" />
                      ) : (
                        <Volume2 className="h-5 w-5" />
                      )}
                    </button>
                    <div className="bg-theme-bg border-theme-border/30 rounded-theme relative h-2 w-0 overflow-hidden border transition-all duration-300 group-hover/volume:w-24">
                      <div
                        className="bg-theme-accent rounded-theme absolute top-0 left-0 h-full"
                        style={{ width: `${(muted ? 0 : volume) * 100}%` }}
                      />
                      <input
                        type="range"
                        min={0}
                        max={1}
                        step="any"
                        onChange={(e) => {
                          setVolume(parseFloat(e.target.value));
                          if (muted && parseFloat(e.target.value) > 0) {
                            setMuted(false);
                          }
                        }}
                        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                      />
                    </div>
                  </div>

                  {/* Meta */}
                  <div className="bg-theme-accent text-theme-bg ml-4 hidden rounded-full px-3 py-0.5 text-[10px] font-bold tracking-wider uppercase shadow-sm md:flex">
                    {currentMedia.provider}
                  </div>

                  <div className="text-theme-text ml-2 max-w-[150px] truncate text-xs font-bold tracking-wide uppercase drop-shadow-sm lg:max-w-xs xl:max-w-md">
                    {currentMedia.title}
                  </div>
                </div>

                <div className="flex items-center space-x-4">
                  {/* Quality Settings */}
                  <div className="group/quality relative flex items-center space-x-2">
                    <button
                      className={`text-theme-accent hover:text-theme-danger ring-theme-accent relative rounded-full p-2 transition-transform duration-500 outline-none focus-visible:ring-2 ${qualityMenuOpen ? "text-theme-danger rotate-90" : ""}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        const willOpen = !qualityMenuOpen;
                        setQualityMenuOpen(willOpen);

                        if (willOpen && currentMedia) {
                          try {
                            if (
                              currentMedia.provider?.toLowerCase() === "youtube"
                            ) {
                              const internal = (
                                realPlayerRef.current as any
                              )?.getInternalPlayer("youtube");
                              if (internal?.getAvailableQualityLevels) {
                                const levels =
                                  internal.getAvailableQualityLevels();
                                setProviderQualities(
                                  levels.filter((l: string) => l !== "auto"),
                                );
                                setCurrentProviderQuality(
                                  internal.getPlaybackQuality() || "auto",
                                );
                              }
                            } else if (
                              currentMedia.provider?.toLowerCase() === "twitch"
                            ) {
                              const internal = (
                                realPlayerRef.current as any
                              )?.getInternalPlayer("twitch");
                              if (internal?.getQualities) {
                                const levels = internal.getQualities();
                                setProviderQualities(
                                  levels.map((l: any) => l.group),
                                );
                                setCurrentProviderQuality(
                                  internal.getQuality() || "auto",
                                );
                              }
                            }
                          } catch (err) {
                            console.error("Provider bridge API error:", err);
                          }
                        }
                      }}
                    >
                      <Settings className="h-5 w-5" />
                      {currentProviderQuality !== "auto" &&
                        providerQualities.length > 0 && (
                          <div className="bg-theme-accent absolute top-1 right-1 h-2 w-2 animate-pulse rounded-full shadow-[0_0_8px_var(--color-theme-accent)]" />
                        )}
                    </button>

                    {/* Quality Menu Dialog */}
                    {qualityMenuOpen && (
                      <div className="absolute right-0 bottom-full z-50 mb-4 flex flex-col items-end pb-2">
                        <div className="bg-theme-bg/95 border-theme-border/50 rounded-theme animate-in slide-in-from-bottom-2 fade-in flex min-w-[220px] flex-col overflow-hidden border shadow-[0_0_40px_rgba(0,0,0,0.5)] backdrop-blur-xl">
                          <div className="text-theme-muted border-theme-border/30 bg-theme-bg/50 border-b px-4 py-2 text-[10px] font-bold tracking-widest uppercase">
                            Video Quality
                          </div>

                          {providerQualities.length > 0 && (
                            <div className="flex flex-col">
                              <div className="text-theme-muted border-theme-border/10 border-b px-4 py-2 text-[9px] tracking-widest uppercase">
                                Native Core Provider
                              </div>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setCurrentProviderQuality("auto");
                                  setQualityMenuOpen(false);
                                  try {
                                    if (
                                      currentMedia.provider?.toLowerCase() ===
                                      "youtube"
                                    ) {
                                      (realPlayerRef.current as any)
                                        ?.getInternalPlayer("youtube")
                                        ?.setPlaybackQualityRange?.("auto");
                                    } else if (
                                      currentMedia.provider?.toLowerCase() ===
                                      "twitch"
                                    ) {
                                      (realPlayerRef.current as any)
                                        ?.getInternalPlayer("twitch")
                                        ?.setQuality?.("auto");
                                    }
                                  } catch (err) {}
                                }}
                                className={`border-theme-border/10 hover:bg-theme-accent/20 flex items-center justify-between border-b px-4 py-3 text-left text-xs font-bold transition-all ${currentProviderQuality === "auto" ? "text-theme-accent bg-theme-accent/10 shadow-[inset_2px_0_0_var(--color-theme-accent)]" : "text-theme-text"}`}
                              >
                                Auto (Provider Default)
                              </button>
                              {providerQualities.map((q) => (
                                <button
                                  key={q}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setCurrentProviderQuality(q);
                                    setQualityMenuOpen(false);
                                    try {
                                      if (
                                        currentMedia.provider?.toLowerCase() ===
                                        "youtube"
                                      ) {
                                        (realPlayerRef.current as any)
                                          ?.getInternalPlayer("youtube")
                                          ?.setPlaybackQualityRange?.(q, q);
                                      } else if (
                                        currentMedia.provider?.toLowerCase() ===
                                        "twitch"
                                      ) {
                                        (realPlayerRef.current as any)
                                          ?.getInternalPlayer("twitch")
                                          ?.setQuality?.(q);
                                      }
                                    } catch (err) {}
                                  }}
                                  className={`border-theme-border/10 hover:bg-theme-accent/20 flex items-center justify-between border-b px-4 py-3 text-left text-xs font-bold transition-all ${currentProviderQuality === q ? "text-theme-accent bg-theme-accent/10 shadow-[inset_2px_0_0_var(--color-theme-accent)]" : "text-theme-text"}`}
                                >
                                  <span
                                    className={
                                      q === "highres" ? "text-theme-accent" : ""
                                    }
                                  >
                                    {q === "highres"
                                      ? "Target Ultra/4K"
                                      : q.replace(/hd/, "").toUpperCase()}
                                  </span>
                                  {currentProviderQuality === q && (
                                    <div className="bg-theme-accent h-2 w-2 rounded-full shadow-[0_0_5px_currentColor]"></div>
                                  )}
                                </button>
                              ))}
                            </div>
                          )}

                          {hlsLevels.length > 0 && (
                            <div className="flex flex-col">
                              <div className="text-theme-muted border-theme-border/10 border-b px-4 py-2 text-[9px] tracking-widest uppercase">
                                Stream Manifest Levels
                              </div>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setCurrentHlsLevel(-1);
                                  try {
                                    const internal = playerRef.current as any;
                                    if (internal) internal.currentLevel = -1;
                                  } catch (err) {}
                                  setQualityMenuOpen(false);
                                }}
                                className={`border-theme-border/10 hover:bg-theme-accent/20 border-b px-4 py-3 text-left text-xs font-bold transition-all ${currentHlsLevel === -1 ? "text-theme-accent bg-theme-accent/10 shadow-[inset_2px_0_0_var(--color-theme-accent)]" : "text-theme-text"}`}
                              >
                                Auto (Adaptive)
                              </button>
                              {hlsLevels.map((level, idx) => (
                                <button
                                  key={idx}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setCurrentHlsLevel(idx);
                                    try {
                                      const internal = playerRef.current as any;
                                      if (internal) internal.currentLevel = idx;
                                    } catch (err) {}
                                    setQualityMenuOpen(false);
                                  }}
                                  className={`border-theme-border/10 hover:bg-theme-accent/20 border-b px-4 py-3 text-left text-xs font-bold transition-all last:border-b-0 ${currentHlsLevel === idx ? "text-theme-accent bg-theme-accent/10 shadow-[inset_2px_0_0_var(--color-theme-accent)]" : "text-theme-text"}`}
                                >
                                  {level.height}p Rate
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Sync Status Badge */}
                  {driftRef.current >= 0.5 && (
                    <div className="bg-theme-bg/80 border-theme-border/50 rounded-theme animate-in fade-in mr-2 hidden min-w-[120px] items-center justify-center space-x-2 border px-3 py-1.5 text-[10px] font-bold uppercase shadow-sm md:flex">
                      <div
                        className={`h-2 w-2 rounded-full ${
                          driftRef.current < 2
                            ? "bg-theme-danger shadow-[0_0_8px_var(--color-theme-danger)]"
                            : "bg-red-500 shadow-[0_0_8px_rgb(239,68,68)]"
                        }`}
                      />
                      <span
                        className={`hidden sm:inline-block ${
                          driftRef.current < 2
                            ? "text-theme-danger"
                            : "text-red-500"
                        }`}
                      >
                        {driftRef.current < 2 ? "Sync: Locking" : "Sync: Lost"}
                      </span>
                    </div>
                  )}

                  {playback?.updatedBy && (
                    <span className="text-theme-muted border-theme-border/30 hidden border-l pl-4 text-[10px] tracking-wider uppercase xl:inline-block">
                      CMD: {playback.status === "playing" ? "PLAY" : "PAUSE"}
                      {" // "}
                      <strong className="text-theme-accent inline-block max-w-[100px] truncate align-bottom">
                        {playback.updatedBy}
                      </strong>
                    </span>
                  )}

                  {/* Theater Mode */}
                  <button
                    onClick={toggleTheaterMode}
                    className={`ring-theme-accent rounded-full p-2 transition-colors outline-none hover:scale-110 focus-visible:ring-2 ${
                      theaterMode
                        ? "text-theme-danger"
                        : "text-theme-accent hover:text-theme-danger"
                    }`}
                    title="Theater Mode"
                  >
                    <MonitorPlay className="h-5 w-5" />
                  </button>

                  {/* Fullscreen */}
                  <button
                    onClick={() => {
                      if (fscreen.fullscreenEnabled && containerRef.current) {
                        if (fscreen.fullscreenElement) {
                          fscreen.exitFullscreen();
                        } else {
                          fscreen.requestFullscreen(containerRef.current);
                        }
                      }
                    }}
                    className="text-theme-accent hover:text-theme-danger ring-theme-accent rounded-full p-2 transition-colors outline-none hover:scale-110 focus-visible:ring-2"
                  >
                    <Maximize className="h-5 w-5" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
    </div>
  );
}
