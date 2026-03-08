import React, { useEffect, useRef, useState } from "react";
import { useStore } from "@/lib/store";
import { formatTime } from "@/lib/utils";

interface ScrubberProps {
  playerRef: React.RefObject<any>;
  duration: number;
  canControl: boolean;
  onSeekStart: () => void;
  onSeekEnd: (percent: number) => void;
}

export function Scrubber({
  playerRef,
  duration,
  canControl,
  onSeekStart,
  onSeekEnd,
}: ScrubberProps) {
  const progressBarRef = useRef<HTMLDivElement>(null);
  const timeDisplayRef = useRef<HTMLSpanElement>(null);
  const hoverBadgeRef = useRef<HTMLDivElement>(null);

  const [isScrubbing, setIsScrubbing] = useState(false);

  // Exclusively track UI scrubbing position locally to prevent jumping during drag
  const scrubPercentRef = useRef<number>(0);

  useEffect(() => {
    let animationFrameId: number;
    let isMounted = true;

    // The core render loop for the high-frequency scrubber, detached from React state
    const updateProgress = () => {
      if (!isMounted) return;

      if (
        !isScrubbing &&
        playerRef.current &&
        progressBarRef.current &&
        timeDisplayRef.current
      ) {
        // Read directly from the HTML5 media element or ReactPlayer instance
        const currentTime = playerRef.current.getCurrentTime
          ? playerRef.current.getCurrentTime()
          : playerRef.current.currentTime || 0;

        let percent = 0;
        if (duration > 0) {
          percent = Math.min(100, Math.max(0, (currentTime / duration) * 100));
        }

        requestAnimationFrame(() => {
          if (progressBarRef.current) {
            progressBarRef.current.style.width = `${percent}%`;
          }
          if (timeDisplayRef.current) {
            timeDisplayRef.current.innerText = formatTime(
              Math.round(currentTime),
            );
          }
        });
      }

      animationFrameId = requestAnimationFrame(updateProgress);
    };

    updateProgress();

    return () => {
      isMounted = false;
      cancelAnimationFrame(animationFrameId);
    };
  }, [playerRef, duration, isScrubbing]);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!canControl || duration === 0) return;
    setIsScrubbing(true);
    onSeekStart();
    updateScrubPosition(e.clientX);

    document.addEventListener("pointermove", handlePointerMove);
    document.addEventListener("pointerup", handlePointerUp);
  };

  const handlePointerMove = (e: PointerEvent) => {
    updateScrubPosition(e.clientX);
  };

  const handlePointerUp = (e: PointerEvent) => {
    document.removeEventListener("pointermove", handlePointerMove);
    document.removeEventListener("pointerup", handlePointerUp);
    setIsScrubbing(false);
    onSeekEnd(scrubPercentRef.current);
  };

  const updateScrubPosition = (clientX: number) => {
    const rect = document
      .getElementById("progress-bar-container")
      ?.getBoundingClientRect();
    if (!rect) return;

    let percent = (clientX - rect.left) / rect.width;
    percent = Math.max(0, Math.min(1, percent));
    scrubPercentRef.current = percent;

    requestAnimationFrame(() => {
      if (progressBarRef.current) {
        progressBarRef.current.style.width = `${percent * 100}%`;
      }
      if (timeDisplayRef.current) {
        timeDisplayRef.current.innerText = formatTime(
          Math.round(percent * duration),
        );
      }
    });
  };

  const handlePointerMoveHover = (e: React.PointerEvent<HTMLDivElement>) => {
    if (duration === 0 || isScrubbing) {
      if (hoverBadgeRef.current) hoverBadgeRef.current.style.opacity = "0";
      return;
    }

    const rect = e.currentTarget.getBoundingClientRect();
    let percent = (e.clientX - rect.left) / rect.width;
    percent = Math.max(0, Math.min(1, percent));

    if (hoverBadgeRef.current) {
      hoverBadgeRef.current.style.opacity = "1";
      hoverBadgeRef.current.style.left = `${percent * 100}%`;
      hoverBadgeRef.current.innerText = formatTime(
        Math.round(percent * duration),
      );
    }
  };

  const handlePointerLeaveHover = () => {
    if (hoverBadgeRef.current && !isScrubbing) {
      hoverBadgeRef.current.style.opacity = "0";
    }
  };

  return (
    <div className="group/scrubber flex w-full items-center gap-4 select-none">
      <span
        ref={timeDisplayRef}
        className="text-theme-accent w-14 text-right text-xs font-bold"
      >
        0:00
      </span>

      <div
        id="progress-bar-container"
        className="group relative flex flex-1 cursor-pointer items-center"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMoveHover}
        onPointerLeave={handlePointerLeaveHover}
      >
        {/* Track */}
        <div className="bg-theme-bg/80 border-theme-border/50 group/timeline relative h-4 w-full cursor-pointer overflow-hidden rounded-full border shadow-inner transition-all hover:h-5">
          {/* Progress fill */}
          <div
            ref={progressBarRef}
            className="from-theme-accent/80 to-theme-accent absolute top-0 left-0 h-full rounded-r-full bg-linear-to-r shadow-[0_0_12px_var(--color-theme-accent)] transition-transform duration-75"
            style={{ width: "0%" }}
          />
        </div>

        {/* Hover Time Badge */}
        <div
          ref={hoverBadgeRef}
          className="rounded-theme border-theme-accent/40 bg-theme-bg/95 text-theme-accent pointer-events-none absolute -top-10 z-10 -translate-x-1/2 border px-3 py-1.5 text-xs font-bold whitespace-nowrap opacity-0 shadow-[0_0_15px_rgba(0,0,0,0.8)] backdrop-blur-md transition-opacity"
        />
      </div>

      <span className="text-theme-accent w-14 text-left text-xs font-bold">
        {formatTime(Math.round(duration))}
      </span>
    </div>
  );
}
