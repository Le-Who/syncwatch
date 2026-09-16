"use client";

import { Play } from "lucide-react";

interface PausedOverlayProps {
  canControl: boolean;
  onPlay: () => void;
}

export function PausedOverlay({ canControl, onPlay }: PausedOverlayProps) {
  return (
    <div className="pointer-events-none absolute inset-0 z-20 flex flex-col items-center justify-center bg-black/40 backdrop-blur-[2px] transition-opacity duration-300">
      <button
        aria-label="Play"
        disabled={!canControl}
        className={`pointer-events-auto flex h-24 w-24 items-center justify-center rounded-full border-4 backdrop-blur-md transition-transform outline-none focus-visible:ring-4 focus-visible:ring-theme-accent ${
          canControl
            ? "bg-theme-bg/80 border-theme-accent text-theme-accent cursor-pointer shadow-[0_0_30px_var(--color-theme-accent)] hover:scale-110 active:scale-95"
            : "border-theme-border text-theme-muted bg-theme-bg/50 cursor-not-allowed opacity-70"
        }`}
        onClick={(e) => {
          e.stopPropagation();
          if (canControl) onPlay();
        }}
      >
        <Play className="ml-2 h-12 w-12" />
      </button>
    </div>
  );
}
