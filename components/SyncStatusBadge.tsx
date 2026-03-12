"use client";

import { useEffect, useState } from "react";
import { useStore } from "@/lib/store";

interface SyncStatusBadgeProps {
  driftRef: React.MutableRefObject<number>;
}

/**
 * Universal sync drift indicator. Floats above ALL player types
 * (YouTube, Twitch, Vimeo, direct) — not limited to custom controls.
 * Shows actual drift time.
 */
export function SyncStatusBadge({ driftRef }: SyncStatusBadgeProps) {
  const isConnected = useStore((s) => s.isConnected);
  const playbackStatus = useStore((s) => s.room?.playback?.status);
  const [displayDrift, setDisplayDrift] = useState(0);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const interval = setInterval(() => {
      const absDrift = Math.abs(driftRef.current);
      setDisplayDrift(absDrift);
      // Show badge when drift exceeds 0.3s, disconnected, or paused
      setVisible(!isConnected || absDrift >= 0.3);
    }, 500);
    return () => clearInterval(interval);
  }, [driftRef, isConnected]);

  // Don't show during pause — drift is meaningless when paused
  if (playbackStatus !== "playing") return null;
  if (!visible) return null;

  const driftLabel = !isConnected
    ? "Offline"
    : displayDrift < 1
      ? `${(displayDrift * 1000).toFixed(0)}ms`
      : `${displayDrift.toFixed(1)}s`;

  const statusColor = !isConnected
    ? "text-red-400"
    : displayDrift < 1
      ? "text-amber-400"
      : "text-red-400";

  const dotColor = !isConnected
    ? "bg-red-500"
    : displayDrift < 1
      ? "bg-amber-400 shadow-[0_0_6px_rgb(251,191,36)]"
      : "bg-red-500 shadow-[0_0_8px_rgb(239,68,68)]";

  const statusText = !isConnected
    ? "Reconnecting..."
    : displayDrift < 1
      ? "Syncing"
      : displayDrift < 3
        ? "Drift"
        : "Sync Lost";

  return (
    <div className="animate-in fade-in pointer-events-none absolute top-3 right-3 z-30 flex items-center space-x-2 rounded-full border border-white/10 bg-black/60 px-3 py-1.5 text-[10px] font-bold tracking-wider uppercase shadow-lg backdrop-blur-md">
      <div className={`h-2 w-2 rounded-full ${dotColor}`} />
      <span className={statusColor}>
        {statusText}: {driftLabel}
      </span>
    </div>
  );
}
