import { X } from "lucide-react";

interface UpNextOverlayProps {
  timeRemaining: number;
  nextItem: { title?: string } | null;
  onSkip: () => void;
  onDismiss: () => void;
}

export function UpNextOverlay({
  timeRemaining,
  nextItem,
  onSkip,
  onDismiss,
}: UpNextOverlayProps) {
  return (
    <div className="bg-theme-bg/95 border-theme-border/50 rounded-theme animate-in fade-in slide-in-from-right-8 pointer-events-auto absolute right-4 bottom-24 z-40 flex items-center space-x-4 border p-4 shadow-[0_10px_40px_rgba(0,0,0,0.5)] backdrop-blur-md">
      {/* Dismiss button */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onDismiss();
        }}
        className="text-theme-muted hover:text-theme-text absolute top-1.5 right-1.5 rounded-full p-1 transition-colors"
        title="Dismiss"
      >
        <X className="h-3.5 w-3.5" />
      </button>

      <div className="relative flex h-12 w-12 items-center justify-center">
        <svg className="h-full w-full -rotate-90 transform">
          <circle
            cx="24"
            cy="24"
            r="20"
            stroke="currentColor"
            strokeWidth="3"
            fill="transparent"
            className="text-theme-border/30"
          />
          <circle
            cx="24"
            cy="24"
            r="20"
            stroke="currentColor"
            strokeWidth="3"
            fill="transparent"
            className="text-theme-accent transition-all duration-1000 ease-linear"
            strokeDasharray="125"
            strokeDashoffset={125 - (125 * (5 - timeRemaining)) / 5}
          />
        </svg>
        <span className="text-theme-text absolute text-sm font-bold">
          {Math.ceil(timeRemaining)}
        </span>
      </div>
      <div className="flex max-w-[200px] flex-col truncate pr-4">
        <span className="text-theme-muted text-[10px] font-bold tracking-widest uppercase">
          Up Next
        </span>
        <span className="text-theme-text truncate text-sm font-bold">
          {nextItem?.title}
        </span>
      </div>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onSkip();
        }}
        className="text-theme-bg bg-theme-accent rounded-theme px-3 py-1.5 text-xs font-bold tracking-widest uppercase transition-all hover:brightness-110 hover:filter"
      >
        Skip
      </button>
    </div>
  );
}
