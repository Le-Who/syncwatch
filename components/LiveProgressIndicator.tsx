"use client";

import { useLiveProgress } from "./LivePosition";
import React from "react";

export const LiveProgressIndicator = React.memo(function LiveProgressIndicator({
  isActive,
  basePosition,
  baseTimestamp,
  rate,
  isPlaying,
  duration,
  lastPosition,
}: {
  isActive: boolean;
  basePosition: number;
  baseTimestamp: number;
  rate: number;
  isPlaying: boolean;
  duration: number;
  lastPosition?: number;
}) {
  let progress = 0;

  // We only call the hook if the item is active to save interval overhead for inactive items.
  // Actually, hooks must be called unconditionally. We'll pass a dummy or use a wrapper.

  if (isActive) {
    return (
      <ActiveIndicator
        basePosition={basePosition}
        baseTimestamp={baseTimestamp}
        rate={rate}
        isPlaying={isPlaying}
        duration={duration}
      />
    );
  }

  if (lastPosition && duration) {
    progress = Math.min((lastPosition / duration) * 100, 100);
  }

  if (progress <= 0) return null;

  return (
    <div className="bg-theme-border/30 rounded-b-theme absolute right-0 bottom-0 left-0 h-[3px] overflow-hidden">
      <div
        className="bg-theme-muted/50 h-full transition-all duration-1000"
        style={{ width: `${progress}%` }}
      />
    </div>
  );
});

function ActiveIndicator({
  basePosition,
  baseTimestamp,
  rate,
  isPlaying,
  duration,
}: {
  basePosition: number;
  baseTimestamp: number;
  rate: number;
  isPlaying: boolean;
  duration: number;
}) {
  const liveProgress = useLiveProgress({
    basePosition,
    baseTimestamp,
    rate,
    isPlaying,
    duration,
  });

  if (liveProgress <= 0) return null;

  return (
    <div className="bg-theme-border/30 rounded-b-theme absolute right-0 bottom-0 left-0 h-[3px] overflow-hidden">
      <div
        className="bg-theme-accent h-full shadow-[0_0_8px_var(--color-theme-accent)] transition-all duration-1000"
        style={{ width: `${liveProgress}%` }}
      />
    </div>
  );
}
