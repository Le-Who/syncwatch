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
} from "lucide-react";

const ReactPlayer = dynamic(() => import("react-player"), {
  ssr: false,
}) as any;

export default function Player() {
  const { room, participantId, sendCommand, serverClockOffset } = useStore();
  const { volume, muted, theaterMode, setVolume, setMuted, toggleTheaterMode } =
    useSettingsStore();
  const playerRef = useRef<any>(null);
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

  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

  // To avoid loopbacks, track manually initiated actions vs programmatic state syncs
  const ignoreNextPlayPauseEvent = useRef(false);
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
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setError(null);
    setIsReady(false);
    setIsBuffering(false);
  }, [room?.currentMediaId]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setHostName(window.location.hostname);
    }
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setDimensions({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
      }
    });

    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [currentMedia]);

  // In strict server state, we don't emit commands from native events
  const emitCommand = (type: string, payload: any) => {
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
      const currentServerTime = Date.now() + serverClockOffset;
      const currentPosition = getAccurateTime();

      if (playback.status === "playing") {
        const expectedPosition =
          playback.basePosition +
          ((currentServerTime - playback.baseTimestamp) / 1000) * playback.rate;
        const currentDrift = Math.abs(expectedPosition - currentPosition);
        setDrift(currentDrift);

        if (!playing) {
          setPlaying(true);
        }

        if (currentDrift > 2.0 && !isBuffering) {
          performProgrammaticSeek(expectedPosition);
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
      } else if (playback.status === "buffering") {
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
    // We do NOT setPlaying(true) locally anymore. We wait for the server.
    // Instead we trigger visual buffering if playing state hasn't applied yet.
    setIsBuffering(true);
    emitCommand("play", { position: getAccurateTime() });
  };

  const handlePause = () => {
    if (!room || !participantId || !canControl) return;
    // We do NOT setPlaying(false) locally anymore. We wait for the server.
    // Visual indicator:
    setIsBuffering(true);
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
  }, [playing, canControl, handlePlay, handlePause]);

  const handleSeekMouseDown = () => {
    setSeeking(true);
  };

  const handleSeekChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setPlayed(parseFloat(e.target.value));
  };

  const handleSeekMouseUp = (e: React.MouseEvent<HTMLInputElement>) => {
    setSeeking(false);
    const newPosition =
      parseFloat((e.target as HTMLInputElement).value) * duration;
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

  const handleEnded = () => {
    if (canControl) {
      emitCommand("video_ended", { currentMediaId: room?.currentMediaId });
    }
  };
  const handleNext = () => {
    emitCommand("next", { currentMediaId: room?.currentMediaId });
  };

  const formatTime = (seconds: number) => {
    if (!seconds || isNaN(seconds)) return "0:00";
    const date = new Date(seconds * 1000);
    const hh = date.getUTCHours();
    const mm = date.getUTCMinutes();
    const ss = date.getUTCSeconds().toString().padStart(2, "0");
    if (hh) return `${hh}:${mm.toString().padStart(2, "0")}:${ss}`;
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
              onSubmit={(e) => {
                e.preventDefault();
                const input = e.currentTarget.elements.namedItem(
                  "urlInput",
                ) as HTMLInputElement;
                const url = input.value.trim();
                if (url) {
                  let provider = "unknown";
                  if (url.includes("youtube.com") || url.includes("youtu.be"))
                    provider = "youtube";
                  else if (url.includes("twitch.tv")) provider = "twitch";
                  else if (url.includes("vimeo.com")) provider = "vimeo";
                  else if (url.includes("soundcloud.com"))
                    provider = "soundcloud";

                  sendCommand("add_item", {
                    url,
                    provider,
                    title: `Added from Awaiting Signal`,
                    duration: 0,
                  });
                  input.value = "";
                }
              }}
            >
              <div className="flex flex-col sm:flex-row items-stretch bg-theme-bg/50 border-2 border-theme-border/50 rounded-theme shadow-[var(--theme-shadow)] focus-within:shadow-[var(--theme-shadow-hover)] focus-within:border-theme-accent transition-all overflow-hidden">
                <input
                  name="urlInput"
                  type="url"
                  placeholder="Paste video stream URL..."
                  className="flex-1 bg-transparent px-5 py-4 text-theme-text placeholder-theme-muted focus:outline-none font-theme text-sm"
                  required
                />
                <button
                  type="submit"
                  className="px-8 py-4 bg-theme-accent hover:filter hover:brightness-110 text-theme-bg font-bold uppercase tracking-wider transition-all sm:border-l-2 border-theme-border/30"
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
    <div className="w-full h-full flex flex-col bg-theme-bg relative group react-player-wrapper border-y-2 lg:border-y-0 lg:border-x-2 border-theme-border/50 font-theme flex-1">
      <div className="w-full h-full relative flex-1" ref={containerRef}>
        {dimensions.width > 0 && dimensions.height > 0 && (
          <ReactPlayer
            ref={playerRef}
            url={currentMedia.url}
            width={dimensions.width}
            height={dimensions.height}
            playing={playing}
            volume={volume}
            muted={muted}
            playbackRate={playback?.rate || 1}
            progressInterval={500}
            onReady={() => {
              setIsReady(true);
              setError(null);
            }}
            onError={(e: any) => {
              console.error("Player error:", e);
              setError("SYSTEM FAILURE. SIGNAL LOST.");
              setIsBuffering(false);
            }}
            onProgress={handleProgress}
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
              if (
                room?.settings.autoplayNext &&
                room.playlist.length > 1 &&
                canControl
              ) {
                handleNext();
              }
            }}
            onBuffer={() => {
              setIsBuffering(true);
              if (canControl && playback?.status !== "buffering") {
                if (
                  !lastStateEmittedRef.current ||
                  Date.now() - lastStateEmittedRef.current.time > 1500
                ) {
                  emitCommand("buffering", { position: getAccurateTime() });
                }
              }
            }}
            onBufferEnd={() => {
              setIsBuffering(false);
              if (canControl && playback?.status === "buffering") {
                emitCommand("play", { position: getAccurateTime() });
              }
            }}
            onPlay={() => {
              setIsBuffering(false);
              setPlaying(true);
              if (ignoreNextPlayPauseEvent.current) {
                ignoreNextPlayPauseEvent.current = false;
                return;
              }
              if (canControl && playback?.status !== "playing") {
                emitCommand("play", { position: getAccurateTime() });
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
                  parent: [hostName],
                },
              },
            }}
          />
        )}

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
        {currentMedia.provider?.toLowerCase() !== "twitch" && (
          <div
            className={`absolute inset-0 z-10 ${canControl ? "cursor-pointer" : "cursor-default"}`}
            onClick={() => {
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

        {(isBuffering || playback?.status === "buffering") && !error && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-theme-bg/80 backdrop-blur-sm">
            <div className="w-16 h-16 border-4 border-theme-accent border-t-transparent border-b-theme-danger rounded-full animate-spin mb-6" />
            <div className="bg-theme-accent text-theme-bg px-4 py-1 text-xs uppercase font-bold tracking-[0.2em] shadow-[var(--theme-shadow)] rounded-full">
              {playback?.status === "buffering" && !isBuffering
                ? `Syncing to ${playback.updatedBy}`
                : "Buffering Stream"}
            </div>
          </div>
        )}
      </div>

      {/* Custom Controls Panel */}
      <div className="absolute bottom-0 left-0 right-0 p-4 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity duration-300 z-30 font-theme">
        <div className="bg-theme-bg/80 border-2 border-theme-border/50 p-3 shadow-lg backdrop-blur-md rounded-theme">
          {/* Timeline */}
          <div className="flex items-center space-x-4 mb-3">
            <span className="text-xs text-theme-accent font-bold w-14 text-right">
              {formatTime(played * duration)}
            </span>
            <div className="flex-1 relative h-3 bg-theme-bg border border-theme-border/30 rounded-theme overflow-hidden">
              <div
                className="absolute top-0 left-0 h-full bg-theme-accent transition-all ease-linear"
                style={{ width: `${played * 100}%` }}
              />
              <input
                type="range"
                min={0}
                max={0.999}
                step="any"
                value={played}
                disabled={!canControl}
                onMouseDown={canControl ? handleSeekMouseDown : undefined}
                onChange={canControl ? handleSeekChange : undefined}
                onMouseUp={canControl ? handleSeekMouseUp : undefined}
                className={`absolute inset-0 w-full h-full opacity-0 ${
                  canControl ? "cursor-pointer" : "cursor-not-allowed"
                }`}
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
              {/* Sync Status Badge */}
              <div className="hidden md:flex items-center space-x-2 text-[10px] uppercase font-bold mr-2 bg-theme-bg/80 px-3 py-1.5 border border-theme-border/50 min-w-[120px] justify-center rounded-theme shadow-sm">
                <div
                  className={`w-2 h-2 rounded-full ${
                    drift < 0.5
                      ? "bg-theme-accent shadow-[0_0_8px_var(--color-theme-accent)]"
                      : drift < 2
                        ? "bg-theme-danger shadow-[0_0_8px_var(--color-theme-danger)]"
                        : "bg-red-500 shadow-[0_0_8px_rgb(239,68,68)]"
                  }`}
                />
                <span
                  className={`hidden sm:inline-block ${
                    drift < 0.5
                      ? "text-theme-accent"
                      : drift < 2
                        ? "text-theme-danger"
                        : "text-red-500"
                  }`}
                >
                  {drift < 0.5
                    ? "Sync: Locked"
                    : drift < 2
                      ? "Sync: Locking"
                      : "Sync: Lost"}
                </span>
              </div>

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
                  const elem = document.querySelector(".react-player-wrapper");
                  if (elem) {
                    if (document.fullscreenElement) {
                      document.exitFullscreen();
                    } else {
                      elem.requestFullscreen();
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
    </div>
  );
}
