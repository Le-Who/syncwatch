/* eslint-disable @next/next/no-img-element */
"use client";

import { useStore } from "@/lib/store";
import { useShallow } from "zustand/react/shallow";
import { formatTime } from "@/lib/utils";
import { LivePosition } from "./LivePosition";
import { Trash2, GripVertical, PlayCircle } from "lucide-react";
import { motion, Reorder } from "motion/react";
import { PlaylistSearchForm } from "./PlaylistSearchForm";

export default function Playlist() {
  const { room, participantId, sendCommand } = useStore(
    useShallow((s) => ({
      room: s.room,
      participantId: s.participantId,
      sendCommand: s.sendCommand,
    })),
  );

  if (!room) return null;

  const canEdit =
    room.settings.controlMode === "open" ||
    room.participants[participantId!]?.role === "owner" ||
    room.participants[participantId!]?.role === "moderator";

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
      {/* ⚡ Bolt Optimization: Extracted PlaylistSearchForm to prevent O(N) re-renders of the 500-item playlist on every keystroke. */}
      <PlaylistSearchForm canEdit={canEdit} sendCommand={sendCommand} />

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
                layout
                initial={{ opacity: 0, scale: 0.95, y: -10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, x: -20 }}
                transition={{ duration: 0.2, ease: "easeOut" }}
                className={`rounded-theme flex items-center border-2 p-2.5 transition-all ${
                  room.currentMediaId === item.id
                    ? "bg-theme-accent/20 border-theme-accent shadow-theme"
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

                <button
                  type="button"
                  className="group ring-theme-accent min-w-0 flex-1 cursor-pointer rounded-sm px-3 text-left outline-none focus-visible:ring-2"
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
                    const isActive = room.currentMediaId === item.id;
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
                            {isActive ? (
                              <LivePosition
                                basePosition={room.playback.basePosition}
                                baseTimestamp={room.playback.baseTimestamp}
                                rate={room.playback.rate}
                                isPlaying={room.playback.status === "playing"}
                                duration={item.duration}
                              />
                            ) : (
                              <span className="text-theme-accent/80">
                                {formatTime(item.lastPosition || 0)} /{" "}
                                {formatTime(item.duration)}
                              </span>
                            )}
                          </>
                        )}
                      </p>
                    );
                  })()}
                </button>

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
                    aria-label={`Remove ${item.title}`}
                    className="hover:text-theme-danger hover:bg-theme-danger/10 rounded-theme ring-theme-danger z-10 p-2 opacity-50 transition-all outline-none hover:opacity-100 focus-visible:ring-2"
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
