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
    const update = () =>
      setCurrentPos(
        computePosition(basePosition, baseTimestamp, rate, isPlaying),
      );

    const immediate = setTimeout(update, 0);

    if (!isPlaying) {
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
