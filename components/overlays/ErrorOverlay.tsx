"use client";

import { AlertCircle } from "lucide-react";

interface ErrorOverlayProps {
  message: string;
}

export function ErrorOverlay({ message }: ErrorOverlayProps) {
  return (
    <div className="bg-theme-bg/95 border-theme-danger absolute inset-0 z-20 flex flex-col items-center justify-center border-4 shadow-[inset_0_0_50px_var(--color-theme-danger)] backdrop-blur-sm">
      <AlertCircle className="text-theme-danger mb-4 h-16 w-16 animate-pulse" />
      <div className="bg-theme-danger text-theme-bg mb-2 rounded-full px-4 py-1 text-sm font-bold tracking-[0.2em] uppercase">
        Critical Error
      </div>
      <p className="text-theme-danger font-theme max-w-md text-center text-lg tracking-wider uppercase">
        {message}
      </p>
    </div>
  );
}
