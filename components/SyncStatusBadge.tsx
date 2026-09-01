"use client";

import { useEffect, useState } from "react";
import { useStore } from "@/lib/store";
import type { PlaybackHealth } from "@/lib/types";
import { BADGE_SYNCED } from "@/lib/sync-config";

interface SyncStatusBadgeProps {
  driftRef: React.MutableRefObject<number>;
  playbackHealth: PlaybackHealth;
  reconnecting?: boolean;
}

type SyncPresentation =
  | "synced"
  | "catching-up"
  | "local-buffering"
  | "reconnecting";

function presentationFor(
  isConnected: boolean,
  health: PlaybackHealth,
  drift: number,
): SyncPresentation {
  if (!isConnected) return "reconnecting";
  if (health === "buffering") return "local-buffering";
  if (Math.abs(drift) >= BADGE_SYNCED) return "catching-up";
  return "synced";
}

export function SyncStatusBadge({
  driftRef,
  playbackHealth,
  reconnecting = false,
}: SyncStatusBadgeProps) {
  const isConnected = useStore((state) => state.isConnected);
  const playbackStatus = useStore((state) => state.room?.playback?.status);
  const [displayDrift, setDisplayDrift] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setDisplayDrift(Math.abs(driftRef.current));
    }, 500);
    return () => clearInterval(interval);
  }, [driftRef]);

  const presentation = presentationFor(
    isConnected && !reconnecting,
    playbackHealth,
    displayDrift,
  );
  if (
    playbackStatus !== "playing" &&
    presentation !== "local-buffering" &&
    presentation !== "reconnecting"
  ) {
    return null;
  }

  const config = {
    synced: {
      label: "Synced",
      detail: "",
      dot: "bg-emerald-400 shadow-[0_0_8px_rgb(52,211,153)]",
      text: "text-emerald-400",
    },
    "catching-up": {
      label: "Catching up",
      detail:
        displayDrift < 1
          ? `${Math.round(displayDrift * 1_000)}ms`
          : `${displayDrift.toFixed(1)}s`,
      dot: "bg-amber-400 shadow-[0_0_6px_rgb(251,191,36)]",
      text: "text-amber-400",
    },
    "local-buffering": {
      label: "Local buffering",
      detail: "Friends continue",
      dot: "animate-pulse bg-amber-400 shadow-[0_0_6px_rgb(251,191,36)]",
      text: "text-amber-400",
    },
    reconnecting: {
      label: "Reconnecting",
      detail: "",
      dot: "animate-pulse bg-red-500 shadow-[0_0_8px_rgb(239,68,68)]",
      text: "text-red-400",
    },
  }[presentation];

  return (
    <div
      className="pointer-events-none absolute top-3 right-3 z-30 flex items-center space-x-2 rounded-full border border-white/10 bg-black/60 px-3 py-1.5 text-[10px] font-bold tracking-wider uppercase shadow-lg backdrop-blur-md"
      role="status"
      aria-label={config.label}
      aria-live="polite"
    >
      <div className={`h-2 w-2 rounded-full ${config.dot}`} />
      <span className={config.text}>{config.label}</span>
      {config.detail && (
        <span className="text-white/65 normal-case">{config.detail}</span>
      )}
    </div>
  );
}
