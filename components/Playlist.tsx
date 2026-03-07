"use client";

import { useState } from "react";
import { useStore } from "@/lib/store";
import {
  Plus,
  Trash2,
  GripVertical,
  PlayCircle,
  AlertTriangle,
} from "lucide-react";
import { motion, Reorder } from "motion/react";
import ReactPlayer from "react-player";

export default function Playlist() {
  const { room, participantId, sendCommand } = useStore();
  const [url, setUrl] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!room) return null;

  const canEdit =
    room.settings.controlMode === "open" ||
    room.participants[participantId!]?.role === "owner" ||
    room.participants[participantId!]?.role === "moderator";

  const getProviderAndTitle = (
    testUrl: string,
  ): { provider: string; isValid: boolean } => {
    // ReactPlayer checks CanPlay
    if (ReactPlayer.canPlay(testUrl)) {
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
      if (testUrl.includes("soundcloud.com"))
        return { provider: "SoundCloud", isValid: true };
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

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim() || !canEdit) return;

    setError(null);
    setIsAdding(true);

    const cleanUrl = url.trim();
    const check = getProviderAndTitle(cleanUrl);

    if (!check.isValid) {
      setError("This URL is not supported by the player.");
      setIsAdding(false);
      return;
    }

    const startPosition = parseTimeFromUrl(cleanUrl);

    let fetchedTitle = `${check.provider} Video`;
    try {
      const res = await fetch(
        `/api/metadata?url=${encodeURIComponent(cleanUrl)}`,
      );
      if (res.ok) {
        const data = await res.json();
        if (data.title) {
          fetchedTitle = data.title;
        }
      }
    } catch (err) {
      console.error("Failed to fetch metadata:", err);
    }

    sendCommand("add_item", {
      url: cleanUrl,
      provider: check.provider,
      title: fetchedTitle,
      startPosition,
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
    <div className="flex flex-col h-full bg-transparent">
      {canEdit && (
        <div className="p-4 border-b border-theme-border/30 shrink-0 bg-theme-bg/50 backdrop-blur-md">
          <form onSubmit={handleAdd} className="flex flex-col space-y-3">
            <div className="flex space-x-2">
              <input
                type="url"
                placeholder="Paste YouTube, Vimeo, Twitch, or .mp4 URL..."
                value={url}
                onChange={(e) => {
                  setUrl(e.target.value);
                  setError(null);
                }}
                className="flex-1 bg-theme-bg/50 backdrop-blur-sm border-2 border-theme-border/50 rounded-theme px-4 py-2.5 text-sm text-theme-text placeholder-theme-muted focus:outline-none focus:border-theme-accent focus:shadow-[0_0_15px_var(--color-theme-accent)] transition-all font-bold tracking-wide uppercase"
                required
              />
              <button
                type="submit"
                disabled={!url.trim() || isAdding}
                className="p-2.5 bg-theme-accent text-theme-bg hover:shadow-[var(--theme-shadow-hover)] disabled:opacity-50 disabled:cursor-not-allowed rounded-theme transition-all shadow-[var(--theme-shadow)] active:scale-95"
                title="Add to playlist"
              >
                <Plus className="w-5 h-5" />
              </button>
            </div>
            {error && (
              <div className="flex items-center space-x-2 text-xs text-red-400 bg-red-500/10 border border-red-500/20 px-3 py-2 rounded-lg backdrop-blur-md">
                <AlertTriangle className="w-4 h-4" />
                <span>{error}</span>
              </div>
            )}
            <div className="text-[10px] text-zinc-500 font-light px-1">
              Ensure direct media links support CORS headers to prevent playback
              issues.
            </div>
          </form>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-3 scrollbar-thin scrollbar-thumb-zinc-700/50 scrollbar-track-transparent">
        {room.playlist.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-zinc-600 space-y-4">
            <div className="w-16 h-16 rounded-2xl bg-white/5 flex items-center justify-center border border-white/5">
              <PlayCircle className="w-8 h-8 text-zinc-600" />
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
                className={`flex items-center p-2.5 rounded-theme border-2 transition-all ${
                  room.currentMediaId === item.id
                    ? "bg-theme-accent/20 border-theme-accent shadow-[var(--theme-shadow)]"
                    : "bg-theme-bg/40 border-theme-border/30 hover:border-theme-accent hover:bg-theme-bg/60"
                }`}
              >
                {canEdit && (
                  <div className="cursor-grab active:cursor-grabbing p-1.5 text-theme-muted hover:text-theme-accent transition-colors">
                    <GripVertical className="w-4 h-4" />
                  </div>
                )}

                <div
                  className="flex-1 min-w-0 px-3 cursor-pointer group"
                  onClick={() => handlePlay(item.id)}
                >
                  <p
                    className={`text-sm font-bold truncate mb-1 transition-colors uppercase tracking-wide ${
                      room.currentMediaId === item.id
                        ? "text-theme-accent drop-shadow-sm"
                        : "text-theme-text group-hover:text-theme-accent"
                    }`}
                  >
                    {item.title}
                  </p>
                  <p className="text-[11px] text-theme-muted truncate flex items-center space-x-1.5 font-bold tracking-widest uppercase mb-1">
                    <span className="text-theme-text/70">{item.provider}</span>
                    <span className="opacity-30 border-l-2 border-theme-border/50 h-3 mx-1"></span>
                    <span>ADDED BY // {item.addedBy}</span>
                  </p>
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
                      <div className="absolute bottom-0 left-0 right-0 h-[3px] bg-theme-border/30 rounded-b-theme overflow-hidden">
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
                    className="p-2 opacity-50 hover:opacity-100 hover:text-theme-danger hover:bg-theme-danger/10 rounded-theme transition-all z-10"
                    title="Remove"
                  >
                    <Trash2 className="w-4 h-4" />
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
