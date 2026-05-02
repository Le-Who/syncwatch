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
