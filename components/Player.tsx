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
import { usePlayerShortcuts } from "@/hooks/usePlayerShortcuts";
import { useFlashback } from "@/hooks/useFlashback";
import { Undo2 } from "lucide-react";

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
  const playerRef = useRef<any>(null); // React component wrapper ref
  const realPlayerRef = useRef<any>(null); // Actual ReactPlayer instance
  const containerRef = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [seeking, setSeeking] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const driftRef = useRef(0);
  const [hostName, setHostName] = useState<string>("localhost");
  const [mounted, setMounted] = useState(false);
  const [localPlaybackRate, setLocalPlaybackRate] = useState<number>(1);
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

  // To avoid loopbacks, track manually initiated actions vs programmatic state syncs
  const lastCommandEmitTimeRef = useRef<number>(0);
  const lastStateEmittedRef = useRef<{
    status: string;
    position: number;
    time: number;
    nonce?: string;
  } | null>(null);

  const lastProgrammaticSeekRef = useRef<number>(0);
  const ignoreNativeEventsUntilRef = useRef<number>(0);
  const userIsDraggingScrubberRef = useRef<boolean>(seeking);

  useEffect(() => {
    userIsDraggingScrubberRef.current = seeking;
  }, [seeking]);

  const lastServerStateChangeRef = useRef<number>(0);
  const pauseDebounceRef = useRef<NodeJS.Timeout | null>(null);

  const getAccurateTime = useCallback(() => {
    if (realPlayerRef.current?.getCurrentTime) {
      return realPlayerRef.current.getCurrentTime();
    }
    return playerRef.current?.currentTime || 0;
  }, []);

  const performProgrammaticSeek = (position: number) => {
    // Soft Mode Guarantee: If we are in "echo protection" (last action was ours),
    // never perform hard seeks during this interval, only drift math updates.
    if (Date.now() < ignoreNativeEventsUntilRef.current) return;

    lastProgrammaticSeekRef.current = Date.now();
    if (
      realPlayerRef.current &&
      typeof realPlayerRef.current.seekTo === "function"
    ) {
      realPlayerRef.current.seekTo(position, "seconds");
    } else if (playerRef.current) {
      playerRef.current.currentTime = position; // Fallback
    }
  };

  useEffect(() => {
    setError(null);
    setIsReady(false);
    setIsBuffering(false);
    // Twitch is always fully managed by our UI now to prevent Unmount/Autoplay Policy breakage
  }, [currentMediaId]);

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
      ignoreNativeEventsUntilRef.current = Date.now() + 2000;
      setPlaying(playback.status === "playing");
      performProgrammaticSeek(expectedPosition);
    }
  }, [occRollbackTick]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      setHostName(window.location.hostname);
    }
    setMounted(true);
  }, []);

  // Removed ResizeObserver effect

  // In strict server state, we don't emit commands from native events
  const emitCommand = (type: string, payload: any) => {
    // BACKGROUND TAB FIX: Block false-positive pause/seek events from throttled tabs
    if (
      !isDocumentVisibleRef.current &&
      ["play", "pause", "seek", "buffering"].includes(type)
    ) {
      return;
    }
    const nonce = crypto.randomUUID(); // Manually create a nonce to track our own UI actions locally before store
    lastCommandEmitTimeRef.current = Date.now();
    lastStateEmittedRef.current = {
      status: type,
      position: payload?.position,
      time: Date.now(),
      nonce,
    } as any;
    sendCommand(type, { ...payload, nonce });
  };

  const syncPlayback = useEventCallback(() => {
    if (!playback || !isReady || seeking) return;

    if (Date.now() - lastCommandEmitTimeRef.current < 1500) {
      // Optimistic UI barrier: ignore server discrepancy immediately after manual UI action
      return;
    }

    // [Problem 1 Fix]: Nonce-based Identity (Anti-Echo Rollback)
    const storeOpts = useStore.getState();
    if (
      playback.lastActionNonce &&
      lastStateEmittedRef.current?.nonce === playback.lastActionNonce
    ) {
      // Server just repeated back our own recent action.
      // Enter "Soft Mode": grant another 2 seconds of immunity against hard `seekTo` corrections
      ignoreNativeEventsUntilRef.current = Date.now() + 2000;
      // We clear the local tracking so we only grant immunity once per nonce resolution
      lastStateEmittedRef.current.nonce = undefined;
    }

    const currentServerTime = Date.now() + serverClockOffset;
    const currentPosition = getAccurateTime();

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

      if (!playing) {
        lastServerStateChangeRef.current = Date.now();
        setPlaying(true);
      }

      // [Problem 5 Fix]: Owner As Oracle in Controlled Mode
      if (controlMode === "controlled" && myRole === "owner") {
        // The owner dictates time. If the owner's local player drifts from the server's math
        // by more than 600ms, the owner forces the server to accept the local position.
        if (currentDrift > 0.6) {
          emitCommand("sync_correction", { position: currentPosition });
          // No local seek required, we are the authority.
          return;
        }
      }

      const isIframeProvider = ["youtube", "vimeo", "twitch"].includes(
        currentMedia?.provider?.toLowerCase() || "",
      );
      const isTwitch = currentMedia?.provider?.toLowerCase() === "twitch";

      // [Problem 3 Fix]: Dual-Threshold Adaptive Rate (Hard Sink vs Smooth Rate Shift)
      if (
        (currentDrift > 3.0 || (isIframeProvider && currentDrift > 2.0)) &&
        !isBuffering &&
        !isTwitch
      ) {
        // [THRESHOLD 1]: Massive drift (>3.0s). Requires a violent hard seek.
        let expectedClamped = expectedPosition;
        if (duration > 0 && expectedClamped > duration) {
          expectedClamped = duration;
        }
        performProgrammaticSeek(expectedClamped);
        setLocalPlaybackRate(playback.rate);
      } else if (
        currentDrift > 0.5 &&
        !isBuffering &&
        !isIframeProvider &&
        currentMedia?.provider?.toLowerCase() !== "youtube"
      ) {
        // [THRESHOLD 2]: Minor drift (0.5s - 3.0s). Shift playbackRate invisibly.
        const rateAdjustment = currentPosition < expectedPosition ? 1.05 : 0.95;
        setLocalPlaybackRate(playback.rate * rateAdjustment);
      } else {
        // PERFECT SYNC
        setLocalPlaybackRate(playback.rate);
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

      if (playing) {
        lastServerStateChangeRef.current = Date.now();
        setPlaying(false);
      }

      if (currentDrift > 1.0 && !isBuffering) {
        ignoreNativeEventsUntilRef.current = Date.now() + 1500;
        performProgrammaticSeek(playback.basePosition);
      }
    }
  });

  useEffect(() => {
    const interval = setInterval(syncPlayback, 1000);
    return () => clearInterval(interval);
  }, [syncPlayback]);

  const handlePlay = () => {
    if (!currentMediaId || !participantId || !canControl) return;
    setPlaying(true);
    let pos = getAccurateTime();
    if (pos === 0 && playback && playback.basePosition > 2) {
      pos = playback.basePosition;
    }
    emitCommand("play", { position: pos });
  };

  const handlePause = () => {
    if (!currentMediaId || !participantId || !canControl) return;
    setPlaying(false);
    emitCommand("pause", { position: getAccurateTime() });
  };

  const handleNativePlay = () => {
    if (pauseDebounceRef.current) {
      clearTimeout(pauseDebounceRef.current);
      pauseDebounceRef.current = null;
    }
    setIsBuffering(false);
    setPlaying(true);

    // **INTENT MASK**: Drop events caused by programmatic seek buffer locks or scrubber dragging
    if (
      Date.now() < ignoreNativeEventsUntilRef.current ||
      userIsDraggingScrubberRef.current
    ) {
      return;
    }

    if (canControl && playback?.status !== "playing") {
      const timeSinceMediaStart = Date.now() - (playback?.baseTimestamp || 0);
      if (timeSinceMediaStart > 2000) {
        emitCommand("play", { position: getAccurateTime() });
      }
    }
  };

  const handleNativePause = () => {
    setIsBuffering(false);
    setPlaying(false);
    if (pauseDebounceRef.current) clearTimeout(pauseDebounceRef.current);

    // **INTENT MASK**: Drop events caused by programmatic seek buffer locks or scrubber dragging
    if (
      Date.now() < ignoreNativeEventsUntilRef.current ||
      userIsDraggingScrubberRef.current
    ) {
      return;
    }

    const timeSinceMediaStart = Date.now() - (playback?.baseTimestamp || 0);
    if (timeSinceMediaStart < 2000) {
      return;
    }

    pauseDebounceRef.current = setTimeout(() => {
      if (canControl && playback?.status !== "paused") {
        emitCommand("pause", { position: getAccurateTime() });
      }
    }, 50);
  };

  usePlayerShortcuts({
    canControl,
    playing,
    muted,
    handlePlay,
    handlePause,
    setMuted,
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
    ignoreNativeEventsUntilRef.current = Date.now() + 2000;

    if (
      realPlayerRef.current &&
      typeof realPlayerRef.current.seekTo === "function"
    ) {
      realPlayerRef.current.seekTo(newPosition, "seconds");
    } else if (playerRef.current) {
      playerRef.current.currentTime = newPosition;
    }

    if (canControl) {
      emitCommand("seek", { position: newPosition });
      if (playing) {
        emitCommand("play", { position: newPosition });
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
      <div className="font-theme relative flex h-full w-full flex-1 flex-col items-center justify-center overflow-hidden bg-transparent p-4">
        <div className="theme-panel relative z-10 flex w-full max-w-lg flex-col items-center p-8">
          <div className="bg-theme-bg/50 border-theme-accent shadow-theme group-hover:shadow-theme-hover mb-8 flex h-24 w-24 items-center justify-center rounded-full border-2 transition-all">
            <Play className="text-theme-accent ml-2 h-12 w-12" />
          </div>
          <h2 className="text-theme-text mb-2 text-center text-3xl font-bold tracking-widest uppercase drop-shadow-sm">
            Awaiting Signal
          </h2>
          <p className="text-theme-muted mb-10 text-center text-sm tracking-wider uppercase opacity-80">
            System ready. Awaiting media input...
          </p>

          {canEditPlaylist || participantCount <= 1 ? (
            <form
              className="relative w-full"
              onSubmit={async (e) => {
                e.preventDefault();
                const input = e.currentTarget.elements.namedItem(
                  "urlInput",
                ) as HTMLInputElement;
                const url = input.value.trim();
                const btn = e.currentTarget.querySelector("button");
                if (btn) btn.disabled = true;

                if (url) {
                  const mediaInfo = await MediaApiService.fetchMediaInfo(url);
                  sendCommand("add_item", mediaInfo);
                  input.value = "";
                }
                if (btn) btn.disabled = false;
              }}
            >
              <div className="bg-theme-bg/50 border-theme-border/50 rounded-theme focus-within:border-theme-accent shadow-theme focus-within:shadow-theme-hover relative flex flex-col items-stretch overflow-hidden border-2 transition-all sm:flex-row">
                <input
                  name="urlInput"
                  type="url"
                  placeholder="Paste video stream URL..."
                  className="text-theme-text placeholder-theme-muted font-theme flex-1 bg-transparent px-5 py-4 text-sm focus:outline-none"
                  required
                />
                <button
                  type="submit"
                  className="bg-theme-accent text-theme-bg border-theme-border/30 px-8 py-4 font-bold tracking-wider uppercase transition-all hover:brightness-110 hover:filter disabled:cursor-not-allowed disabled:opacity-50 sm:border-l-2"
                >
                  Init
                </button>
              </div>
            </form>
          ) : (
            <div className="bg-theme-bg/50 border-theme-danger text-theme-danger font-theme rounded-theme shadow-theme flex items-center gap-3 border-2 px-6 py-4 text-xs tracking-wider uppercase">
              <AlertCircle className="h-5 w-5" />
              <span>Restricted access. Command privileges required.</span>
            </div>
          )}
        </div>
      </div>
    );
  }

  // (Hooks merged upwards, see top of render)

  const timeRemaining = upNextState.remaining;
  const showUpNext = upNextState.show && nextItem !== null;

  return (
    <div
      ref={containerRef}
      className="bg-theme-bg group react-player-wrapper border-theme-border/50 font-theme relative flex h-full w-full flex-1 flex-col border-y-2 lg:border-x-2 lg:border-y-0"
    >
      <div
        className="relative h-full w-full flex-1"
        style={{ containerType: "size" } as React.CSSProperties}
        onClick={() => {
          if (qualityMenuOpen) setQualityMenuOpen(false);
        }}
      >
        <div
          className="absolute top-0 left-0 h-full w-full origin-top-left transition-transform duration-700"
          style={{
            // [Problem 7 Fix]: Twitch Embed visibility validation hack.
            // We MUST keep the DOM element fully visible/opaque initially. We mask it with pointer-events instead
            // of display:none or opacity:0.
            visibility: "visible",
            opacity: 1,
            pointerEvents: isBuffering || !userJoined ? "none" : "auto",
          }}
        >
          {mounted && (
            <ReactPlayer
              ref={playerRef}
              src={currentMedia.url}
              width="100%"
              height="100%"
              controls={currentMedia.provider?.toLowerCase() === "youtube"}
              playing={userJoined ? playing : false}
              volume={volume}
              muted={userJoined ? muted : true}
              playbackRate={localPlaybackRate}
              onReady={(rPlayer: any) => {
                realPlayerRef.current = rPlayer;
                setIsReady(true);
                setError(null);

                // -- TWITCH EVENT PROXY HACK --
                // react-player @3.x fails to bubble "playing" from twitch-video-element as standard "play"
                // So we listen explicitly on the internal DOM element.
                if (currentMedia.provider?.toLowerCase() === "twitch") {
                  try {
                    const twitchEl = rPlayer.getInternalPlayer("twitch");
                    if (twitchEl && !twitchEl.dataset.proxyAttached) {
                      twitchEl.dataset.proxyAttached = "true";

                      // Using Twitch standard DOM events
                      twitchEl.addEventListener("play", () => {
                        console.log("[TWITCH PROXY] play event fired");
                        handleNativePlay();
                      });
                      twitchEl.addEventListener("playing", () => {
                        console.log("[TWITCH PROXY] playing event fired");
                        handleNativePlay();
                      });
                      twitchEl.addEventListener("pause", () => {
                        console.log("[TWITCH PROXY] pause event fired");
                        handleNativePause();
                      });
                    }
                  } catch (e) {
                    console.error("Failed to proxy twitch events", e);
                  }
                }

                // Extract HLS Levels if it's a direct stream
                if (
                  currentMedia.provider?.toLowerCase() !== "youtube" &&
                  currentMedia.provider?.toLowerCase() !== "twitch" &&
                  currentMedia.provider?.toLowerCase() !== "vimeo"
                ) {
                  try {
                    const el = playerRef.current as any;
                    // In react-player v3, if using HLS, the web component might expose native properties
                    // Just cleanly ignore it if unavailable, or try to access the underlying HLS instance.
                    if (el && el.levels) {
                      setHlsLevels(el.levels);
                      setCurrentHlsLevel(el.currentLevel);
                    }
                  } catch (e) {
                    console.log("Not an HLS stream or levels unavailable.");
                  }
                }
              }}
              onError={(e: any) => {
                console.error("Player error:", e);
                setError("SYSTEM FAILURE. SIGNAL LOST.");
                setIsBuffering(false);
              }}
              onSeek={(seconds: number) => {
                // If it's a programmatic seek responding to the server, ignore it.
                if (Date.now() - lastProgrammaticSeekRef.current < 1500) return;

                // If it's a local seek via scrubber, it would have already emitted
                if (Date.now() - lastCommandEmitTimeRef.current < 1500) return;

                if (canControl) {
                  emitCommand("seek", { position: seconds });
                  // We do NOT emit "play" here! The native player will resume naturally,
                  // firing onPlay, which is safely debounced and resolved by handleNativePlay.
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
              }}
              onPlaying={() => {
                setIsBuffering(false);
              }}
              onPlay={() => {
                console.log("[REACT_PLAYER DEBUG] onPlay fired!", {
                  status: playback?.status,
                  canControl,
                  timeDelta: Date.now() - lastCommandEmitTimeRef.current,
                });
                handleNativePlay();
              }}
              onPause={() => {
                console.log("[REACT_PLAYER DEBUG] onPause fired!", {
                  status: playback?.status,
                  canControl,
                  timeDelta: Date.now() - lastCommandEmitTimeRef.current,
                });
                handleNativePause();
              }}
              style={{ position: "absolute", top: 0, left: 0 }}
              config={{
                youtube: {
                  playerVars: {
                    controls: 1,
                    disablekb: 0,
                    modestbranding: 0,
                    rel: 1,
                    showinfo: 1,
                    origin:
                      typeof window !== "undefined"
                        ? window.location.origin
                        : undefined,
                  },
                },
                vimeo: { playerOptions: { controls: false } },
                twitch: {
                  options: {
                    parent: [
                      hostName,
                      "localhost",
                      "127.0.0.1",
                      "syncwatch.example.com",
                    ],
                  },
                },
              }}
            />
          )}
        </div>

        {/* Up Next Overlay Layer */}
        {showUpNext && (
          <div className="bg-theme-bg/95 border-theme-border/50 rounded-theme animate-in fade-in slide-in-from-right-8 pointer-events-auto absolute right-4 bottom-24 z-40 flex items-center space-x-4 border p-4 shadow-[0_10px_40px_rgba(0,0,0,0.5)] backdrop-blur-md">
            <div className="relative flex h-12 w-12 items-center justify-center">
              <svg className="h-full w-full -rotate-90 transform">
                <circle
                  cx="24"
                  cy="24"
                  r="20"
                  stroke="currentColor"
                  strokeWidth="3"
                  fill="transparent"
                  className="text-theme-border/30"
                />
                <circle
                  cx="24"
                  cy="24"
                  r="20"
                  stroke="currentColor"
                  strokeWidth="3"
                  fill="transparent"
                  className="text-theme-accent transition-all duration-1000 ease-linear"
                  strokeDasharray="125"
                  strokeDashoffset={125 - (125 * (5 - timeRemaining)) / 5}
                />
              </svg>
              <span className="text-theme-text absolute text-sm font-bold">
                {Math.ceil(timeRemaining)}
              </span>
            </div>
            <div className="flex max-w-[200px] flex-col truncate pr-4">
              <span className="text-theme-muted text-[10px] font-bold tracking-widest uppercase">
                Up Next
              </span>
              <span className="text-theme-text truncate text-sm font-bold">
                {nextItem?.title}
              </span>
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleNext();
              }}
              className="text-theme-bg bg-theme-accent rounded-theme px-3 py-1.5 text-xs font-bold tracking-widest uppercase transition-all hover:brightness-110 hover:filter"
            >
              Skip
            </button>
          </div>
        )}

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
                {playback?.status === "buffering" && !isBuffering
                  ? `Syncing to ${playback.updatedBy}`
                  : "Buffering Stream"}
              </div>
            </div>
          )}

        {/* PAUSED Overlay */}
        {!playing && !isBuffering && isReady && !error && userJoined && (
          <div className="pointer-events-none absolute inset-0 z-20 flex flex-col items-center justify-center bg-black/40 backdrop-blur-[2px] transition-opacity duration-300">
            <div className="bg-theme-bg/80 border-theme-accent text-theme-accent flex h-24 w-24 items-center justify-center rounded-full border-4 shadow-[0_0_30px_var(--color-theme-accent)] backdrop-blur-md">
              <Play className="ml-2 h-12 w-12" />
            </div>
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
      {currentMedia.provider?.toLowerCase() !== "youtube" && (
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
                {/* eslint-disable-next-line react-hooks/refs */}
                {driftRef.current >= 0.5 && (
                  <div className="bg-theme-bg/80 border-theme-border/50 rounded-theme animate-in fade-in mr-2 hidden min-w-[120px] items-center justify-center space-x-2 border px-3 py-1.5 text-[10px] font-bold uppercase shadow-sm md:flex">
                    <div
                      className={`h-2 w-2 rounded-full ${
                        // eslint-disable-next-line react-hooks/refs
                        driftRef.current < 2
                          ? "bg-theme-danger shadow-[0_0_8px_var(--color-theme-danger)]"
                          : "bg-red-500 shadow-[0_0_8px_rgb(239,68,68)]"
                      }`}
                    />
                    <span
                      className={`hidden sm:inline-block ${
                        // eslint-disable-next-line react-hooks/refs
                        driftRef.current < 2
                          ? "text-theme-danger"
                          : "text-red-500"
                      }`}
                    >
                      {/* eslint-disable-next-line react-hooks/refs */}
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
