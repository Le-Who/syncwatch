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
        className="bg-theme-bg/80 border-theme-accent text-theme-accent ring-theme-accent pointer-events-auto flex h-24 w-24 cursor-pointer items-center justify-center rounded-full border-4 shadow-[0_0_30px_var(--color-theme-accent)] backdrop-blur-md transition-transform outline-none hover:scale-110 focus-visible:ring-2 active:scale-95"
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
