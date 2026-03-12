"use client";

import { useEffect, useState, useRef } from "react";
import { useStore } from "@/lib/store";

interface SyncStatusBadgeProps {
  driftRef: React.MutableRefObject<number>;
}

type SyncState = "synced" | "syncing" | "drift" | "lost" | "offline";

/**
 * Universal sync drift indicator with smooth state transitions.
 * Three-state coloring: green (In Sync), amber (Syncing), red (Drift/Lost).
 * Shows a brief "In Sync ✓" pulse when drift drops below 100ms, then auto-hides.
 */
export function SyncStatusBadge({ driftRef }: SyncStatusBadgeProps) {
  const isConnected = useStore((s) => s.isConnected);
  const playbackStatus = useStore((s) => s.room?.playback?.status);
  const [displayDrift, setDisplayDrift] = useState(0);
  const [syncState, setSyncState] = useState<SyncState>("synced");
  const [showSyncedPulse, setShowSyncedPulse] = useState(false);
  const syncedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stableSyncCountRef = useRef(0);
  const prevStateRef = useRef<SyncState>("synced");

  useEffect(() => {
    const interval = setInterval(() => {
      const absDrift = Math.abs(driftRef.current);
      setDisplayDrift(absDrift);

      let newState: SyncState;
      if (!isConnected) {
        newState = "offline";
      } else if (absDrift < 0.1) {
        newState = "synced";
      } else if (absDrift < 0.3) {
        newState = "synced"; // Small enough to be considered synced
      } else if (absDrift < 1.0) {
        newState = "syncing";
      } else if (absDrift < 3.0) {
        newState = "drift";
      } else {
        newState = "lost";
      }

      // Track how long we've been in "synced" state for the pulse
      if (newState === "synced") {
        stableSyncCountRef.current++;
      } else {
        stableSyncCountRef.current = 0;
      }

      // B2: Show "In Sync" pulse when transitioning from non-synced to synced
      // after being stable for 4 ticks (~2 seconds at 500ms interval)
      if (
        newState === "synced" &&
        prevStateRef.current !== "synced" &&
        stableSyncCountRef.current >= 1
      ) {
        setShowSyncedPulse(true);
        if (syncedTimerRef.current) clearTimeout(syncedTimerRef.current);
        syncedTimerRef.current = setTimeout(() => {
          setShowSyncedPulse(false);
        }, 3000);
      }

      prevStateRef.current = newState;
      setSyncState(newState);
    }, 500);

    return () => {
      clearInterval(interval);
      if (syncedTimerRef.current) clearTimeout(syncedTimerRef.current);
    };
  }, [driftRef, isConnected]);

  // Don't show during pause — drift is meaningless when paused
  if (playbackStatus !== "playing") return null;

  // Show badge when: disconnected, drifting, syncing, or showing the synced pulse
  if (syncState === "synced" && !showSyncedPulse) return null;

  const config: Record<
    SyncState,
    {
      label: string;
      text: string;
      dot: string;
      textColor: string;
    }
  > = {
    synced: {
      label: "In Sync ✓",
      text: "",
      dot: "bg-emerald-400 shadow-[0_0_8px_rgb(52,211,153)]",
      textColor: "text-emerald-400",
    },
    syncing: {
      label: "Syncing",
      text:
        displayDrift < 1
          ? `${(displayDrift * 1000).toFixed(0)}ms`
          : `${displayDrift.toFixed(1)}s`,
      dot: "bg-amber-400 shadow-[0_0_6px_rgb(251,191,36)]",
      textColor: "text-amber-400",
    },
    drift: {
      label: "Drift",
      text: `${displayDrift.toFixed(1)}s`,
      dot: "bg-orange-500 shadow-[0_0_8px_rgb(249,115,22)]",
      textColor: "text-orange-400",
    },
    lost: {
      label: "Sync Lost",
      text: `${displayDrift.toFixed(1)}s`,
      dot: "bg-red-500 shadow-[0_0_8px_rgb(239,68,68)]",
      textColor: "text-red-400",
    },
    offline: {
      label: "Reconnecting...",
      text: "",
      dot: "bg-red-500 animate-pulse shadow-[0_0_8px_rgb(239,68,68)]",
      textColor: "text-red-400",
    },
  };

  const { label, text, dot, textColor } = config[syncState];

  return (
    <div
      className={`pointer-events-none absolute top-3 right-3 z-30 flex items-center space-x-2 rounded-full border border-white/10 bg-black/60 px-3 py-1.5 text-[10px] font-bold tracking-wider uppercase shadow-lg backdrop-blur-md transition-all duration-500 ${
        showSyncedPulse && syncState === "synced"
          ? "animate-in fade-in scale-in-95"
          : ""
      }`}
    >
      <div
        className={`h-2 w-2 rounded-full transition-all duration-500 ${dot}`}
      />
      <span className={`transition-colors duration-300 ${textColor}`}>
        {label}
        {text ? `: ${text}` : ""}
      </span>
    </div>
  );
}
