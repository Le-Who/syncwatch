/* eslint-disable @next/next/no-img-element */
import React, { useState, useEffect } from "react";
import { Plus, AlertTriangle, Search, Loader2 } from "lucide-react";
import { formatTime } from "@/lib/utils";
import ReactPlayer from "react-player";

interface PlaylistSearchFormProps {
  canEdit: boolean;
  sendCommand: (type: string, payload?: any) => void;
}

// ⚡ Bolt Optimization: Wrapped in React.memo to ensure the form does not re-render
// when the parent Playlist component updates, unless props actually change.
export const PlaylistSearchForm = React.memo(function PlaylistSearchForm({
  canEdit,
  sendCommand,
}: PlaylistSearchFormProps) {
  const [url, setUrl] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);

  // Debounced search effect
  useEffect(() => {
    const currentInput = url.trim();
    if (!currentInput || currentInput.startsWith("http")) {
      setSearchResults([]);
      setShowDropdown(false);
      return;
    }

    const timer = setTimeout(async () => {
      setIsSearching(true);
      try {
        const res = await fetch(
          `/api/youtube/search?q=${encodeURIComponent(currentInput)}`,
        );
        if (res.ok) {
          const data = await res.json();
          setSearchResults(data.videos || []);
          setShowDropdown(true);
        }
      } catch (err) {
        console.error("Search failed:", err);
      } finally {
        setIsSearching(false);
      }
    }, 600);
    return () => clearTimeout(timer);
  }, [url]);

  const getProviderAndTitle = (
    testUrl: string,
  ): { provider: string; isValid: boolean } => {
    // ReactPlayer checks CanPlay
    if (ReactPlayer.canPlay?.(testUrl)) {
      if (testUrl.includes("youtube.com") || testUrl.includes("youtu.be"))
        return { provider: "YouTube", isValid: true };
      if (testUrl.includes("vimeo.com"))
        return { provider: "Vimeo", isValid: true };
      if (
        testUrl.includes(".mp4") ||
        testUrl.includes(".webm") ||
        testUrl.includes(".ogg")
      )
        return { provider: "Direct Video", isValid: true };
      if (testUrl.includes("twitch.tv"))
        return { provider: "Twitch", isValid: true };
      return { provider: "Supported Media", isValid: true };
    }

    return { provider: "Unsupported", isValid: false };
  };

  const parseTimeFromUrl = (videoUrl: string): number => {
    try {
      const parsedUrl = new URL(videoUrl);
      const timeParam =
        parsedUrl.searchParams.get("t") || parsedUrl.searchParams.get("start");

      if (!timeParam) return 0;

      if (!isNaN(Number(timeParam))) {
        return Number(timeParam);
      }

      let totalSeconds = 0;
      const hoursMatch = timeParam.match(/(\d+)h/i);
      const minutesMatch = timeParam.match(/(\d+)m/i);
      const secondsMatch = timeParam.match(/(\d+)s/i);

      if (hoursMatch) totalSeconds += parseInt(hoursMatch[1], 10) * 3600;
      if (minutesMatch) totalSeconds += parseInt(minutesMatch[1], 10) * 60;
      if (secondsMatch) totalSeconds += parseInt(secondsMatch[1], 10);

      return totalSeconds;
    } catch {
      return 0;
    }
  };

  const handleAdd = async (
    e?: React.FormEvent,
    directUrl?: string,
    directTitle?: string,
    directThumbnail?: string,
  ) => {
    if (e) e.preventDefault();
    const targetUrl = (directUrl || url).trim();
    if (!targetUrl || !canEdit) return;

    setError(null);
    setIsAdding(true);
    setShowDropdown(false);

    // Check if YouTube Playlist
    if (targetUrl.includes("youtube.com") && targetUrl.includes("list=")) {
      try {
        const urlObj = new URL(targetUrl);
        const listId = urlObj.searchParams.get("list");
        if (listId) {
          const res = await fetch(`/api/youtube/playlist?listId=${listId}`);
          if (res.ok) {
            const data = await res.json();
            if (data.videos && data.videos.length > 0) {
              sendCommand("add_items", {
                items: data.videos.map((v: any) => ({
                  url: v.url,
                  provider: "YouTube",
                  title: v.title,
                  duration: v.duration,
                  startPosition: 0,
                  thumbnail: v.thumbnail,
                })),
              });
              setUrl("");
              setIsAdding(false);
              return;
            }
          }
        }
      } catch (err) {
        console.error("Playlist parse error", err);
      }
    }

    const check = getProviderAndTitle(targetUrl);

    if (!check.isValid) {
      setError("This URL is not supported by the player.");
      setIsAdding(false);
      return;
    }

    const startPosition = parseTimeFromUrl(targetUrl);

    let fetchedTitle = directTitle || `${check.provider} Video`;
    let fetchedThumbnail = directThumbnail;
    if (!directTitle && !directThumbnail) {
      try {
        const res = await fetch(
          `/api/metadata?url=${encodeURIComponent(targetUrl)}`,
        );
        if (res.ok) {
          const data = await res.json();
          if (data.title) {
            fetchedTitle = data.title;
          }
          if (data.thumbnail) {
            fetchedThumbnail = data.thumbnail;
          }
        }
      } catch (err) {
        console.error("Failed to fetch metadata:", err);
      }
    }

    sendCommand("add_item", {
      url: targetUrl,
      provider: check.provider,
      title: fetchedTitle,
      startPosition,
      thumbnail: fetchedThumbnail,
    });

    setUrl("");
    setIsAdding(false);
  };

  if (!canEdit) return null;

  return (
    <div className="border-theme-border/30 bg-theme-bg/50 shrink-0 border-b p-4 backdrop-blur-md">
      <form onSubmit={(e) => handleAdd(e)} className="flex flex-col space-y-3">
        <div className="relative flex flex-col space-y-2">
          <div className="relative flex space-x-2">
            <input
              type="text"
              placeholder="Search YouTube or paste any media URL..."
              aria-label="Search YouTube or paste any media URL"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                setError(null);
              }}
              className="bg-theme-bg/50 border-theme-border/50 rounded-theme text-theme-text placeholder-theme-muted focus:border-theme-accent flex-1 border-2 px-4 py-2.5 pr-10 text-sm font-bold tracking-wide backdrop-blur-sm transition-all focus:shadow-[0_0_15px_var(--color-theme-accent)] focus:outline-none"
              required
            />
            {isSearching && (
              <div className="text-theme-accent absolute top-1/2 right-14 -translate-y-1/2">
                <Loader2 className="h-4 w-4 animate-spin" />
              </div>
            )}
            <button
              type="submit"
              disabled={!url.trim() || isAdding}
              aria-label="Search or Add to playlist"
              className="bg-theme-accent text-theme-bg rounded-theme shadow-theme hover:shadow-theme-hover ring-theme-accent flex min-w-[44px] items-center justify-center p-2.5 transition-all outline-none focus-visible:ring-2 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
              title="Search or Add to playlist"
            >
              {isAdding ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : url.startsWith("http") ? (
                <Plus className="h-5 w-5" />
              ) : (
                <Search className="h-5 w-5" />
              )}
            </button>
          </div>

          {/* Search Dropdown */}
          {showDropdown && searchResults.length > 0 && (
            <div className="bg-theme-bg/95 border-theme-border rounded-theme absolute top-12 right-12 left-0 z-50 mt-1 flex max-h-[300px] flex-col overflow-hidden overflow-y-auto border-2 shadow-xl backdrop-blur-xl">
              <div className="border-theme-border/30 text-theme-muted bg-theme-bg/90 sticky top-0 flex items-center justify-between border-b px-3 py-2 text-[10px] font-bold tracking-widest uppercase backdrop-blur-md">
                <span>YouTube Results</span>
                <button
                  type="button"
                  onClick={() => setShowDropdown(false)}
                  aria-label="Close search results"
                  className="hover:text-theme-text outline-none rounded-sm focus-visible:ring-2 ring-theme-accent"
                >
                  Close
                </button>
              </div>
              {searchResults.map((v, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() =>
                    handleAdd(undefined, v.url, v.title, v.thumbnail)
                  }
                  aria-label={`Play ${v.title} by ${v.author}, duration ${formatTime(v.duration)}`}
                  className="hover:bg-theme-accent/10 border-theme-border/10 flex w-full items-center space-x-3 border-b px-3 py-3 text-left transition-colors last:border-0 outline-none focus-visible:ring-2 focus-visible:ring-inset ring-theme-accent"
                >
                  <img
                    src={v.thumbnail}
                    alt=""
                    className="border-theme-border/30 h-10 w-16 shrink-0 rounded-md border object-cover"
                  />
                  <div className="flex flex-col overflow-hidden">
                    <span className="text-theme-text truncate text-sm font-bold">
                      {v.title}
                    </span>
                    <span className="text-theme-muted truncate text-xs">
                      {v.author} • {formatTime(v.duration)}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
        {error && (
          <div className="flex items-center space-x-2 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-400 backdrop-blur-md">
            <AlertTriangle className="h-4 w-4" />
            <span>{error}</span>
          </div>
        )}
        <div className="px-1 text-[10px] font-light text-zinc-500">
          Ensure direct media links support CORS headers to prevent playback
          issues.
        </div>
      </form>
    </div>
  );
});
