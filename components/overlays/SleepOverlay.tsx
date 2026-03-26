"use client";

import { MonitorPlay } from "lucide-react";

interface SleepOverlayProps {
  onWakeUp: () => void;
}

export function SleepOverlay({ onWakeUp }: SleepOverlayProps) {
  return (
    <div
      className="absolute inset-0 z-50 flex cursor-pointer flex-col items-center justify-center bg-black/90 backdrop-blur-md"
      onClick={onWakeUp}
    >
      <MonitorPlay className="text-theme-muted mb-6 h-16 w-16 opacity-50" />
      <h2 className="text-theme-text mb-2 text-2xl font-bold tracking-widest uppercase">
        Sleep Mode
      </h2>
      <p className="text-theme-muted text-sm tracking-wider uppercase">
        Connection paused to save resources.
      </p>
      <p className="text-theme-accent mt-6 animate-pulse text-xs font-bold tracking-widest uppercase">
        Click anywhere to awake
      </p>
    </div>
  );
}
