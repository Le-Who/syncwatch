/* eslint-disable @next/next/no-img-element */
"use client";

import { useState, useEffect } from "react";
import { useStore } from "@/lib/store";
import {
  Plus,
  Trash2,
  GripVertical,
  PlayCircle,
  AlertTriangle,
  Search,
  Loader2,
} from "lucide-react";
import { motion, Reorder } from "motion/react";
import ReactPlayer from "react-player";

export default function Playlist() {
  const { room, participantId, sendCommand } = useStore();
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

  if (!room) return null;

  const canEdit =
    room.settings.controlMode === "open" ||
    room.participants[participantId!]?.role === "owner" ||
    room.participants[participantId!]?.role === "moderator";

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

  const formatTime = (seconds: number) => {
    if (!seconds || isNaN(seconds) || seconds < 0) return "0:00";
    const totalSeconds = Math.max(0, Math.floor(seconds));
    const hh = Math.floor(totalSeconds / 3600);
    const mm = Math.floor((totalSeconds % 3600) / 60);
    const ss = (totalSeconds % 60).toString().padStart(2, "0");
    if (hh > 0) return `${hh}:${mm.toString().padStart(2, "0")}:${ss}`;
    return `${mm}:${ss}`;
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

  const handleRemove = (itemId: string) => {
    if (!canEdit) return;
    sendCommand("remove_item", { itemId });
  };

  const handlePlay = (itemId: string) => {
    if (!canEdit && room.settings.controlMode !== "hybrid") return;
    sendCommand("set_media", { itemId });
  };

  const handleReorder = (newOrder: any[]) => {
    if (!canEdit) return;
    sendCommand("reorder_playlist", { playlist: newOrder });
  };

  return (
    <div className="flex h-full flex-col bg-transparent">
      {canEdit && (
        <div className="border-theme-border/30 bg-theme-bg/50 shrink-0 border-b p-4 backdrop-blur-md">
          <form
            onSubmit={(e) => handleAdd(e)}
            className="flex flex-col space-y-3"
          >
            <div className="relative flex flex-col space-y-2">
              <div className="relative flex space-x-2">
                <input
                  type="text"
                  placeholder="Search YouTube or paste any media URL..."
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
                  className="bg-theme-accent text-theme-bg rounded-theme flex min-w-[44px] items-center justify-center p-2.5 shadow-[var(--theme-shadow)] transition-all hover:shadow-[var(--theme-shadow-hover)] active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
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
                      className="hover:text-theme-text"
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
                      className="hover:bg-theme-accent/10 border-theme-border/10 flex w-full items-center space-x-3 border-b px-3 py-3 text-left transition-colors last:border-0"
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
      )}

      <div className="scrollbar-thin scrollbar-thumb-zinc-700/50 scrollbar-track-transparent flex-1 overflow-y-auto p-3">
        {room.playlist.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center space-y-4 text-zinc-600">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-white/5 bg-white/5">
              <PlayCircle className="h-8 w-8 text-zinc-600" />
            </div>
            <p className="text-sm font-light">Playlist is empty</p>
          </div>
        ) : (
          <Reorder.Group
            axis="y"
            values={room.playlist}
            onReorder={handleReorder}
            className="space-y-2.5"
          >
            {room.playlist.map((item) => (
              <Reorder.Item
                key={item.id}
                value={item}
                className={`rounded-theme flex items-center border-2 p-2.5 transition-all ${
                  room.currentMediaId === item.id
                    ? "bg-theme-accent/20 border-theme-accent shadow-[var(--theme-shadow)]"
                    : "bg-theme-bg/40 border-theme-border/30 hover:border-theme-accent hover:bg-theme-bg/60"
                }`}
              >
                {canEdit && (
                  <div className="text-theme-muted hover:text-theme-accent shrink-0 cursor-grab p-1.5 transition-colors active:cursor-grabbing">
                    <GripVertical className="h-4 w-4" />
                  </div>
                )}

                {item.thumbnail ? (
                  <img
                    src={item.thumbnail}
                    alt=""
                    className="border-theme-border/30 ml-1 h-10 w-16 shrink-0 rounded border object-cover shadow-sm"
                  />
                ) : (
                  <div className="bg-theme-bg/50 border-theme-border/30 ml-1 flex h-10 w-16 shrink-0 items-center justify-center rounded border shadow-inner">
                    <PlayCircle className="text-theme-muted h-5 w-5 opacity-50" />
                  </div>
                )}

                <div
                  className="group min-w-0 flex-1 cursor-pointer px-3"
                  onClick={() => handlePlay(item.id)}
                >
                  <p
                    className={`mb-1 truncate text-sm font-bold tracking-wide uppercase transition-colors ${
                      room.currentMediaId === item.id
                        ? "text-theme-accent drop-shadow-sm"
                        : "text-theme-text group-hover:text-theme-accent"
                    }`}
                  >
                    {item.title}
                  </p>

                  {(() => {
                    let currentPos = item.lastPosition || 0;
                    if (room.currentMediaId === item.id) {
                      const elapsed =
                        room.playback.status === "playing"
                          ? (Date.now() - room.playback.baseTimestamp) / 1000
                          : 0;
                      currentPos =
                        room.playback.basePosition +
                        elapsed * room.playback.rate;
                    }
                    return (
                      <p className="text-theme-muted mb-1 flex flex-wrap items-center space-x-1.5 truncate text-[11px] font-bold tracking-widest uppercase">
                        <span className="text-theme-text/70">
                          {item.provider}
                        </span>
                        <span className="border-theme-border/50 mx-1 h-3 border-l-2 opacity-30"></span>
                        <span>BY // {item.addedBy}</span>
                        {item.duration > 0 && (
                          <>
                            <span className="border-theme-border/50 mx-1 h-3 border-l-2 opacity-30"></span>
                            <span className="text-theme-accent/80">
                              {formatTime(currentPos)} /{" "}
                              {formatTime(item.duration)}
                            </span>
                          </>
                        )}
                      </p>
                    );
                  })()}
                </div>

                {/* Progress Bar inside card */}
                {(() => {
                  let progress = 0;
                  if (room.currentMediaId === item.id) {
                    const elapsed =
                      room.playback.status === "playing"
                        ? (Date.now() - room.playback.baseTimestamp) / 1000
                        : 0;
                    const currentPos =
                      room.playback.basePosition + elapsed * room.playback.rate;
                    progress = item.duration
                      ? Math.min((currentPos / item.duration) * 100, 100)
                      : 0;
                  } else if (item.lastPosition && item.duration) {
                    progress = Math.min(
                      (item.lastPosition / item.duration) * 100,
                      100,
                    );
                  }

                  if (progress > 0) {
                    return (
                      <div className="bg-theme-border/30 rounded-b-theme absolute right-0 bottom-0 left-0 h-[3px] overflow-hidden">
                        <div
                          className={`h-full transition-all duration-1000 ${
                            room.currentMediaId === item.id
                              ? "bg-theme-accent shadow-[0_0_8px_var(--color-theme-accent)]"
                              : "bg-theme-muted/50"
                          }`}
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                    );
                  }
                  return null;
                })()}

                {canEdit && (
                  <button
                    onClick={() => handleRemove(item.id)}
                    className="hover:text-theme-danger hover:bg-theme-danger/10 rounded-theme z-10 p-2 opacity-50 transition-all hover:opacity-100"
                    title="Remove"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </Reorder.Item>
            ))}
          </Reorder.Group>
        )}
      </div>
    </div>
  );
}
