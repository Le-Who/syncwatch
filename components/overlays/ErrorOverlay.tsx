"use client";

import { AlertCircle, RefreshCw, RotateCcw, SkipForward } from "lucide-react";

interface ErrorOverlayProps {
  message: string;
  onRetry: () => void;
  onReinitializeSync: () => void;
  onSkip?: () => void;
}

export function ErrorOverlay({
  message,
  onRetry,
  onReinitializeSync,
  onSkip,
}: ErrorOverlayProps) {
  return (
    <div className="bg-theme-bg/95 border-theme-danger absolute inset-0 z-20 flex flex-col items-center justify-center border-4 p-6 text-center shadow-[inset_0_0_50px_var(--color-theme-danger)] backdrop-blur-sm">
      <AlertCircle
        className="text-theme-danger mb-4 h-16 w-16"
        aria-hidden="true"
      />
      <div className="bg-theme-danger text-theme-bg mb-2 rounded-full px-4 py-1 text-sm font-bold tracking-[0.2em] uppercase">
        Video unavailable
      </div>
      <p className="text-theme-danger font-theme max-w-md text-lg tracking-wide">
        {message}
      </p>
      <p className="text-theme-muted mt-2 max-w-md text-sm">
        This only affects your player. Try the video again or reinitialize your
        sync.
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <button
          type="button"
          onClick={onRetry}
          className="bg-theme-accent text-theme-bg rounded-theme focus-visible:ring-theme-text flex min-h-11 items-center gap-2 px-4 py-2 text-sm font-bold transition-colors hover:brightness-110 focus-visible:ring-2 focus-visible:outline-none"
        >
          <RotateCcw className="h-4 w-4" aria-hidden="true" />
          Retry video
        </button>
        <button
          type="button"
          onClick={onReinitializeSync}
          className="border-theme-border text-theme-text hover:border-theme-accent hover:text-theme-accent rounded-theme focus-visible:ring-theme-accent flex min-h-11 items-center gap-2 border-2 px-4 py-2 text-sm font-bold transition-colors focus-visible:ring-2 focus-visible:outline-none"
        >
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          Reinitialize sync
        </button>
        {onSkip && (
          <button
            type="button"
            onClick={onSkip}
            className="border-theme-danger text-theme-danger hover:bg-theme-danger hover:text-theme-bg rounded-theme focus-visible:ring-theme-danger flex min-h-11 items-center gap-2 border-2 px-4 py-2 text-sm font-bold transition-colors focus-visible:ring-2 focus-visible:outline-none"
          >
            <SkipForward className="h-4 w-4" aria-hidden="true" />
            Skip unavailable video
          </button>
        )}
      </div>
    </div>
  );
}
