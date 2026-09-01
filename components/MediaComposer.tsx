/* eslint-disable @next/next/no-img-element */
"use client";

import { useEffect, useState } from "react";
import {
  AlertTriangle,
  CornerDownRight,
  ListEnd,
  Loader2,
  Plus,
  Search,
} from "lucide-react";
import { formatTime } from "@/lib/utils";
import {
  buildMediaAddCommand,
  MediaComposeError,
  MediaInsertMode,
  MediaSeed,
} from "@/lib/media-compose";

interface MediaComposerProps {
  sendCommand: (type: string, payload: any) => void;
  canSubmit: boolean;
  allowAddNext?: boolean;
  compact?: boolean;
  autoFocus?: boolean;
  className?: string;
  onAdded?: () => void;
}

export function MediaComposer({
  sendCommand,
  canSubmit,
  allowAddNext = true,
  compact = false,
  autoFocus = false,
  className = "",
  onAdded,
}: MediaComposerProps) {
  const [value, setValue] = useState("");
  const [insertMode, setInsertMode] = useState<MediaInsertMode>("end");
  const [isAdding, setIsAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);

  const trimmedValue = value.trim();
  const isUrlInput = /^https?:\/\//i.test(trimmedValue);

  useEffect(() => {
    if (!allowAddNext && insertMode === "next") {
      setInsertMode("end");
    }
  }, [allowAddNext, insertMode]);

  useEffect(() => {
    const query = trimmedValue;
    if (!query || isUrlInput) {
      setSearchResults([]);
      setShowDropdown(false);
      return;
    }

    const timer = setTimeout(async () => {
      setIsSearching(true);
      try {
        const response = await fetch(
          `/api/youtube/search?q=${encodeURIComponent(query)}`,
        );
        if (response.ok) {
          const data = await response.json();
          setSearchResults(Array.isArray(data.videos) ? data.videos : []);
          setShowDropdown(true);
        }
      } catch (err) {
        console.error("Search failed:", err);
      } finally {
        setIsSearching(false);
      }
    }, 600);

    return () => clearTimeout(timer);
  }, [trimmedValue, isUrlInput]);

  const submitMedia = async (rawInput: string, seed?: MediaSeed) => {
    if (!canSubmit || isAdding) return;

    const target = rawInput.trim();
    if (!target) return;

    setError(null);
    setIsAdding(true);
    setShowDropdown(false);

    try {
      const command = await buildMediaAddCommand(target, {
        insertMode,
        seed,
      });
      sendCommand(command.type, command.payload);
      setValue("");
      setSearchResults([]);
      onAdded?.();
    } catch (err) {
      setError(
        err instanceof MediaComposeError
          ? err.message
          : "Could not add this media.",
      );
    } finally {
      setIsAdding(false);
    }
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!isUrlInput) {
      setShowDropdown(searchResults.length > 0);
      setError("Select a search result or paste a media URL.");
      return;
    }
    void submitMedia(value);
  };

  const addSearchResult = (video: any) => {
    void submitMedia(video.url, {
      url: video.url,
      provider: "youtube",
      title: video.title,
      duration: video.duration,
      thumbnail: video.thumbnail,
      author: video.author,
    });
  };

  return (
    <form
      onSubmit={handleSubmit}
      className={`relative flex w-full flex-col gap-2 ${className}`}
    >
      <div
        className={`border-theme-border/50 bg-theme-bg/60 focus-within:border-theme-accent rounded-theme flex min-h-11 items-stretch overflow-hidden border-2 shadow-sm backdrop-blur-xl transition-all focus-within:shadow-[0_0_18px_var(--color-theme-accent)] ${
          compact ? "text-xs" : "text-sm"
        }`}
      >
        <div className="relative min-w-0 flex-1">
          <input
            type="text"
            placeholder="YouTube URL or search…"
            aria-label="YouTube URL or search"
            name="media"
            autoComplete="off"
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
              setError(null);
            }}
            disabled={!canSubmit || isAdding}
            autoFocus={autoFocus}
            className="text-theme-text placeholder-theme-muted h-full w-full min-w-0 bg-transparent px-3 py-2.5 pr-9 font-bold tracking-wide outline-none disabled:cursor-not-allowed disabled:opacity-50"
          />
          {isSearching && (
            <Loader2 className="text-theme-accent absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 animate-spin" />
          )}
        </div>

        <div
          role="group"
          aria-label="Insert position"
          className="border-theme-border/40 flex shrink-0 border-l"
        >
          {allowAddNext && (
            <button
              type="button"
              aria-label="Add next"
              aria-pressed={insertMode === "next"}
              onClick={() => setInsertMode("next")}
              disabled={!canSubmit || isAdding}
              className={`ring-theme-accent flex items-center gap-1 px-2.5 font-bold uppercase transition-all outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-50 ${
                insertMode === "next"
                  ? "bg-theme-accent text-theme-bg"
                  : "text-theme-muted hover:text-theme-accent hover:bg-theme-accent/10"
              }`}
              title="Add next"
            >
              <CornerDownRight className="h-4 w-4" />
              <span className="hidden xl:inline">Next</span>
            </button>
          )}
          <button
            type="button"
            aria-label="Add to end"
            aria-pressed={insertMode === "end"}
            onClick={() => setInsertMode("end")}
            disabled={!canSubmit || isAdding}
            className={`ring-theme-accent flex items-center gap-1 px-2.5 font-bold uppercase transition-all outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-50 ${
              insertMode === "end"
                ? "bg-theme-accent text-theme-bg"
                : "text-theme-muted hover:text-theme-accent hover:bg-theme-accent/10"
            }`}
            title="Add to end"
          >
            <ListEnd className="h-4 w-4" />
            <span className="hidden xl:inline">End</span>
          </button>
        </div>

        <button
          type="submit"
          disabled={!trimmedValue || !canSubmit || isAdding}
          aria-label={isUrlInput ? "Add media" : "Search YouTube"}
          className="bg-theme-accent text-theme-bg ring-theme-text flex w-12 shrink-0 items-center justify-center font-bold transition-all outline-none hover:brightness-110 focus-visible:ring-2 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
          title={isUrlInput ? "Add media" : "Search YouTube"}
        >
          {isAdding ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : isUrlInput ? (
            <Plus className="h-5 w-5" />
          ) : (
            <Search className="h-5 w-5" />
          )}
        </button>
      </div>

      {showDropdown && searchResults.length > 0 && (
        <div className="bg-theme-bg/95 border-theme-border rounded-theme absolute top-full right-0 left-0 z-50 mt-2 flex max-h-[320px] flex-col overflow-hidden overflow-y-auto border-2 shadow-xl backdrop-blur-xl">
          <div className="border-theme-border/30 text-theme-muted bg-theme-bg/90 sticky top-0 flex items-center justify-between border-b px-3 py-2 text-[10px] font-bold tracking-widest uppercase backdrop-blur-md">
            <span>YouTube Results</span>
            <button
              type="button"
              onClick={() => setShowDropdown(false)}
              className="hover:text-theme-text"
            >
              Close
            </button>
          </div>
          {searchResults.map((video, index) => (
            <button
              key={`${video.url}-${index}`}
              type="button"
              onClick={() => addSearchResult(video)}
              className="hover:bg-theme-accent/10 border-theme-border/10 flex w-full items-center gap-3 border-b px-3 py-3 text-left transition-colors last:border-0"
            >
              {video.thumbnail ? (
                <img
                  src={video.thumbnail}
                  alt=""
                  className="border-theme-border/30 h-10 w-16 shrink-0 rounded border object-cover"
                />
              ) : (
                <div className="border-theme-border/30 bg-theme-bg/60 h-10 w-16 shrink-0 rounded border" />
              )}
              <div className="min-w-0 flex-1">
                <p className="text-theme-text truncate text-sm font-bold">
                  {video.title}
                </p>
                <p className="text-theme-muted truncate text-xs">
                  {video.author || "YouTube"}
                  {video.duration ? ` • ${formatTime(video.duration)}` : ""}
                </p>
              </div>
            </button>
          ))}
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 rounded-md border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-400 backdrop-blur-md">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span className="min-w-0">{error}</span>
        </div>
      )}
    </form>
  );
}
