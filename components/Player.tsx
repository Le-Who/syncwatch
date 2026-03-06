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
  const lastSeekTimeRef = useRef<{ time: number; timestamp: number } | null>(null);
  const lastCommandTimeRef = useRef<number>(0);
  const sentBufferingRef = useRef(false);

  const currentMedia = room?.playlist.find(
    (item) => item.id === room.currentMediaId,
  );
  const playback = room?.playback;

  const canControl =
    room?.settings.controlMode === "open" ||
    room?.participants[participantId!]?.role === "owner" ||
    room?.participants[participantId!]?.role === "moderator" ||
    room?.settings.controlMode === "hybrid";

  const safeSendCommand = useCallback((type: string, payload: any) => {
    lastCommandTimeRef.current = Date.now();
    sendCommand(type, payload);
  }, [sendCommand]);

  const getAccurateTime = useCallback(() => {
    if (
      lastSeekTimeRef.current &&
      Date.now() - lastSeekTimeRef.current.timestamp < 500
    ) {
      return lastSeekTimeRef.current.time;
    }
    return playerRef.current?.getCurrentTime() || 0;
  }, []);

  // Sync logic
  const performProgrammaticSeek = (position: number) => {
    playerRef.current?.seekTo(position, "seconds");
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setError(null);
  }, [room?.currentMediaId]);

  useEffect(() => {
    if (!playback || !isReady || seeking) return;

    const syncPlayback = () => {
      // Don't force sync if we just sent a command (wait for server roundtrip)
      if (Date.now() - lastCommandTimeRef.current < 2000) return;

      const currentServerTime = Date.now() + serverClockOffset;
      if (playback.status === "playing") {
        if (isBuffering) {
          // We are buffering, but server thinks we are playing.
          // Tell the server to wait for us.
          if (canControl) {
            safeSendCommand("buffering", { position: getAccurateTime() });
          }
          return;
        }
        
        setPlaying(true);
        const expectedPosition =
          playback.basePosition + (currentServerTime - playback.baseTimestamp) / 1000;
        const currentPosition = getAccurateTime();

        const currentDrift = Math.abs(expectedPosition - currentPosition);
        setDrift(currentDrift);

        if (currentDrift > 2.0) {
          performProgrammaticSeek(expectedPosition);
        }
      } else if (playback.status === "paused") {
        setPlaying(false);
        const currentPosition = getAccurateTime();
        const currentDrift = Math.abs(playback.basePosition - currentPosition);
        setDrift(currentDrift);
        if (currentDrift > 1.0) {
          performProgrammaticSeek(playback.basePosition);
        }
      } else if (playback.status === "buffering") {
        const currentPosition = getAccurateTime();
        const currentDrift = Math.abs(playback.basePosition - currentPosition);
        setDrift(currentDrift);
        if (!isBuffering) {
          setPlaying(false);
          if (currentDrift > 1.0) {
            performProgrammaticSeek(playback.basePosition);
          }
        } else {
          setPlaying(true);
          if (currentDrift > 5.0) {
            performProgrammaticSeek(playback.basePosition);
          }
        }
      }
    };

    syncPlayback();
    const interval = setInterval(syncPlayback, 2000);
    return () => clearInterval(interval);
  }, [playback, isReady, seeking, isBuffering, getAccurateTime, serverClockOffset, canControl, safeSendCommand]);

  const handlePlay = () => {
    if (!room || !participantId || !canControl) return;

    setPlaying(true);
    if (playback?.status === "playing") return;

    const currentTime = getAccurateTime();
    safeSendCommand("play", { position: currentTime });
  };

  const handlePause = () => {
    if (!room || !participantId || !canControl) return;

    setPlaying(false);
    if (playback?.status === "paused") return;

    const currentTime = getAccurateTime();
    safeSendCommand("pause", { position: currentTime });
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
    
    lastSeekTimeRef.current = { time: newPosition, timestamp: Date.now() };
    playerRef.current?.seekTo(newPosition, "seconds");

    if (!room || !participantId || !canControl) return;
    safeSendCommand("seek", { position: newPosition });
  };

  const handleProgress = (state: { played: number; playedSeconds: number }) => {
    if (!seeking) {
      setPlayed(state.played);
    }
    
    if (isBuffering) {
      setIsBuffering(false);
      if (sentBufferingRef.current && canControl) {
        sentBufferingRef.current = false;
        if (playback?.status === "playing" || playback?.status === "buffering") {
          safeSendCommand("play", {
            position: getAccurateTime(),
          });
        }
      }
    }
  };

  const handleDuration = (dur: number) => {
    setDuration(dur);
  };

  const handleEnded = () => {
    if (room?.settings.autoplayNext && room.playlist.length > 1) {
      safeSendCommand("next", { currentMediaId: room.currentMediaId });
    }
  };

  const handleNext = () => {
    safeSendCommand("next", { currentMediaId: room?.currentMediaId });
  };

  const formatTime = (seconds: number) => {
    const date = new Date(seconds * 1000);
    const hh = date.getUTCHours();
    const mm = date.getUTCMinutes();
    const ss = date.getUTCSeconds().toString().padStart(2, "0");
    if (hh) {
      return `${hh}:${mm.toString().padStart(2, "0")}:${ss}`;
    }
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
          onReady={() => {
            setIsReady(true);
            setError(null);
          }}
          onError={(e: any) => {
            console.error("Player error:", e);
            setError("Failed to load media. Please check the URL or try another video.");
            setIsBuffering(false);
            sentBufferingRef.current = false;
          }}
          onProgress={handleProgress}
          onDuration={handleDuration}
          onEnded={handleEnded}
          onBuffer={() => {
            setIsBuffering(true);
            if (playback?.status !== "buffering" && canControl) {
              sentBufferingRef.current = true;
              safeSendCommand("buffering", {
                position: getAccurateTime(),
              });
            }
          }}
          onBufferEnd={() => {
            setIsBuffering(false);
            if (sentBufferingRef.current && canControl) {
              sentBufferingRef.current = false;
              if (playback?.status === "playing" || playback?.status === "buffering") {
                safeSendCommand("play", {
                  position: getAccurateTime(),
                });
              }
            }
          }}
          onPlay={() => {
            setIsBuffering(false);
            if (sentBufferingRef.current && canControl) {
              sentBufferingRef.current = false;
              if (playback?.status === "playing" || playback?.status === "buffering") {
                safeSendCommand("play", {
                  position: getAccurateTime(),
                });
              }
            }
          }}
          onPause={() => {
            setIsBuffering(false);
            sentBufferingRef.current = false;
          }}
          style={{ position: "absolute", top: 0, left: 0 }}
          config={{
            youtube: {
              playerVars: { showinfo: 1, controls: 0 },
            },
          }}
        />

        {/* Transparent overlay to catch clicks and prevent iframe interaction */}
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
            <div className="text-red-500 mb-2">
              <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            </div>
            <p className="text-white font-medium text-lg">{error}</p>
          </div>
        )}

        {(isBuffering || playback?.status === "buffering") && !error && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-black/40 backdrop-blur-sm">
            <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-indigo-500 mb-4"></div>
            <p className="text-white font-medium text-lg tracking-wide">
              {playback?.status === "buffering" && !isBuffering ? `Waiting for ${playback.updatedBy}...` : "Buffering..."}
            </p>
          </div>
        )}
      </div>

      {/* Custom Controls Overlay */}
      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent p-4 opacity-0 group-hover:opacity-100 transition-opacity duration-300 z-30">
        {/* Seek Bar */}
        <div className="flex items-center space-x-3 mb-2">
          <span className="text-xs text-zinc-300 font-mono">
            {formatTime(played * duration)}
          </span>
          <input
            type="range"
            min={0}
            max={0.999999}
            step="any"
            value={played}
            disabled={!canControl}
            onMouseDown={canControl ? handleSeekMouseDown : undefined}
            onChange={canControl ? handleSeekChange : undefined}
            onMouseUp={canControl ? handleSeekMouseUp : undefined}
            className={`flex-1 h-1 bg-zinc-600 rounded-full appearance-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full ${canControl ? "cursor-pointer [&::-webkit-slider-thumb]:bg-indigo-500" : "cursor-not-allowed [&::-webkit-slider-thumb]:bg-zinc-500"}`}
          />
          <span className="text-xs text-zinc-300 font-mono">
            {formatTime(duration)}
          </span>
        </div>

        {/* Controls */}
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <button
              onClick={() => (playing ? handlePause() : handlePlay())}
              disabled={!canControl}
              className={`transition-colors ${canControl ? "text-white hover:text-indigo-400" : "text-zinc-600 cursor-not-allowed"}`}
            >
              {playing ? (
                <Pause className="w-6 h-6 fill-current" />
              ) : (
                <Play className="w-6 h-6 fill-current" />
              )}
            </button>

            <button
              onClick={handleNext}
              disabled={!canControl}
              className={`transition-colors ${canControl ? "text-zinc-300 hover:text-white" : "text-zinc-600 cursor-not-allowed"}`}
            >
              <SkipForward className="w-5 h-5 fill-current" />
            </button>

            <div className="flex items-center space-x-2 group/volume">
              <button
                onClick={() => setMuted(!muted)}
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
                className="w-0 group-hover/volume:w-20 transition-all duration-300 h-1 bg-zinc-600 rounded-full appearance-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-2 [&::-webkit-slider-thumb]:h-2 [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:rounded-full cursor-pointer opacity-0 group-hover/volume:opacity-100"
              />
            </div>

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
              className="text-zinc-300 hover:text-white transition-colors ml-2"
            >
              <Maximize className="w-5 h-5" />
            </button>

            <div className="text-sm text-zinc-400 max-w-[200px] truncate ml-4">
              {currentMedia.title}
            </div>
          </div>

          <div className="flex items-center space-x-4">
            <div className="flex items-center space-x-2 text-xs mr-2">
              <div
                className={`w-2 h-2 rounded-full ${
                  drift < 0.5
                    ? "bg-emerald-500"
                    : drift < 2
                    ? "bg-yellow-500"
                    : "bg-red-500"
                }`}
              />
              <span className="text-zinc-400 hidden sm:inline-block">
                {drift < 0.5 ? "Synced" : drift < 2 ? "Syncing..." : "Out of sync"}
              </span>
            </div>
            {playback?.updatedBy && (
              <span className="text-xs text-zinc-500 hidden md:inline-block">
                {playback.status === "playing" ? "Played" : "Paused"} by{" "}
                {playback.updatedBy}
              </span>
            )}
            <button
              onClick={() => {
                const playerContainer = document.querySelector(
                  ".react-player-wrapper",
                );
                if (playerContainer && !document.fullscreenElement) {
                  playerContainer.requestFullscreen();
                } else if (document.exitFullscreen) {
                  document.exitFullscreen();
                }
              }}
              className="text-zinc-300 hover:text-white transition-colors"
            >
              <Maximize className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
