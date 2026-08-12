"use client";

import { useStore } from "@/lib/store";
import {
  Pause,
  Play,
  SkipForward,
  Undo2,
  Volume2,
  VolumeX,
  MonitorPlay,
  Maximize,
} from "lucide-react";
import { Scrubber } from "@/components/Scrubber";
import { QualityMenu } from "@/components/QualityMenu";
import { PlayerMethods, PlaybackState } from "@/lib/types";
import { useSettingsStore } from "@/lib/store";
import fscreen from "fscreen";

interface PlayerControlBarProps {
  playerRef: React.RefObject<PlayerMethods | null>;
  containerRef: React.RefObject<HTMLDivElement | null>;
  duration: number;
  playing: boolean;
  canControl: boolean;
  currentMedia: { provider?: string; title?: string } | null;
  playback: PlaybackState | undefined;
  currentMediaId: string | null;
  flashbacks: Array<{ mediaId: string }>;
  popFlashback: (mediaId: string) => number | null;
  onPlay: () => void;
  onPause: () => void;
  onNext: () => void;
  onSeekStart: () => void;
  onSeekEnd: (percent: number) => void;
}

export function PlayerControlBar({
  playerRef,
  containerRef,
  duration,
  playing,
  canControl,
  currentMedia,
  playback,
  currentMediaId,
  flashbacks,
  popFlashback,
  onPlay,
  onPause,
  onNext,
  onSeekStart,
  onSeekEnd,
}: PlayerControlBarProps) {
  const emitCommand = useStore((s) => s.sendCommand);
  const { volume, muted, theaterMode, setVolume, setMuted, toggleTheaterMode } =
    useSettingsStore();

  return (
    <div className="font-theme absolute right-0 bottom-0 left-0 z-50 p-4 opacity-0 transition-opacity duration-300 group-hover:opacity-100 focus-within:opacity-100">
      <div className="bg-theme-bg/80 border-theme-border/50 rounded-theme border-2 p-3 shadow-lg backdrop-blur-md">
        {/* Timeline */}
        <div className="mb-3 flex items-center space-x-4">
          <Scrubber
            playerRef={playerRef}
            duration={duration}
            canControl={canControl}
            onSeekStart={onSeekStart}
            onSeekEnd={onSeekEnd}
          />
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-6">
            {/* Play/Pause */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                playing ? onPause() : onPlay();
              }}
              disabled={!canControl}
              aria-label={playing ? "Pause" : "Play"}
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
                onNext();
              }}
              disabled={!canControl}
              aria-label="Next media"
              className={`ring-theme-accent rounded-full transition-all outline-none hover:scale-110 focus-visible:ring-2 ${canControl ? "text-theme-accent hover:text-theme-danger" : "text-theme-muted cursor-not-allowed"}`}
            >
              <SkipForward className="h-5 w-5 fill-current" />
            </button>

            {/* Undo Seek (Flashback) */}
            {canControl &&
              flashbacks.some((f) => f.mediaId === currentMediaId) && (
                <button
                  title="Undo accidental seek"
                  aria-label="Undo accidental seek"
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
              <button
                aria-label="Playback speed"
                className="text-theme-accent hover:text-theme-danger ring-theme-accent border-theme-accent/30 rounded-sm border px-1.5 py-1 text-[10px] font-bold tracking-widest uppercase transition-colors outline-none focus-visible:ring-2"
              >
                {playback?.rate || 1}x
              </button>
              <div className="absolute bottom-full left-1/2 z-50 hidden -translate-x-1/2 flex-col pb-2 group-focus-within/speed:flex group-hover/speed:flex">
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
                aria-label={muted || volume === 0 ? "Unmute" : "Mute"}
                className="text-theme-accent hover:text-theme-danger ring-theme-accent rounded-full transition-colors outline-none focus-visible:ring-2"
              >
                {muted || volume === 0 ? (
                  <VolumeX className="h-5 w-5" />
                ) : (
                  <Volume2 className="h-5 w-5" />
                )}
              </button>
              <div className="bg-theme-bg border-theme-border/30 rounded-theme relative h-2 w-0 overflow-hidden border transition-all duration-300 group-focus-within/volume:w-24 group-hover/volume:w-24">
                <div
                  className="bg-theme-accent rounded-theme absolute top-0 left-0 h-full"
                  style={{ width: `${(muted ? 0 : volume) * 100}%` }}
                />
                <input
                  type="range"
                  min={0}
                  max={1}
                  step="any"
                  aria-label="Volume slider"
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
              {currentMedia?.provider}
            </div>

            <div className="text-theme-text ml-2 max-w-[150px] truncate text-xs font-bold tracking-wide uppercase drop-shadow-sm lg:max-w-xs xl:max-w-md">
              {currentMedia?.title}
            </div>
          </div>

          <div className="flex items-center space-x-4">
            {/* Quality Settings */}
            <QualityMenu
              currentMedia={currentMedia}
              playerRef={playerRef}
              playback={playback}
            />

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
              aria-label={
                theaterMode ? "Exit theater mode" : "Enter theater mode"
              }
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
              aria-label="Toggle fullscreen"
              className="text-theme-accent hover:text-theme-danger ring-theme-accent rounded-full p-2 transition-colors outline-none hover:scale-110 focus-visible:ring-2"
            >
              <Maximize className="h-5 w-5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
