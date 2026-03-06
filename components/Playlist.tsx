"use client";

import { useState } from "react";
import { useStore } from "@/lib/store";
import { Plus, Trash2, GripVertical, PlayCircle } from "lucide-react";
import { motion, Reorder } from "motion/react";

export default function Playlist() {
  const { room, participantId, sendCommand } = useStore();
  const [url, setUrl] = useState("");
  const [isAdding, setIsAdding] = useState(false);

  if (!room) return null;

  const canEdit =
    room.settings.controlMode === "open" ||
    room.participants[participantId!]?.role === "owner" ||
    room.participants[participantId!]?.role === "moderator";

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim() || !canEdit) return;

    setIsAdding(true);

    // Basic provider detection
    let provider = "direct";
    if (url.includes("youtube.com") || url.includes("youtu.be"))
      provider = "youtube";
    else if (url.includes("vimeo.com")) provider = "vimeo";
    else if (url.includes(".m3u8")) provider = "hls";

    sendCommand("add_item", {
      url: url.trim(),
      provider,
      title: `Video ${room.playlist.length + 1}`, // In a real app, fetch metadata here
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
    <div className="flex flex-col h-full bg-zinc-900/50">
      {canEdit && (
        <div className="p-4 border-b border-zinc-800 shrink-0">
          <form onSubmit={handleAdd} className="flex space-x-2">
            <input
              type="url"
              placeholder="Paste video URL..."
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="flex-1 bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              required
            />
            <button
              type="submit"
              disabled={!url.trim() || isAdding}
              className="p-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
            >
              <Plus className="w-5 h-5" />
            </button>
          </form>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-2">
        {room.playlist.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-zinc-500 space-y-2">
            <PlayCircle className="w-12 h-12 opacity-20" />
            <p className="text-sm">Playlist is empty</p>
          </div>
        ) : (
          <Reorder.Group
            axis="y"
            values={room.playlist}
            onReorder={handleReorder}
            className="space-y-2"
          >
            {room.playlist.map((item) => (
              <Reorder.Item
                key={item.id}
                value={item}
                className={`flex items-center p-2 rounded-lg border transition-colors ${
                  room.currentMediaId === item.id
                    ? "bg-indigo-500/10 border-indigo-500/50"
                    : "bg-zinc-900 border-zinc-800 hover:border-zinc-700"
                }`}
              >
                {canEdit && (
                  <div className="cursor-grab active:cursor-grabbing p-1 text-zinc-600 hover:text-zinc-400">
                    <GripVertical className="w-4 h-4" />
                  </div>
                )}

                <div
                  className="flex-1 min-w-0 px-2 cursor-pointer"
                  onClick={() => handlePlay(item.id)}
                >
                  <p
                    className={`text-sm font-medium truncate ${room.currentMediaId === item.id ? "text-indigo-400" : "text-zinc-200"}`}
                  >
                    {item.title}
                  </p>
                  <p className="text-xs text-zinc-500 truncate">
                    Added by {item.addedBy} • {item.provider}
                  </p>
                </div>

                {canEdit && (
                  <button
                    onClick={() => handleRemove(item.id)}
                    className="p-2 text-zinc-600 hover:text-red-400 transition-colors rounded-md hover:bg-zinc-800"
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
