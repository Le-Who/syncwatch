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
    if (!playback || !isReady || seeking) return;

    const syncPlayback = () => {
      // Don't force sync if we recently emitted a command (trust optimistic UI)
      if (
        lastStateEmittedRef.current &&
        Date.now() - lastStateEmittedRef.current.time < 1500
      ) {
        return;
      }

      const currentServerTime = Date.now() + serverClockOffset;
      const currentPosition = getAccurateTime();

      if (playback.status === "playing") {
        const expectedPosition =
          playback.basePosition +
          (currentServerTime - playback.baseTimestamp) / 1000;
        const currentDrift = Math.abs(expectedPosition - currentPosition);
        setDrift(currentDrift);

        if (!playing) {
          ignoreNextPlayPauseEvent.current = true;
          setPlaying(true);
        }

        if (currentDrift > 2.0 && !isBuffering) {
          performProgrammaticSeek(expectedPosition);
        }
      } else if (playback.status === "paused") {
        const currentDrift = Math.abs(playback.basePosition - currentPosition);
        setDrift(currentDrift);

        if (playing) {
          ignoreNextPlayPauseEvent.current = true;
          setPlaying(false);
        }

        if (currentDrift > 1.0) {
          performProgrammaticSeek(playback.basePosition);
        }
      } else if (playback.status === "buffering") {
        // Someone else buffering. We should pause and sync position.
        const currentDrift = Math.abs(playback.basePosition - currentPosition);
        setDrift(currentDrift);

        if (playing) {
          ignoreNextPlayPauseEvent.current = true;
          setPlaying(false);
        }

        if (currentDrift > 1.0) {
          performProgrammaticSeek(playback.basePosition);
        }
      }
    };

    syncPlayback();
    const interval = setInterval(syncPlayback, 1000); // Tighter sync loop
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

  const emitCommand = (type: string, payload: any) => {
    lastStateEmittedRef.current = {
      status: type,
      position: payload.position,
      time: Date.now(),
    };
    sendCommand(type, payload);
  };

  const handlePlay = () => {
    if (!room || !participantId || !canControl) return;
    ignoreNextPlayPauseEvent.current = true;
    setPlaying(true);
    emitCommand("play", { position: getAccurateTime() });
  };

  const handlePause = () => {
    if (!room || !participantId || !canControl) return;
    ignoreNextPlayPauseEvent.current = true;
    setPlaying(false);
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
      <div className="flex-1 flex flex-col items-center justify-center bg-black text-zinc-500">
        <Play className="w-16 h-16 mb-4 opacity-20" />
        <p>No video selected</p>
        <p className="text-sm mt-2">
          Add a video to the playlist to start watching
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col bg-black relative group react-player-wrapper">
      <div className="flex-1 relative">
        <ReactPlayer
          ref={playerRef}
          url={currentMedia.url}
          width="100%"
          height="100%"
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
            setError(
              "Failed to load media. Check the URL or provider restrictions.",
            );
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
              // Only broadcast if we didn't just recently emit a command
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
            if (ignoreNextPlayPauseEvent.current) {
              ignoreNextPlayPauseEvent.current = false;
              return;
            }
            if (canControl && playback?.status !== "paused") {
              emitCommand("pause", { position: getAccurateTime() });
            }
          }}
          style={{ position: "absolute", top: 0, left: 0 }}
          config={{
            youtube: { playerVars: { showinfo: 1, controls: 0 } },
            vimeo: { playerOptions: { controls: false } },
          }}
        />

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
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-black/80 backdrop-blur-sm">
            <AlertCircle className="w-12 h-12 text-red-500 mb-2" />
            <p className="text-white font-medium text-lg px-4 text-center">
              {error}
            </p>
          </div>
        )}

        {(isBuffering || playback?.status === "buffering") && !error && (
          <div className="absolute px-6 py-4 rounded-xl inset-0 z-20 flex flex-col items-center justify-center bg-black/50 backdrop-blur-md transition-opacity">
            <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-indigo-500 mb-4"></div>
            <p className="text-white font-medium tracking-wide">
              {playback?.status === "buffering" && !isBuffering
                ? `Waiting for ${playback.updatedBy}...`
                : "Buffering..."}
            </p>
          </div>
        )}
      </div>

      {/* Custom Controls Overlay */}
      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-zinc-950 via-zinc-900/80 to-transparent p-4 opacity-0 group-hover:opacity-100 transition-opacity duration-300 z-30">
        <div className="flex items-center space-x-3 mb-2">
          <span className="text-xs text-zinc-300 font-mono w-10 text-right">
            {formatTime(played * duration)}
          </span>
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
            className={`flex-1 h-1.5 bg-zinc-700/50 rounded-full appearance-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:rounded-full transition-all ${
              canControl
                ? "cursor-pointer hover:[&::-webkit-slider-thumb]:scale-125 [&::-webkit-slider-thumb]:bg-indigo-500"
                : "cursor-not-allowed [&::-webkit-slider-thumb]:bg-zinc-500"
            }`}
          />
          <span className="text-xs text-zinc-300 font-mono w-10">
            {formatTime(duration)}
          </span>
        </div>

        <div className="flex items-center justify-between mt-1">
          <div className="flex items-center space-x-5">
            <button
              onClick={(e) => {
                e.stopPropagation();
                playing ? handlePause() : handlePlay();
              }}
              disabled={!canControl}
              className={`transition-all hover:scale-110 ${canControl ? "text-white drop-shadow-[0_0_8px_rgba(99,102,241,0.5)]" : "text-zinc-600 cursor-not-allowed"}`}
            >
              {playing ? (
                <Pause className="w-6 h-6 fill-current" />
              ) : (
                <Play className="w-6 h-6 fill-current ml-0.5" />
              )}
            </button>

            <button
              onClick={(e) => {
                e.stopPropagation();
                handleNext();
              }}
              disabled={!canControl}
              className={`transition-colors hover:scale-110 ${canControl ? "text-zinc-200 hover:text-white" : "text-zinc-600 cursor-not-allowed"}`}
            >
              <SkipForward className="w-5 h-5 fill-current" />
            </button>

            <div className="flex items-center space-x-2 group/volume relative">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setMuted(!muted);
                }}
                className="text-zinc-300 hover:text-white transition-colors"
              >
                {muted || volume === 0 ? (
                  <VolumeX className="w-5 h-5" />
                ) : (
                  <Volume2 className="w-5 h-5" />
                )}
              </button>
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
                className="w-0 group-hover/volume:w-24 overflow-hidden transition-all duration-300 h-1.5 bg-zinc-600 rounded-full appearance-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-2.5 [&::-webkit-slider-thumb]:h-2.5 [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:rounded-full cursor-pointer opacity-0 group-hover/volume:opacity-100"
              />
            </div>

            <div className="hidden md:flex ml-4 px-2 py-0.5 rounded text-xs font-medium bg-zinc-800 text-zinc-300 capitalize">
              {currentMedia.provider}
            </div>

            <div className="text-sm font-medium text-white max-w-[200px] lg:max-w-md truncate ml-2">
              {currentMedia.title}
            </div>
          </div>

          <div className="flex items-center space-x-4">
            <div className="flex items-center space-x-2 text-xs mr-2 bg-zinc-900/80 px-2.5 py-1 rounded-full border border-zinc-800">
              <div
                className={`w-2 h-2 rounded-full shadow-sm ${
                  drift < 0.5
                    ? "bg-emerald-500 shadow-emerald-500/50"
                    : drift < 2
                      ? "bg-yellow-500 shadow-yellow-500/50"
                      : "bg-red-500 shadow-red-500/50"
                }`}
              />
              <span className="text-zinc-300 font-medium hidden sm:inline-block">
                {drift < 0.5 ? "Synced" : drift < 2 ? "Syncing" : "Unsynced"}
              </span>
            </div>
            {playback?.updatedBy && (
              <span className="text-xs text-zinc-400 hidden lg:inline-block opacity-80">
                {playback.status === "playing" ? "Played" : "Paused"} by{" "}
                <strong className="text-zinc-200 font-medium">
                  {playback.updatedBy}
                </strong>
              </span>
            )}
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
              className="text-zinc-300 hover:text-white transition-colors hover:scale-110"
            >
              <Maximize className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
