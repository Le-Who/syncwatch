"use client";

import { useStore } from "@/lib/store";
import { PlaybackState, Participant } from "@/lib/types";

interface BufferingOverlayProps {
  playback: PlaybackState | undefined;
  isLocalBuffering: boolean;
}

/**
 * Shows a buffering spinner when either this client or another participant is buffering.
 * Resolves the buffering participant's nickname reactively via Zustand selector (P8 fix).
 */
export function BufferingOverlay({
  playback,
  isLocalBuffering,
}: BufferingOverlayProps) {
  // P8 Fix: Use a proper Zustand selector instead of getState() in render
  const bufferingNickname = useStore((s) => {
    if (
      playback?.status === "buffering" &&
      !isLocalBuffering &&
      playback.updatedBy
    ) {
      // updatedBy is a nickname string, not a participant ID — display directly
      return playback.updatedBy;
    }
    return null;
  });

  const label = bufferingNickname
    ? `Waiting for ${bufferingNickname}...`
    : "Buffering...";

  return (
    <div className="bg-theme-bg/80 absolute inset-0 z-20 flex flex-col items-center justify-center backdrop-blur-sm">
      <div className="border-theme-accent border-b-theme-danger mb-6 h-16 w-16 animate-spin rounded-full border-4 border-t-transparent" />
      <div className="bg-theme-accent text-theme-bg shadow-theme rounded-full px-4 py-1 text-xs font-bold tracking-[0.2em] uppercase">
        {label}
      </div>
    </div>
  );
}
