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
        aria-label="Initialize stream synchronization"
        className="bg-theme-accent text-theme-bg ring-theme-accent flex items-center gap-3 rounded-full px-8 py-4 font-bold tracking-widest uppercase shadow-[0_0_40px_var(--color-theme-accent)] transition-all outline-none hover:scale-105 focus-visible:ring-4 focus-visible:ring-offset-2 focus-visible:ring-offset-black active:scale-95"
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
