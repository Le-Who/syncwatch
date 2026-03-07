import { useEffect } from "react";

interface UsePlayerShortcutsProps {
  canControl: boolean;
  playing: boolean;
  muted: boolean;
  handlePlay: () => void;
  handlePause: () => void;
  setMuted: (muted: boolean) => void;
}

export function usePlayerShortcuts({
  canControl,
  playing,
  muted,
  handlePlay,
  handlePause,
  setMuted,
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
  }, [playing, canControl, handlePlay, handlePause, muted, setMuted]);
}
