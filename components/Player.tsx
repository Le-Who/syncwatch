"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import dynamic from "next/dynamic";
import { useStore, useSettingsStore } from "@/lib/store";
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

const ReactPlayer = dynamic(() => import("react-player"), {
  ssr: false,
}) as any;

export default function Player() {
  const { room, participantId, sendCommand, serverClockOffset } = useStore();
  const { volume, muted, theaterMode, setVolume, setMuted, toggleTheaterMode } =
    useSettingsStore();
  const playerRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [played, setPlayed] = useState(0);
  const [playedSeconds, setPlayedSeconds] = useState(0);
  const [duration, setDuration] = useState(0);
  const [seeking, setSeeking] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drift, setDrift] = useState(0);
  const [hostName, setHostName] = useState<string>("localhost");
  const [mounted, setMounted] = useState(false);
  const [localPlaybackRate, setLocalPlaybackRate] = useState<number>(1);

  const [qualityMenuOpen, setQualityMenuOpen] = useState(false);
  const [forceHighRes, setForceHighRes] = useState(false);
  const [nativeInteraction, setNativeInteraction] = useState(false);
  const [hlsLevels, setHlsLevels] = useState<{ height: number }[]>([]);
  const [currentHlsLevel, setCurrentHlsLevel] = useState<number>(-1);

  // Removed ResizeObserver dimensions

  // To avoid loopbacks, track manually initiated actions vs programmatic state syncs
  const ignoreNextPlayPauseEvent = useRef(false);
  const lastCommandEmitTimeRef = useRef<number>(0);
  const lastStateEmittedRef = useRef<{
    status: string;
    position: number;
    time: number;
  } | null>(null);

  const currentMedia = room?.playlist.find(
    (item) => item.id === room.currentMediaId,
  );
  const playback = room?.playback;

  const canControl =
    room?.settings.controlMode === "open" ||
    room?.participants[participantId!]?.role === "owner" ||
    room?.participants[participantId!]?.role === "moderator" ||
    room?.settings.controlMode === "hybrid";

  const canEditPlaylist =
    room?.settings.controlMode === "open" ||
    room?.participants[participantId!]?.role === "owner" ||
    room?.participants[participantId!]?.role === "moderator";

  const getAccurateTime = useCallback(() => {
    return playerRef.current?.currentTime || 0;
  }, []);

  const performProgrammaticSeek = (position: number) => {
    ignoreNextPlayPauseEvent.current = true; // A seek might trigger buffering/play events
    if (playerRef.current) {
      playerRef.current.currentTime = position;
    }
  };

  useEffect(() => {
    setError(null);
    setIsReady(false);
    setIsBuffering(false);
  }, [room?.currentMediaId]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      setHostName(window.location.hostname);
    }
    setMounted(true);
  }, []);

  // Removed ResizeObserver effect

  // In strict server state, we don't emit commands from native events
  const emitCommand = (type: string, payload: any) => {
    lastCommandEmitTimeRef.current = Date.now();
    lastStateEmittedRef.current = {
      status: type,
      position: payload.position,
      time: Date.now(),
    };
    sendCommand(type, payload);
  };

  useEffect(() => {
    if (!playback || !isReady || seeking) return;

    const syncPlayback = () => {
      if (Date.now() - lastCommandEmitTimeRef.current < 1500) {
        // Optimistic UI barrier: ignore server discrepancy immediately after manual UI action
        return;
      }

      const currentServerTime = Date.now() + serverClockOffset;
      const currentPosition = getAccurateTime();

      if (currentMedia?.provider?.toLowerCase() === "twitch") return; // Twitch Live/VODs break on frequent programmatic seeks

      if (playback.status === "playing") {
        const expectedPosition =
          playback.basePosition +
          ((currentServerTime - playback.baseTimestamp) / 1000) * playback.rate;
        const currentDrift = Math.abs(expectedPosition - currentPosition);
        setDrift(currentDrift);

        if (!playing) {
          setPlaying(true);
        }

        if (currentDrift > 5.0 && !isBuffering) {
          performProgrammaticSeek(expectedPosition);
          setLocalPlaybackRate(playback.rate);
        } else if (currentDrift > 0.5 && !isBuffering) {
          const rateAdjustment =
            currentPosition < expectedPosition ? 1.05 : 0.95;
          setLocalPlaybackRate(playback.rate * rateAdjustment);
        } else {
          setLocalPlaybackRate(playback.rate);
        }
      } else if (playback.status === "paused") {
        const currentDrift = Math.abs(playback.basePosition - currentPosition);
        setDrift(currentDrift);

        if (playing) {
          setPlaying(false);
        }

        if (currentDrift > 1.0) {
          performProgrammaticSeek(playback.basePosition);
        }
      }
    };

    syncPlayback();
    const interval = setInterval(syncPlayback, 1000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    playback,
    isReady,
    seeking,
    isBuffering,
    playing,
    getAccurateTime,
    serverClockOffset,
  ]);

  const handlePlay = () => {
    if (!room || !participantId || !canControl) return;
    setPlaying(true);
    let pos = getAccurateTime();
    if (pos === 0 && playback && playback.basePosition > 2) {
      pos = playback.basePosition;
    }
    emitCommand("play", { position: pos });
  };

  const handlePause = () => {
    if (!room || !participantId || !canControl) return;
    setPlaying(false);
    emitCommand("pause", { position: getAccurateTime() });
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if currently typing in an input
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      ) {
        return;
      }

      if (e.code === "Space") {
        e.preventDefault();
        if (canControl) {
          playing ? handlePause() : handlePlay();
        }
      } else if (e.code === "KeyM") {
        e.preventDefault();
        setMuted(!muted);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, canControl, handlePlay, handlePause]);

  const handleSeekMouseDown = () => {
    setSeeking(true);
  };

  const handleSeekMouseUp = (percent: number) => {
    setSeeking(false);
    setPlayed(percent);
    const newPosition = percent * duration;
    if (playerRef.current) {
      playerRef.current.currentTime = newPosition;
    }

    if (canControl) {
      emitCommand("seek", { position: newPosition });
      if (playing) {
        emitCommand("play", { position: newPosition });
      }
    }
  };

  const handleProgress = (state: { played: number; playedSeconds: number }) => {
    if (!seeking) {
      setPlayed(state.played);
      setPlayedSeconds(state.playedSeconds);
    }
  };

  const handleNext = () => {
    emitCommand("next", { currentMediaId: room?.currentMediaId });
  };

  const formatTime = (seconds: number) => {
    if (!seconds || isNaN(seconds) || seconds < 0) return "0:00";
    const totalSeconds = Math.max(0, Math.floor(seconds));
    const hh = Math.floor(totalSeconds / 3600);
    const mm = Math.floor((totalSeconds % 3600) / 60);
    const ss = (totalSeconds % 60).toString().padStart(2, "0");
    if (hh > 0) return `${hh}:${mm.toString().padStart(2, "0")}:${ss}`;
    return `${mm}:${ss}`;
  };

  if (!currentMedia) {
    return (
      <div className="font-theme relative flex h-full w-full flex-1 flex-col items-center justify-center overflow-hidden bg-transparent p-4">
        <div className="theme-panel relative z-10 flex w-full max-w-lg flex-col items-center p-8">
          <div className="bg-theme-bg/50 border-theme-accent mb-8 flex h-24 w-24 items-center justify-center rounded-full border-2 shadow-[var(--theme-shadow)] transition-all group-hover:shadow-[var(--theme-shadow-hover)]">
            <Play className="text-theme-accent ml-2 h-12 w-12" />
          </div>
          <h2 className="text-theme-text mb-2 text-center text-3xl font-bold tracking-widest uppercase drop-shadow-sm">
            Awaiting Signal
          </h2>
          <p className="text-theme-muted mb-10 text-center text-sm tracking-wider uppercase opacity-80">
            System ready. Awaiting media input...
          </p>

          {canEditPlaylist ||
          Object.keys(room?.participants || {}).length <= 1 ? (
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
                  let provider = "unknown";
                  let title = "Direct Media";
                  let duration = 0;
                  let thumbnail = undefined;

                  if (url.includes("youtube.com") || url.includes("youtu.be")) {
                    provider = "youtube";
                    try {
                      const res = await fetch(
                        `/api/youtube/search?q=${encodeURIComponent(url)}`,
                      );
                      if (res.ok) {
                        const data = await res.json();
                        if (data.videos && data.videos.length > 0) {
                          title = data.videos[0].title;
                          duration = data.videos[0].duration;
                          thumbnail = data.videos[0].thumbnail;
                        }
                      }
                    } catch (err) {}
                  } else {
                    if (url.includes("twitch.tv")) provider = "twitch";
                    else if (url.includes("vimeo.com")) provider = "vimeo";
                    else if (url.includes("soundcloud.com"))
                      provider = "soundcloud";
                    try {
                      const res = await fetch(
                        `/api/metadata?url=${encodeURIComponent(url)}`,
                      );
                      if (res.ok) {
                        const data = await res.json();
                        if (data.title) title = data.title;
                        if (data.thumbnail) thumbnail = data.thumbnail;
                      }
                    } catch (err) {}
                  }

                  sendCommand("add_item", {
                    url,
                    provider,
                    title,
                    duration,
                    thumbnail,
                  });
                  input.value = "";
                }
                if (btn) btn.disabled = false;
              }}
            >
              <div className="bg-theme-bg/50 border-theme-border/50 rounded-theme focus-within:border-theme-accent relative flex flex-col items-stretch overflow-hidden border-2 shadow-[var(--theme-shadow)] transition-all focus-within:shadow-[var(--theme-shadow-hover)] sm:flex-row">
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
            <div className="bg-theme-bg/50 border-theme-danger text-theme-danger font-theme rounded-theme flex items-center gap-3 border-2 px-6 py-4 text-xs tracking-wider uppercase shadow-[var(--theme-shadow)]">
              <AlertCircle className="h-5 w-5" />
              <span>Restricted access. Command privileges required.</span>
            </div>
          )}
        </div>
      </div>
    );
  }

  const currentIndex =
    room?.playlist.findIndex((i) => i.id === currentMedia.id) ?? -1;
  let nextItem = null;
  if (currentIndex !== -1 && room) {
    nextItem = room.playlist[currentIndex + 1];
    if (!nextItem && room.settings.looping) {
      nextItem = room.playlist[0];
    }
  }

  const timeRemaining = duration - playedSeconds;
  const showUpNext =
    canControl &&
    room?.settings.autoplayNext &&
    nextItem &&
    duration > 0 &&
    timeRemaining <= 5 &&
    timeRemaining > 0;

  return (
    <div
      ref={containerRef}
      className="bg-theme-bg group react-player-wrapper border-theme-border/50 font-theme relative flex h-full w-full flex-1 flex-col border-y-2 lg:border-x-2 lg:border-y-0"
    >
      {nativeInteraction && (
        <div className="animate-in slide-in-from-top-4 fade-in absolute top-4 left-1/2 z-[60] -translate-x-1/2">
          <button
            onClick={() => setNativeInteraction(false)}
            className="bg-theme-danger/90 hover:bg-theme-danger text-theme-bg flex items-center gap-2 rounded-full px-6 py-2 font-bold tracking-widest uppercase shadow-[0_0_20px_var(--color-theme-danger)] transition-all"
          >
            <ExternalLink className="h-5 w-5" />
            Exit Native Controls
          </button>
        </div>
      )}

      <div
        className="relative h-full w-full flex-1"
        style={{ containerType: "size" } as React.CSSProperties}
        onClick={() => {
          if (qualityMenuOpen) setQualityMenuOpen(false);
        }}
      >
        <div
          className="absolute top-0 left-0 origin-top-left transition-transform duration-700"
          style={
            currentMedia.provider === "youtube" && forceHighRes
              ? {
                  width: 3840,
                  height: 2160,
                  transform: `scaleX(calc(100cqw / 3840)) scaleY(calc(100cqh / 2160))`,
                }
              : { width: "100%", height: "100%", transform: "none" }
          }
        >
          {mounted && (
            <ReactPlayer
              ref={playerRef}
              url={currentMedia.url}
              width="100%"
              height="100%"
              playing={playing}
              volume={volume}
              muted={muted}
              playbackRate={localPlaybackRate}
              progressInterval={500}
              onReady={() => {
                setIsReady(true);
                setError(null);

                // Extract HLS Levels if it's a direct stream
                if (
                  currentMedia.provider !== "youtube" &&
                  currentMedia.provider !== "twitch" &&
                  currentMedia.provider !== "vimeo"
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
              onTimeUpdate={(e: any) => {
                const ct = (e.currentTarget as any).currentTime || 0;
                const dur = (e.currentTarget as any).duration || 1;
                handleProgress({ played: ct / dur, playedSeconds: ct });
              }}
              onSeeked={(e: any) => {
                const ct = (e.currentTarget as any).currentTime || 0;
                if (nativeInteraction && canControl) {
                  emitCommand("seek", { position: ct });
                  if (playing) {
                    emitCommand("play", { position: ct });
                  }
                }
              }}
              onDurationChange={(e: any) => {
                const dur = (e.currentTarget as any).duration || 0;
                setDuration(dur);
                if (canControl && room && room.currentMediaId) {
                  emitCommand("update_duration", {
                    itemId: room.currentMediaId,
                    duration: dur,
                  });
                }
              }}
              onEnded={() => {
                if (canControl) {
                  emitCommand("video_ended", {
                    currentMediaId: room?.currentMediaId,
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
                setIsBuffering(false);
                setPlaying(true);
                if (ignoreNextPlayPauseEvent.current) {
                  ignoreNextPlayPauseEvent.current = false;
                  return;
                }
                if (canControl && playback?.status !== "playing") {
                  let pos = getAccurateTime();
                  if (pos === 0 && playback && playback.basePosition > 2) {
                    pos = playback.basePosition;
                  }
                  emitCommand("play", { position: pos });
                }
              }}
              onPause={() => {
                setIsBuffering(false);
                setPlaying(false);
                if (ignoreNextPlayPauseEvent.current) {
                  ignoreNextPlayPauseEvent.current = false;
                  return;
                }
                if (canControl && playback?.status === "playing" && !seeking) {
                  emitCommand("pause", { position: getAccurateTime() });
                }
              }}
              style={{ position: "absolute", top: 0, left: 0 }}
              config={{
                youtube: { playerVars: { showinfo: 1, controls: 0 } },
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

        {/* Thematic Scanline Overlay - Hidden for Twitch to prevent iframe visibility occlusion blocks */}
        {currentMedia.provider?.toLowerCase() !== "twitch" && (
          <div className="pointer-events-none absolute inset-0 z-0 bg-[linear-gradient(rgba(0,0,0,0)_50%,rgba(0,0,0,0.1)_50%)] bg-[length:100%_4px] opacity-30 mix-blend-overlay" />
        )}

        {/* Interaction overlay - Hidden for Twitch because Twitch requires native controls for volume/quality and blocks occluded autoplay */}
        {currentMedia.provider?.toLowerCase() !== "twitch" &&
          !nativeInteraction && (
            <div
              className={`absolute inset-0 z-10 ${canControl ? "cursor-pointer" : "cursor-default"}`}
              onClick={() => {
                if (qualityMenuOpen) {
                  setQualityMenuOpen(false);
                  return;
                }
                if (canControl) {
                  playing ? handlePause() : handlePlay();
                }
              }}
            />
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
              <div className="bg-theme-accent text-theme-bg rounded-full px-4 py-1 text-xs font-bold tracking-[0.2em] uppercase shadow-[var(--theme-shadow)]">
                {playback?.status === "buffering" && !isBuffering
                  ? `Syncing to ${playback.updatedBy}`
                  : "Buffering Stream"}
              </div>
            </div>
          )}

        {/* PAUSED Overlay */}
        {!playing && !isBuffering && isReady && !error && (
          <div className="pointer-events-none absolute inset-0 z-20 flex flex-col items-center justify-center bg-black/40 backdrop-blur-[2px] transition-opacity duration-300">
            <div className="bg-theme-bg/80 border-theme-accent text-theme-accent flex h-24 w-24 items-center justify-center rounded-full border-4 shadow-[0_0_30px_var(--color-theme-accent)] backdrop-blur-md">
              <Play className="ml-2 h-12 w-12" />
            </div>
          </div>
        )}
      </div>

      {/* Custom Controls Panel */}
      {!nativeInteraction && (
        <div className="font-theme absolute right-0 bottom-0 left-0 z-[60] p-4 opacity-0 transition-opacity duration-300 group-hover:opacity-100 focus-within:opacity-100">
          <div className="bg-theme-bg/80 border-theme-border/50 rounded-theme border-2 p-3 shadow-lg backdrop-blur-md">
            {/* Timeline */}
            <div className="mb-3 flex items-center space-x-4">
              <span className="text-theme-accent w-14 text-right text-xs font-bold">
                {formatTime(played * duration)}
              </span>
              <div
                className="bg-theme-bg/80 border-theme-border/50 group/timeline relative h-4 flex-1 cursor-pointer overflow-hidden rounded-full border shadow-inner"
                onPointerDown={(e) => {
                  if (
                    !canControl ||
                    currentMedia?.provider?.toLowerCase() === "twitch"
                  )
                    return;
                  e.currentTarget.setPointerCapture(e.pointerId);
                  handleSeekMouseDown();
                  const rect = e.currentTarget.getBoundingClientRect();
                  const percent = Math.max(
                    0,
                    Math.min(1, (e.clientX - rect.left) / rect.width),
                  );
                  setPlayed(percent);
                }}
                onPointerMove={(e) => {
                  if (
                    !seeking ||
                    !canControl ||
                    currentMedia?.provider?.toLowerCase() === "twitch"
                  )
                    return;
                  const rect = e.currentTarget.getBoundingClientRect();
                  const percent = Math.max(
                    0,
                    Math.min(1, (e.clientX - rect.left) / rect.width),
                  );
                  setPlayed(percent);
                }}
                onPointerUp={(e) => {
                  if (
                    !seeking ||
                    !canControl ||
                    currentMedia?.provider?.toLowerCase() === "twitch"
                  )
                    return;
                  e.currentTarget.releasePointerCapture(e.pointerId);
                  const rect = e.currentTarget.getBoundingClientRect();
                  const percent = Math.max(
                    0,
                    Math.min(1, (e.clientX - rect.left) / rect.width),
                  );
                  handleSeekMouseUp(percent);
                }}
              >
                <motion.div
                  className="from-theme-accent/80 to-theme-accent absolute top-0 left-0 h-full rounded-r-full bg-gradient-to-r shadow-[0_0_12px_var(--color-theme-accent)]"
                  style={{ width: `${played * 100}%` }}
                  layout
                  transition={{ type: "tween", ease: "linear", duration: 0.1 }}
                />
              </div>
              <span className="text-theme-accent w-14 text-left text-xs font-bold">
                {formatTime(duration)}
              </span>
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
                      ? "border-theme-accent text-theme-accent hover:bg-theme-accent hover:text-theme-bg shadow-[var(--theme-shadow)] active:translate-y-0.5 active:shadow-none"
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
                      setQualityMenuOpen(!qualityMenuOpen);
                    }}
                  >
                    <Settings className="h-5 w-5" />
                    {forceHighRes && currentMedia.provider === "youtube" && (
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

                        {currentMedia.provider === "youtube" && (
                          <div className="flex flex-col">
                            <div className="text-theme-muted border-theme-border/10 border-b px-4 py-2 text-[9px] tracking-widest uppercase">
                              YouTube Override
                            </div>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setForceHighRes(!forceHighRes);
                                setQualityMenuOpen(false);
                                try {
                                  (
                                    playerRef.current as any
                                  )?.setPlaybackQuality?.("hd1080");
                                } catch (err) {}
                              }}
                              className={`border-theme-border/10 hover:bg-theme-accent/20 flex items-center justify-between border-b px-4 py-3 text-left text-xs font-bold transition-all ${forceHighRes ? "text-theme-accent bg-theme-accent/10 shadow-[inset_2px_0_0_var(--color-theme-accent)]" : "text-theme-text"}`}
                            >
                              Ultra (Force 4K)
                              {forceHighRes && (
                                <div className="bg-theme-accent h-2 w-2 rounded-full shadow-[0_0_5px_currentColor]"></div>
                              )}
                            </button>
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

                        <div className="bg-theme-bg/90 mt-1">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setNativeInteraction(true);
                              setQualityMenuOpen(false);
                            }}
                            className="text-theme-danger hover:bg-theme-danger/20 border-theme-border/30 flex w-full items-center gap-3 border-t px-4 py-4 text-left text-xs font-bold transition-all hover:text-red-400"
                          >
                            <ExternalLink className="h-5 w-5" />
                            Unlock Native Controls
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Sync Status Badge */}
                {drift >= 0.5 && (
                  <div className="bg-theme-bg/80 border-theme-border/50 rounded-theme animate-in fade-in mr-2 hidden min-w-[120px] items-center justify-center space-x-2 border px-3 py-1.5 text-[10px] font-bold uppercase shadow-sm md:flex">
                    <div
                      className={`h-2 w-2 rounded-full ${
                        drift < 2
                          ? "bg-theme-danger shadow-[0_0_8px_var(--color-theme-danger)]"
                          : "bg-red-500 shadow-[0_0_8px_rgb(239,68,68)]"
                      }`}
                    />
                    <span
                      className={`hidden sm:inline-block ${
                        drift < 2 ? "text-theme-danger" : "text-red-500"
                      }`}
                    >
                      {drift < 2 ? "Sync: Locking" : "Sync: Lost"}
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
