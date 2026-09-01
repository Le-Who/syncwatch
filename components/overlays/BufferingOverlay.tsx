"use client";

/** Describes a provider stall on this browser only. Room playback continues. */
export function BufferingOverlay() {
  return (
    <div
      className="bg-theme-bg/80 absolute inset-0 z-20 flex flex-col items-center justify-center px-6 text-center backdrop-blur-sm"
      role="status"
      aria-live="polite"
      aria-label="Your video is buffering. Friends are still watching. You will catch up automatically."
    >
      <div className="border-theme-accent border-b-theme-danger mb-6 h-16 w-16 animate-spin rounded-full border-4 border-t-transparent" />
      <div className="bg-theme-accent text-theme-bg shadow-theme rounded-full px-4 py-1 text-xs font-bold tracking-[0.2em] uppercase">
        Your video is buffering
      </div>
      <p className="mt-3 max-w-sm text-sm text-white/80">
        Friends are still watching. You&apos;ll catch up automatically.
      </p>
    </div>
  );
}
