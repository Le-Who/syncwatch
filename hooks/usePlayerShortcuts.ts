import { useEffect } from "react";

interface UsePlayerShortcutsProps {
  canControl: boolean;
  playing: boolean;
  muted: boolean;
  handlePlay: () => void;
  handlePause: () => void;
  setMuted: (muted: boolean) => void;
  // C1: New props for extended shortcuts
  handleSeek?: (delta: number) => void;
  setVolume?: (volume: number) => void;
  getVolume?: () => number;
  toggleFullscreen?: () => void;
  toggleTheaterMode?: () => void;
}

export function usePlayerShortcuts({
  canControl,
  playing,
  muted,
  handlePlay,
  handlePause,
  setMuted,
  handleSeek,
  setVolume,
  getVolume,
  toggleFullscreen,
  toggleTheaterMode,
}: UsePlayerShortcutsProps) {
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

      switch (e.code) {
        case "Space":
          e.preventDefault();
          if (canControl) {
            playing ? handlePause() : handlePlay();
          }
          break;

        case "KeyM":
          e.preventDefault();
          setMuted(!muted);
          break;

        case "ArrowLeft":
          e.preventDefault();
          if (canControl && handleSeek) {
            // Shift+Arrow = ±10s, Arrow = ±5s
            handleSeek(e.shiftKey ? -10 : -5);
          }
          break;

        case "ArrowRight":
          e.preventDefault();
          if (canControl && handleSeek) {
            handleSeek(e.shiftKey ? 10 : 5);
          }
          break;

        case "ArrowUp":
          e.preventDefault();
          if (setVolume && getVolume) {
            const newVol = Math.min(1, getVolume() + 0.05);
            setVolume(newVol);
            if (muted && newVol > 0) setMuted(false);
          }
          break;

        case "ArrowDown":
          e.preventDefault();
          if (setVolume && getVolume) {
            setVolume(Math.max(0, getVolume() - 0.05));
          }
          break;

        case "KeyF":
          e.preventDefault();
          toggleFullscreen?.();
          break;

        case "KeyT":
          e.preventDefault();
          toggleTheaterMode?.();
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    playing,
    canControl,
    handlePlay,
    handlePause,
    muted,
    setMuted,
    handleSeek,
    setVolume,
    getVolume,
    toggleFullscreen,
    toggleTheaterMode,
  ]);
}
