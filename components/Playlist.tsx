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

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim() || !canEdit) return;

    setError(null);
    setIsAdding(true);

    const check = getProviderAndTitle(url.trim());

    if (!check.isValid) {
      setError("This URL is not supported by the player.");
      setIsAdding(false);
      return;
    }

    sendCommand("add_item", {
      url: url.trim(),
      provider: check.provider,
      title: `${check.provider} Video`, // Ideally fetched via oEmbed or server-side metadata in prod
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
        <div className="p-4 border-b border-white/5 shrink-0 bg-black/20">
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
                className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-indigo-500/50 focus:bg-white/10 transition-all font-light"
                required
              />
              <button
                type="submit"
                disabled={!url.trim() || isAdding}
                className="p-2.5 bg-white text-black hover:bg-zinc-200 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl transition-all shadow-[0_0_15px_rgba(255,255,255,0.1)] active:scale-[0.98]"
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
                className={`flex items-center p-2.5 rounded-xl border transition-all ${
                  room.currentMediaId === item.id
                    ? "bg-indigo-500/10 border-indigo-500/30 shadow-[0_0_30px_rgba(99,102,241,0.1)]"
                    : "bg-black/20 border-white/5 hover:border-white/10 hover:bg-black/40"
                }`}
              >
                {canEdit && (
                  <div className="cursor-grab active:cursor-grabbing p-1.5 text-zinc-600 hover:text-zinc-400">
                    <GripVertical className="w-4 h-4" />
                  </div>
                )}

                <div
                  className="flex-1 min-w-0 px-3 cursor-pointer group"
                  onClick={() => handlePlay(item.id)}
                >
                  <p
                    className={`text-sm font-medium truncate mb-1 transition-colors ${
                      room.currentMediaId === item.id
                        ? "text-indigo-300"
                        : "text-zinc-200 group-hover:text-white"
                    }`}
                  >
                    {item.title}
                  </p>
                  <p className="text-[11px] text-zinc-500 truncate flex items-center space-x-1.5 font-light">
                    <span className="text-zinc-400 capitalize">
                      {item.provider}
                    </span>
                    <span className="opacity-30">•</span>
                    <span>Added by {item.addedBy}</span>
                  </p>
                </div>

                {canEdit && (
                  <button
                    onClick={() => handleRemove(item.id)}
                    className="p-2 text-zinc-600 hover:text-red-400 hover:bg-red-500/10 transition-colors rounded-lg"
                    title="Remove item"
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
