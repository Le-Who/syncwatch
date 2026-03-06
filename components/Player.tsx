"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import dynamic from "next/dynamic";
import { useStore } from "@/lib/store";
import {
  Play,
  Pause,
  SkipForward,
  Volume2,
  VolumeX,
  Maximize,
  AlertCircle,
} from "lucide-react";

const ReactPlayer = dynamic(() => import("react-player"), {
  ssr: false,
}) as any;

export default function Player() {
  const { room, participantId, sendCommand, serverClockOffset } = useStore();
  const playerRef = useRef<any>(null);
  const [playing, setPlaying] = useState(false);
  const [volume, setVolume] = useState(0.8);
  const [muted, setMuted] = useState(false);
  const [played, setPlayed] = useState(0);
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
          (currentServerTime - playback.baseTimestamp) / 1000;
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
      <div className="flex-1 flex flex-col items-center justify-center bg-[#050505] relative overflow-hidden font-mono">
        {/* Brutalist Grid */}
        <div className="absolute inset-0 bg-[linear-gradient(rgba(0,229,255,0.05)_1px,transparent_1px),linear-gradient(90deg,rgba(0,229,255,0.05)_1px,transparent_1px)] bg-[size:32px_32px] pointer-events-none" />

        <div className="relative z-10 flex flex-col items-center max-w-lg w-full px-6">
          <div className="w-24 h-24 bg-[#050505] border-2 border-[#00E5FF] flex items-center justify-center mb-8 shadow-[8px_8px_0_#FF00FF]">
            <Play className="w-12 h-12 text-[#00E5FF] ml-2" />
          </div>
          <h2 className="text-3xl font-bold text-white mb-2 uppercase tracking-widest drop-shadow-[0_0_10px_rgba(0,229,255,0.5)]">
            Awaiting Signal
          </h2>
          <p className="text-[#00E5FF] text-center mb-10 text-sm uppercase tracking-wider opacity-80">
            System ready. Awaiting media input...
          </p>

          {canControl ? (
            <form
              className="w-full relative"
              onSubmit={(e) => {
                e.preventDefault();
                const input = e.currentTarget.elements.namedItem(
                  "urlInput",
                ) as HTMLInputElement;
                if (input.value.trim()) {
                  sendCommand("add_to_playlist", { url: input.value.trim() });
                  input.value = "";
                }
              }}
            >
              <div className="flex flex-col sm:flex-row items-stretch bg-[#050505] border-2 border-[#FF00FF] shadow-[4px_4px_0_#00E5FF] focus-within:shadow-[8px_8px_0_#00E5FF] transition-shadow">
                <input
                  name="urlInput"
                  type="url"
                  placeholder="Paste video stream URL..."
                  className="flex-1 bg-transparent px-5 py-4 text-white placeholder-zinc-600 focus:outline-none font-mono text-sm uppercase"
                  required
                />
                <button
                  type="submit"
                  className="px-8 py-4 bg-[#FF00FF] hover:bg-white text-black font-bold uppercase tracking-wider transition-colors border-t-2 border-l-2 sm:border-t-0 sm:border-l-2 border-[#FF00FF] hover:border-white"
                >
                  Init
                </button>
              </div>
            </form>
          ) : (
            <div className="px-6 py-4 bg-[#050505] border-2 border-[#FF00FF] text-[#FF00FF] text-xs font-mono uppercase tracking-wider flex items-center gap-3 shadow-[4px_4px_0_#00E5FF]">
              <AlertCircle className="w-5 h-5" />
              <span>Restricted access. Command privileges required.</span>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-[#050505] relative group react-player-wrapper border-y-2 lg:border-y-0 lg:border-x-2 border-[#00E5FF] font-mono">
      <div className="flex-1 relative" ref={containerRef}>
        {dimensions.width > 0 && dimensions.height > 0 && (
          <ReactPlayer
            ref={playerRef}
            url={currentMedia.url}
            width={dimensions.width}
            height={dimensions.height}
            playing={playing}
            volume={volume}
            muted={muted}
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
            onDuration={(dur: number) => setDuration(dur)}
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
            onPlay={() => setIsBuffering(false)}
            onPause={() => setIsBuffering(false)}
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

        {/* Brutalist Scanline Overlay (pointer-events-none) */}
        {/* Adds a slight cyber/CRT effect without blocking clicks */}
        <div className="absolute inset-0 z-0 pointer-events-none bg-[linear-gradient(rgba(0,0,0,0)_50%,rgba(0,0,0,0.1)_50%)] bg-[length:100%_4px]" />

        {/* Interaction overlay */}
        <div
          className={`absolute inset-0 z-10 ${canControl ? "cursor-pointer" : "cursor-default"}`}
          onClick={() => {
            if (canControl) {
              playing ? handlePause() : handlePlay();
            }
          }}
        />

        {error && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-[#050505]/95 backdrop-blur-sm border-4 border-[#FF0000] shadow-[inset_0_0_50px_#FF0000]">
            <AlertCircle className="w-16 h-16 text-[#FF0000] mb-4 animate-pulse" />
            <div className="bg-[#FF0000] text-black px-4 py-1 uppercase font-bold text-sm tracking-[0.2em] mb-2">
              Critical Error
            </div>
            <p className="text-[#FF0000] font-mono text-lg uppercase tracking-wider text-center max-w-md">
              {error}
            </p>
          </div>
        )}

        {(isBuffering || playback?.status === "buffering") && !error && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-[#050505]/80 backdrop-blur-sm">
            <div className="w-16 h-16 border-4 border-[#00E5FF] border-t-transparent border-b-[#FF00FF] animate-spin mb-6" />
            <div className="bg-[#00E5FF] text-black px-3 py-1 text-xs uppercase font-bold tracking-[0.2em] shadow-[0_0_15px_#00E5FF]">
              {playback?.status === "buffering" && !isBuffering
                ? `Syncing to ${playback.updatedBy}`
                : "Buffering Stream"}
            </div>
          </div>
        )}
      </div>

      {/* Brutalist Custom Controls Panel */}
      <div className="absolute bottom-0 left-0 right-0 p-4 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity duration-300 z-30 font-mono">
        <div className="bg-[#050505]/95 border-2 border-[#00E5FF] p-3 shadow-[6px_6px_0_#FF00FF] backdrop-blur-md">
          {/* Timeline */}
          <div className="flex items-center space-x-4 mb-3">
            <span className="text-xs text-[#00E5FF] font-bold w-14 text-right">
              {formatTime(played * duration)}
            </span>
            <div className="flex-1 relative h-3 bg-[#111111] border border-[#333333]">
              <div
                className="absolute top-0 left-0 h-full bg-[repeating-linear-gradient(45deg,transparent,transparent_4px,#00E5FF_4px,#00E5FF_8px)] transition-all ease-linear"
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
            <span className="text-xs text-[#00E5FF] font-bold w-14 text-left">
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
                className={`w-10 h-10 flex items-center justify-center border-2 border-inherit transition-all outline-none focus-visible:ring-2 ring-[#00E5FF] ring-offset-2 ring-offset-[#050505]
                  ${
                    canControl
                      ? "border-[#00E5FF] text-[#00E5FF] hover:bg-[#00E5FF] hover:text-black active:translate-y-px active:shadow-none shadow-[2px_2px_0_#FF00FF]"
                      : "border-zinc-600 text-zinc-600 cursor-not-allowed shadow-[2px_2px_0_rgba(255,255,255,0.1)]"
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
                className={`transition-colors hover:scale-110 outline-none focus-visible:ring-2 ring-[#00E5FF] rounded-sm
                  ${canControl ? "text-[#00E5FF] hover:text-[#FF00FF]" : "text-zinc-600 cursor-not-allowed"}`}
              >
                <SkipForward className="w-5 h-5 fill-current" />
              </button>

              {/* Volume */}
              <div className="flex items-center space-x-3 group/volume relative">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setMuted(!muted);
                  }}
                  className="text-[#00E5FF] hover:text-[#FF00FF] transition-colors outline-none focus-visible:ring-2 ring-[#00E5FF] rounded-sm"
                >
                  {muted || volume === 0 ? (
                    <VolumeX className="w-5 h-5" />
                  ) : (
                    <Volume2 className="w-5 h-5" />
                  )}
                </button>
                <div className="w-0 group-hover/volume:w-24 overflow-hidden transition-all duration-300 relative h-2 bg-[#111111] border border-[#333333]">
                  <div
                    className="absolute top-0 left-0 h-full bg-[#00E5FF]"
                    style={{ width: `${(muted ? 0 : volume) * 100}%` }}
                  />
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step="any"
                    value={muted ? 0 : volume}
                    onChange={(e) => {
                      setVolume(parseFloat(e.target.value));
                      setMuted(false);
                    }}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                  />
                </div>
              </div>

              {/* Meta */}
              <div className="hidden md:flex ml-4 px-2 py-0.5 bg-[#FF00FF] text-black text-[10px] font-bold uppercase tracking-wider shadow-[2px_2px_0_#00E5FF]">
                {currentMedia.provider}
              </div>

              <div className="text-xs font-bold text-white max-w-[150px] lg:max-w-xs xl:max-w-md truncate ml-2 uppercase tracking-wide">
                {currentMedia.title}
              </div>
            </div>

            <div className="flex items-center space-x-4">
              {/* Sync Status Badge */}
              <div className="hidden md:flex items-center space-x-2 text-[10px] uppercase font-bold mr-2 bg-black px-3 py-1.5 border border-[#333333] min-w-[120px] justify-center">
                <div
                  className={`w-2 h-2 ${
                    drift < 0.5
                      ? "bg-[#00E5FF] shadow-[0_0_8px_#00E5FF]"
                      : drift < 2
                        ? "bg-[#FFD700] shadow-[0_0_8px_#FFD700]"
                        : "bg-[#FF0000] shadow-[0_0_8px_#FF0000]"
                  }`}
                />
                <span
                  className={`hidden sm:inline-block ${
                    drift < 0.5
                      ? "text-[#00E5FF]"
                      : drift < 2
                        ? "text-[#FFD700]"
                        : "text-[#FF0000]"
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
                <span className="text-[10px] text-zinc-500 hidden xl:inline-block uppercase tracking-wider border-l border-[#333333] pl-4">
                  CMD: {playback.status === "playing" ? "PLAY" : "PAUSE"}{" "}
                  {"// "}
                  <strong className="text-[#00E5FF] truncate max-w-[100px] inline-block align-bottom">
                    {playback.updatedBy}
                  </strong>
                </span>
              )}

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
                className="text-[#00E5FF] hover:text-[#FF00FF] transition-colors hover:scale-110 p-2 outline-none focus-visible:ring-2 ring-[#00E5FF] rounded-sm"
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
