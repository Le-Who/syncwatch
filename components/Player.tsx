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
import ReactPlayerImport from "react-player";
import { motion } from "motion/react";

const ReactPlayer = ReactPlayerImport as any;

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
    return playerRef.current?.getCurrentTime() || 0;
  }, []);

  const performProgrammaticSeek = (position: number) => {
    ignoreNextPlayPauseEvent.current = true; // A seek might trigger buffering/play events
    playerRef.current?.seekTo(position, "seconds");
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
    playerRef.current?.seekTo(newPosition, "seconds");

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
      <div className="w-full h-full flex flex-col items-center justify-center bg-transparent relative overflow-hidden font-theme p-4 flex-1">
        <div className="relative z-10 flex flex-col items-center max-w-lg w-full theme-panel p-8">
          <div className="w-24 h-24 bg-theme-bg/50 border-2 border-theme-accent flex items-center justify-center mb-8 rounded-full shadow-[var(--theme-shadow)] group-hover:shadow-[var(--theme-shadow-hover)] transition-all">
            <Play className="w-12 h-12 text-theme-accent ml-2" />
          </div>
          <h2 className="text-3xl font-bold text-theme-text mb-2 uppercase tracking-widest drop-shadow-sm text-center">
            Awaiting Signal
          </h2>
          <p className="text-theme-muted text-center mb-10 text-sm uppercase tracking-wider opacity-80">
            System ready. Awaiting media input...
          </p>

          {canEditPlaylist ||
          Object.keys(room?.participants || {}).length <= 1 ? (
            <form
              className="w-full relative"
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
              <div className="flex flex-col sm:flex-row items-stretch bg-theme-bg/50 border-2 border-theme-border/50 rounded-theme shadow-[var(--theme-shadow)] focus-within:shadow-[var(--theme-shadow-hover)] focus-within:border-theme-accent transition-all overflow-hidden relative">
                <input
                  name="urlInput"
                  type="url"
                  placeholder="Paste video stream URL..."
                  className="flex-1 bg-transparent px-5 py-4 text-theme-text placeholder-theme-muted focus:outline-none font-theme text-sm"
                  required
                />
                <button
                  type="submit"
                  className="px-8 py-4 bg-theme-accent hover:filter hover:brightness-110 text-theme-bg font-bold uppercase tracking-wider transition-all sm:border-l-2 border-theme-border/30 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Init
                </button>
              </div>
            </form>
          ) : (
            <div className="px-6 py-4 bg-theme-bg/50 border-2 border-theme-danger text-theme-danger text-xs font-theme uppercase tracking-wider flex items-center gap-3 rounded-theme shadow-[var(--theme-shadow)]">
              <AlertCircle className="w-5 h-5" />
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
      className="w-full h-full flex flex-col bg-theme-bg relative group react-player-wrapper border-y-2 lg:border-y-0 lg:border-x-2 border-theme-border/50 font-theme flex-1"
    >
      {nativeInteraction && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[60] animate-in slide-in-from-top-4 fade-in">
          <button
            onClick={() => setNativeInteraction(false)}
            className="bg-theme-danger/90 hover:bg-theme-danger text-theme-bg px-6 py-2 rounded-full font-bold uppercase tracking-widest shadow-[0_0_20px_var(--color-theme-danger)] transition-all flex items-center gap-2"
          >
            <ExternalLink className="w-5 h-5" />
            Exit Native Controls
          </button>
        </div>
      )}

      <div
        className="w-full h-full relative flex-1"
        style={{ containerType: "size" } as React.CSSProperties}
        onClick={() => {
          if (qualityMenuOpen) setQualityMenuOpen(false);
        }}
      >
        <div
          className="absolute top-0 left-0 transition-transform duration-700 origin-top-left"
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
                    const internal =
                      playerRef.current?.getInternalPlayer("hls");
                    if (internal && internal.levels) {
                      setHlsLevels(internal.levels);
                      setCurrentHlsLevel(internal.currentLevel);
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
              onProgress={handleProgress}
              onSeek={(seconds: number) => {
                if (nativeInteraction && canControl) {
                  emitCommand("seek", { position: seconds });
                  if (playing) {
                    emitCommand("play", { position: seconds });
                  }
                }
              }}
              onDuration={(dur: number) => {
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
              onBuffer={() => {
                setIsBuffering(true);
              }}
              onBufferEnd={() => {
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
          <div className="absolute bottom-24 right-4 z-40 bg-theme-bg/95 backdrop-blur-md border border-theme-border/50 rounded-theme p-4 shadow-[0_10px_40px_rgba(0,0,0,0.5)] flex items-center space-x-4 animate-in fade-in slide-in-from-right-8 pointer-events-auto">
            <div className="relative flex items-center justify-center w-12 h-12">
              <svg className="w-full h-full transform -rotate-90">
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
              <span className="absolute text-sm font-bold text-theme-text">
                {Math.ceil(timeRemaining)}
              </span>
            </div>
            <div className="flex flex-col max-w-[200px] truncate pr-4">
              <span className="text-[10px] uppercase font-bold tracking-widest text-theme-muted">
                Up Next
              </span>
              <span className="text-sm font-bold truncate text-theme-text">
                {nextItem?.title}
              </span>
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleNext();
              }}
              className="text-theme-bg bg-theme-accent hover:filter hover:brightness-110 px-3 py-1.5 rounded-theme text-xs font-bold uppercase tracking-widest transition-all"
            >
              Skip
            </button>
          </div>
        )}

        {/* Thematic Scanline Overlay - Hidden for Twitch to prevent iframe visibility occlusion blocks */}
        {currentMedia.provider?.toLowerCase() !== "twitch" && (
          <div className="absolute inset-0 z-0 pointer-events-none mix-blend-overlay opacity-30 bg-[linear-gradient(rgba(0,0,0,0)_50%,rgba(0,0,0,0.1)_50%)] bg-[length:100%_4px]" />
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
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-theme-bg/95 backdrop-blur-sm border-4 border-theme-danger shadow-[inset_0_0_50px_var(--color-theme-danger)]">
            <AlertCircle className="w-16 h-16 text-theme-danger mb-4 animate-pulse" />
            <div className="bg-theme-danger text-theme-bg px-4 py-1 uppercase font-bold text-sm tracking-[0.2em] mb-2 rounded-full">
              Critical Error
            </div>
            <p className="text-theme-danger font-theme text-lg uppercase tracking-wider text-center max-w-md">
              {error}
            </p>
          </div>
        )}

        {/* Buffering Overlay - Yield to explicit Pause state */}
        {(isBuffering || playback?.status === "buffering") &&
          playing &&
          !error && (
            <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-theme-bg/80 backdrop-blur-sm">
              <div className="w-16 h-16 border-4 border-theme-accent border-t-transparent border-b-theme-danger rounded-full animate-spin mb-6" />
              <div className="bg-theme-accent text-theme-bg px-4 py-1 text-xs uppercase font-bold tracking-[0.2em] shadow-[var(--theme-shadow)] rounded-full">
                {playback?.status === "buffering" && !isBuffering
                  ? `Syncing to ${playback.updatedBy}`
                  : "Buffering Stream"}
              </div>
            </div>
          )}

        {/* PAUSED Overlay */}
        {!playing && !isBuffering && isReady && !error && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-black/40 backdrop-blur-[2px] pointer-events-none transition-opacity duration-300">
            <div className="w-24 h-24 bg-theme-bg/80 backdrop-blur-md rounded-full flex items-center justify-center border-4 border-theme-accent text-theme-accent shadow-[0_0_30px_var(--color-theme-accent)]">
              <Play className="w-12 h-12 ml-2" />
            </div>
          </div>
        )}
      </div>

      {/* Custom Controls Panel */}
      {!nativeInteraction && (
        <div className="absolute bottom-0 left-0 right-0 p-4 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity duration-300 z-[60] font-theme">
          <div className="bg-theme-bg/80 border-2 border-theme-border/50 p-3 shadow-lg backdrop-blur-md rounded-theme">
            {/* Timeline */}
            <div className="flex items-center space-x-4 mb-3">
              <span className="text-xs text-theme-accent font-bold w-14 text-right">
                {formatTime(played * duration)}
              </span>
              <div
                className="flex-1 relative h-4 bg-theme-bg/80 border border-theme-border/50 rounded-full overflow-hidden cursor-pointer group/timeline shadow-inner"
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
                  className="absolute top-0 left-0 h-full bg-gradient-to-r from-theme-accent/80 to-theme-accent shadow-[0_0_12px_var(--color-theme-accent)] rounded-r-full"
                  style={{ width: `${played * 100}%` }}
                  layout
                  transition={{ type: "tween", ease: "linear", duration: 0.1 }}
                />
              </div>
              <span className="text-xs text-theme-accent font-bold w-14 text-left">
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
                  className={`w-10 h-10 flex items-center justify-center border-2 border-inherit transition-all outline-none focus-visible:ring-2 ring-theme-accent rounded-theme
                  ${
                    canControl
                      ? "border-theme-accent text-theme-accent hover:bg-theme-accent hover:text-theme-bg active:translate-y-0.5 active:shadow-none shadow-[var(--theme-shadow)]"
                      : "border-theme-border text-theme-muted cursor-not-allowed"
                  }`}
                >
                  {playing ? (
                    <Pause className="w-5 h-5 fill-current" />
                  ) : (
                    <Play className="w-5 h-5 fill-current ml-1" />
                  )}
                </button>

                {/* Next */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleNext();
                  }}
                  disabled={!canControl}
                  className={`transition-all hover:scale-110 outline-none focus-visible:ring-2 ring-theme-accent rounded-full
                  ${canControl ? "text-theme-accent hover:text-theme-danger" : "text-theme-muted cursor-not-allowed"}`}
                >
                  <SkipForward className="w-5 h-5 fill-current" />
                </button>

                {/* Playback Speed */}
                <div className="flex items-center space-x-2 relative group/speed">
                  <button className="text-theme-accent hover:text-theme-danger text-[10px] font-bold uppercase tracking-widest outline-none focus-visible:ring-2 ring-theme-accent rounded-sm px-1.5 py-1 border border-theme-accent/30 transition-colors">
                    {playback?.rate || 1}x
                  </button>
                  {/* Add a transparent bridge area using pb-2 on the outer container so hovering the gap keeps it open */}
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 pb-2 hidden group-hover/speed:flex flex-col z-50">
                    <div className="bg-theme-bg/95 border-2 border-theme-border/50 rounded-theme shadow-xl backdrop-blur-md overflow-hidden flex flex-col">
                      <div className="text-[9px] text-theme-muted font-bold text-center py-1.5 border-b border-theme-border/30 tracking-widest uppercase bg-theme-bg/50">
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
                          className={`px-4 py-2.5 text-xs font-bold transition-all border-b border-theme-border/10 last:border-0 hover:bg-theme-accent/20 ${
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
                <div className="flex items-center space-x-3 group/volume relative">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setMuted(!muted);
                    }}
                    className="text-theme-accent hover:text-theme-danger transition-colors outline-none focus-visible:ring-2 ring-theme-accent rounded-full"
                  >
                    {muted || volume === 0 ? (
                      <VolumeX className="w-5 h-5" />
                    ) : (
                      <Volume2 className="w-5 h-5" />
                    )}
                  </button>
                  <div className="w-0 group-hover/volume:w-24 overflow-hidden transition-all duration-300 relative h-2 bg-theme-bg border border-theme-border/30 rounded-theme">
                    <div
                      className="absolute top-0 left-0 h-full bg-theme-accent rounded-theme"
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
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                    />
                  </div>
                </div>

                {/* Meta */}
                <div className="hidden md:flex ml-4 px-3 py-0.5 bg-theme-accent text-theme-bg text-[10px] font-bold uppercase tracking-wider rounded-full shadow-sm">
                  {currentMedia.provider}
                </div>

                <div className="text-xs font-bold text-theme-text max-w-[150px] lg:max-w-xs xl:max-w-md truncate ml-2 uppercase tracking-wide drop-shadow-sm">
                  {currentMedia.title}
                </div>
              </div>

              <div className="flex items-center space-x-4">
                {/* Quality Settings */}
                <div className="flex items-center space-x-2 relative group/quality">
                  <button
                    className={`text-theme-accent hover:text-theme-danger outline-none focus-visible:ring-2 ring-theme-accent rounded-full p-2 transition-transform duration-500 relative ${qualityMenuOpen ? "rotate-90 text-theme-danger" : ""}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setQualityMenuOpen(!qualityMenuOpen);
                    }}
                  >
                    <Settings className="w-5 h-5" />
                    {forceHighRes && currentMedia.provider === "youtube" && (
                      <div className="absolute top-1 right-1 w-2 h-2 rounded-full bg-theme-accent animate-pulse shadow-[0_0_8px_var(--color-theme-accent)]" />
                    )}
                  </button>

                  {/* Quality Menu Dialog */}
                  {qualityMenuOpen && (
                    <div className="absolute bottom-full right-0 mb-4 pb-2 z-50 flex flex-col items-end">
                      <div className="bg-theme-bg/95 backdrop-blur-xl border border-theme-border/50 rounded-theme shadow-[0_0_40px_rgba(0,0,0,0.5)] overflow-hidden flex flex-col min-w-[220px] animate-in slide-in-from-bottom-2 fade-in">
                        <div className="text-[10px] text-theme-muted font-bold px-4 py-2 border-b border-theme-border/30 tracking-widest uppercase bg-theme-bg/50">
                          Video Quality
                        </div>

                        {currentMedia.provider === "youtube" && (
                          <div className="flex flex-col">
                            <div className="px-4 py-2 text-[9px] uppercase tracking-widest text-theme-muted border-b border-theme-border/10">
                              YouTube Override
                            </div>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setForceHighRes(!forceHighRes);
                                setQualityMenuOpen(false);
                                try {
                                  playerRef.current
                                    ?.getInternalPlayer()
                                    ?.setPlaybackQuality("hd1080");
                                } catch (err) {}
                              }}
                              className={`px-4 py-3 text-xs font-bold transition-all text-left flex items-center justify-between border-b border-theme-border/10 hover:bg-theme-accent/20 ${forceHighRes ? "text-theme-accent bg-theme-accent/10 shadow-[inset_2px_0_0_var(--color-theme-accent)]" : "text-theme-text"}`}
                            >
                              Ultra (Force 4K)
                              {forceHighRes && (
                                <div className="w-2 h-2 rounded-full bg-theme-accent shadow-[0_0_5px_currentColor]"></div>
                              )}
                            </button>
                          </div>
                        )}

                        {hlsLevels.length > 0 && (
                          <div className="flex flex-col">
                            <div className="px-4 py-2 text-[9px] uppercase tracking-widest text-theme-muted border-b border-theme-border/10">
                              Stream Manifest Levels
                            </div>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setCurrentHlsLevel(-1);
                                try {
                                  const internal =
                                    playerRef.current?.getInternalPlayer("hls");
                                  if (internal) internal.currentLevel = -1;
                                } catch (err) {}
                                setQualityMenuOpen(false);
                              }}
                              className={`px-4 py-3 text-xs font-bold transition-all text-left border-b border-theme-border/10 hover:bg-theme-accent/20 ${currentHlsLevel === -1 ? "text-theme-accent bg-theme-accent/10 shadow-[inset_2px_0_0_var(--color-theme-accent)]" : "text-theme-text"}`}
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
                                    const internal =
                                      playerRef.current?.getInternalPlayer(
                                        "hls",
                                      );
                                    if (internal) internal.currentLevel = idx;
                                  } catch (err) {}
                                  setQualityMenuOpen(false);
                                }}
                                className={`px-4 py-3 text-xs font-bold transition-all text-left border-b border-theme-border/10 last:border-b-0 hover:bg-theme-accent/20 ${currentHlsLevel === idx ? "text-theme-accent bg-theme-accent/10 shadow-[inset_2px_0_0_var(--color-theme-accent)]" : "text-theme-text"}`}
                              >
                                {level.height}p Rate
                              </button>
                            ))}
                          </div>
                        )}

                        <div className="mt-1 bg-theme-bg/90">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setNativeInteraction(true);
                              setQualityMenuOpen(false);
                            }}
                            className="w-full px-4 py-4 text-xs font-bold transition-all text-left flex items-center gap-3 text-theme-danger hover:bg-theme-danger/20 hover:text-red-400 border-t border-theme-border/30"
                          >
                            <ExternalLink className="w-5 h-5" />
                            Unlock Native Controls
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Sync Status Badge */}
                {drift >= 0.5 && (
                  <div className="hidden md:flex items-center space-x-2 text-[10px] uppercase font-bold mr-2 bg-theme-bg/80 px-3 py-1.5 border border-theme-border/50 min-w-[120px] justify-center rounded-theme shadow-sm animate-in fade-in">
                    <div
                      className={`w-2 h-2 rounded-full ${
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
                  <span className="text-[10px] text-theme-muted hidden xl:inline-block uppercase tracking-wider border-l border-theme-border/30 pl-4">
                    CMD: {playback.status === "playing" ? "PLAY" : "PAUSE"}
                    {" // "}
                    <strong className="text-theme-accent truncate max-w-[100px] inline-block align-bottom">
                      {playback.updatedBy}
                    </strong>
                  </span>
                )}

                {/* Theater Mode */}
                <button
                  onClick={toggleTheaterMode}
                  className={`transition-colors hover:scale-110 p-2 outline-none focus-visible:ring-2 ring-theme-accent rounded-full ${
                    theaterMode
                      ? "text-theme-danger"
                      : "text-theme-accent hover:text-theme-danger"
                  }`}
                  title="Theater Mode"
                >
                  <MonitorPlay className="w-5 h-5" />
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
                  className="text-theme-accent hover:text-theme-danger transition-colors hover:scale-110 p-2 outline-none focus-visible:ring-2 ring-theme-accent rounded-full"
                >
                  <Maximize className="w-5 h-5" />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
