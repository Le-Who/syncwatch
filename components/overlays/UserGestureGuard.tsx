"use client";

import { MonitorPlay } from "lucide-react";

interface UserGestureGuardProps {
  onActivate: () => void;
}

/**
 * Overlay requiring user gesture to enable autoplay (browser policy).
 * Must be clicked before the player can begin playback.
 */
export function UserGestureGuard({ onActivate }: UserGestureGuardProps) {
  return (
    <div className="pointer-events-auto absolute inset-0 z-40 flex flex-col items-center justify-center bg-black/80 backdrop-blur-md">
      <button
        onClick={(e) => {
          e.stopPropagation();
          onActivate();
        }}
        className="bg-theme-accent text-theme-bg flex items-center gap-3 rounded-full px-8 py-4 font-bold tracking-widest uppercase shadow-[0_0_40px_var(--color-theme-accent)] transition-all hover:scale-105 active:scale-95"
      >
        <MonitorPlay className="h-6 w-6" />
        Initialize Stream Sync
      </button>
      <p className="text-theme-muted mt-6 text-xs tracking-widest uppercase">
        Browser policy requires manual activation
      </p>
    </div>
  );
}
