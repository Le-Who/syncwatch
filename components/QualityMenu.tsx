"use client";

import { useRef, useState } from "react";
import { Settings } from "lucide-react";
import { PlayerMethods } from "@/lib/types";

interface QualityMenuProps {
  currentMedia: { provider?: string } | null;
  playerRef: React.RefObject<PlayerMethods | null>;
  playback: { rate?: number } | undefined;
}

interface HlsLevel {
  height: number;
}

export function QualityMenu({
  currentMedia,
  playerRef,
  playback,
}: QualityMenuProps) {
  const [qualityMenuOpen, setQualityMenuOpen] = useState(false);
  const [providerQualities, setProviderQualities] = useState<string[]>([]);
  const [currentProviderQuality, setCurrentProviderQuality] = useState("auto");
  const [hlsLevels, setHlsLevels] = useState<HlsLevel[]>([]);
  const [currentHlsLevel, setCurrentHlsLevel] = useState(-1);

  const provider = currentMedia?.provider?.toLowerCase();

  const handleOpenMenu = () => {
    const willOpen = !qualityMenuOpen;
    setQualityMenuOpen(willOpen);

    if (willOpen && currentMedia) {
      try {
        if (provider === "youtube") {
          const internal = playerRef.current?.getInternalPlayer?.("youtube");
          if (internal?.getAvailableQualityLevels) {
            const levels = internal.getAvailableQualityLevels();
            setProviderQualities(levels.filter((l: string) => l !== "auto"));
            setCurrentProviderQuality(internal.getPlaybackQuality() || "auto");
          }
        } else if (provider === "twitch") {
          const internal = playerRef.current?.getInternalPlayer?.("twitch");
          if (internal?.getQualities) {
            const levels = internal.getQualities();
            setProviderQualities(levels.map((l: any) => l.group));
            setCurrentProviderQuality(internal.getQuality() || "auto");
          }
        }
      } catch (err) {
        console.error("Provider bridge API error:", err);
      }
    }
  };

  const setProviderQuality = (quality: string) => {
    setCurrentProviderQuality(quality);
    setQualityMenuOpen(false);
    try {
      if (provider === "youtube") {
        if (quality === "auto") {
          playerRef.current
            ?.getInternalPlayer?.("youtube")
            ?.setPlaybackQualityRange?.("auto");
        } else {
          playerRef.current
            ?.getInternalPlayer?.("youtube")
            ?.setPlaybackQualityRange?.(quality, quality);
        }
      } else if (provider === "twitch") {
        playerRef.current?.getInternalPlayer?.("twitch")?.setQuality?.(quality);
      }
    } catch (err) {
      // Silently fail — quality API is best-effort
    }
  };

  const setHlsQuality = (levelIdx: number) => {
    setCurrentHlsLevel(levelIdx);
    try {
      const internal = playerRef.current;
      if (internal) (internal as any).currentLevel = levelIdx;
    } catch (err) {
      // Silently fail
    }
    setQualityMenuOpen(false);
  };

  return (
    <div className="group/quality relative flex items-center space-x-2">
      <button
        aria-label="Quality settings"
        aria-expanded={qualityMenuOpen}
        className={`text-theme-accent hover:text-theme-danger ring-theme-accent relative rounded-full p-2 transition-transform duration-500 outline-none focus-visible:ring-2 ${qualityMenuOpen ? "text-theme-danger rotate-90" : ""}`}
        onClick={(e) => {
          e.stopPropagation();
          handleOpenMenu();
        }}
      >
        <span className="sr-only">Quality settings</span>
        <Settings className="h-5 w-5" aria-hidden="true" />
        {currentProviderQuality !== "auto" && providerQualities.length > 0 && (
          <div className="bg-theme-accent absolute top-1 right-1 h-2 w-2 animate-pulse rounded-full shadow-[0_0_8px_var(--color-theme-accent)]" />
        )}
      </button>

      {/* Quality Menu Dialog */}
      {qualityMenuOpen && (
        <div className="absolute right-0 bottom-full z-50 mb-4 flex flex-col items-end pb-2">
          <div className="bg-theme-bg/95 border-theme-border/50 rounded-theme animate-in slide-in-from-bottom-2 fade-in flex min-w-[220px] flex-col overflow-hidden border shadow-[0_0_40px_rgba(0,0,0,0.5)] backdrop-blur-xl">
            <div className="text-theme-muted border-theme-border/30 bg-theme-bg/50 border-b px-4 py-2 text-[10px] font-bold tracking-widest uppercase">
              Video Quality
            </div>

            {providerQualities.length > 0 && (
              <div className="flex flex-col">
                <div className="text-theme-muted border-theme-border/10 border-b px-4 py-2 text-[9px] tracking-widest uppercase">
                  Native Core Provider
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setProviderQuality("auto");
                  }}
                  className={`border-theme-border/10 hover:bg-theme-accent/20 flex items-center justify-between border-b px-4 py-3 text-left text-xs font-bold transition-all ${currentProviderQuality === "auto" ? "text-theme-accent bg-theme-accent/10 shadow-[inset_2px_0_0_var(--color-theme-accent)]" : "text-theme-text"}`}
                >
                  Auto (Provider Default)
                </button>
                {providerQualities.map((q) => (
                  <button
                    key={q}
                    onClick={(e) => {
                      e.stopPropagation();
                      setProviderQuality(q);
                    }}
                    className={`border-theme-border/10 hover:bg-theme-accent/20 flex items-center justify-between border-b px-4 py-3 text-left text-xs font-bold transition-all ${currentProviderQuality === q ? "text-theme-accent bg-theme-accent/10 shadow-[inset_2px_0_0_var(--color-theme-accent)]" : "text-theme-text"}`}
                  >
                    <span
                      className={q === "highres" ? "text-theme-accent" : ""}
                    >
                      {q === "highres"
                        ? "Target Ultra/4K"
                        : q.replace(/hd/, "").toUpperCase()}
                    </span>
                    {currentProviderQuality === q && (
                      <div className="bg-theme-accent h-2 w-2 rounded-full shadow-[0_0_5px_currentColor]"></div>
                    )}
                  </button>
                ))}
              </div>
            )}

            {hlsLevels.length > 0 && (
              <div className="flex flex-col">
                <div className="text-theme-muted border-theme-border/10 border-b px-4 py-2 text-[9px] tracking-widest uppercase">
                  Stream Manifest Levels
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setHlsQuality(-1);
                  }}
                  className={`border-theme-border/10 hover:bg-theme-accent/20 border-b px-4 py-3 text-left text-xs font-bold transition-all ${currentHlsLevel === -1 ? "text-theme-accent bg-theme-accent/10 shadow-[inset_2px_0_0_var(--color-theme-accent)]" : "text-theme-text"}`}
                >
                  Auto (Adaptive)
                </button>
                {hlsLevels.map((level, idx) => (
                  <button
                    key={idx}
                    onClick={(e) => {
                      e.stopPropagation();
                      setHlsQuality(idx);
                    }}
                    className={`border-theme-border/10 hover:bg-theme-accent/20 border-b px-4 py-3 text-left text-xs font-bold transition-all last:border-b-0 ${currentHlsLevel === idx ? "text-theme-accent bg-theme-accent/10 shadow-[inset_2px_0_0_var(--color-theme-accent)]" : "text-theme-text"}`}
                  >
                    {level.height}p Rate
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Re-export for barrel
export { type QualityMenuProps };
