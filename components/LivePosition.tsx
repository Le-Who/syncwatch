"use client";

import { useState, useEffect } from "react";
import { formatTime } from "@/lib/utils";

interface LivePositionProps {
  basePosition: number;
  baseTimestamp: number;
  rate: number;
  isPlaying: boolean;
  duration: number;
}

function computePosition(
  basePosition: number,
  baseTimestamp: number,
  rate: number,
  isPlaying: boolean,
): number {
  if (!isPlaying) return basePosition;
  const elapsed = (Date.now() - baseTimestamp) / 1000;
  return basePosition + elapsed * rate;
}

/**
 * P10: Ticks the displayed position forward every second during playback.
 *
 * Architecture: Both initial state and interval updates call computePosition
 * inside callbacks (useState initializer + setInterval callback), never
 * during render, satisfying react-hooks/purity and set-state-in-effect rules.
 */
export function LivePosition({
  basePosition,
  baseTimestamp,
  rate,
  isPlaying,
  duration,
}: LivePositionProps) {
  const [currentPos, setCurrentPos] = useState(() =>
    computePosition(basePosition, baseTimestamp, rate, isPlaying),
  );

  useEffect(() => {
    // Immediate sync in an interval callback (not synchronous effect body)
    const update = () =>
      setCurrentPos(
        computePosition(basePosition, baseTimestamp, rate, isPlaying),
      );

    // Sync to latest props immediately via a 0ms timeout
    const immediate = setTimeout(update, 0);

    if (!isPlaying) {
      // When paused, just do the single update
      return () => clearTimeout(immediate);
    }

    const interval = setInterval(update, 1000);

    return () => {
      clearTimeout(immediate);
      clearInterval(interval);
    };
  }, [isPlaying, basePosition, baseTimestamp, rate]);

  const displayPos = Math.min(currentPos, duration);

  return (
    <span className="text-theme-accent/80">
      {formatTime(displayPos)} / {formatTime(duration)}
    </span>
  );
}

/**
 * Live progress percentage for the active playlist item.
 * Same architecture as LivePosition — all Date.now() calls happen
 * inside callbacks, never during render.
 */
export function useLiveProgress({
  basePosition,
  baseTimestamp,
  rate,
  isPlaying,
  duration,
}: LivePositionProps): number {
  const [progress, setProgress] = useState(() => {
    const pos = computePosition(basePosition, baseTimestamp, rate, isPlaying);
    return duration ? Math.min((pos / duration) * 100, 100) : 0;
  });

  useEffect(() => {
    const update = () => {
      const pos = computePosition(basePosition, baseTimestamp, rate, isPlaying);
      setProgress(duration ? Math.min((pos / duration) * 100, 100) : 0);
    };

    const immediate = setTimeout(update, 0);

    if (!isPlaying) {
      return () => clearTimeout(immediate);
    }

    const interval = setInterval(update, 1000);

    return () => {
      clearTimeout(immediate);
      clearInterval(interval);
    };
  }, [isPlaying, basePosition, baseTimestamp, rate, duration]);

  return progress;
}

interface LiveProgressIndicatorProps {
  isActive: boolean;
  basePosition: number;
  baseTimestamp: number;
  rate: number;
  isPlaying: boolean;
  duration: number;
  lastPosition?: number;
}

/**
 * ⚡ Bolt Optimization: Extracted LiveProgressIndicator to prevent O(N) re-renders
 * of the 500-item playlist. This component isolates the interval-based progress
 * updates to just the active progress bar.
 */
export function LiveProgressIndicator({
  isActive,
  basePosition,
  baseTimestamp,
  rate,
  isPlaying,
  duration,
  lastPosition,
}: LiveProgressIndicatorProps) {
  // We only run the active progress hook if this item is actually active
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

  const progress =
    lastPosition && duration
      ? Math.min((lastPosition / duration) * 100, 100)
      : 0;

  if (progress <= 0) return null;

  return (
    <div className="bg-theme-border/30 rounded-b-theme absolute right-0 bottom-0 left-0 h-[3px] overflow-hidden">
      <div
        className="bg-theme-muted/50 h-full transition-all duration-1000"
        style={{ width: `${progress}%` }}
      />
    </div>
  );
}

function ActiveIndicator({
  basePosition,
  baseTimestamp,
  rate,
  isPlaying,
  duration,
}: LivePositionProps) {
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
