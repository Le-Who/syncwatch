"use client";

import { useState } from "react";
import { useStore } from "@/lib/store";
import { X, Save } from "lucide-react";
import { motion } from "motion/react";

export default function RoomSettingsDialog({
  onClose,
}: {
  onClose: () => void;
}) {
  const { room, participantId, sendCommand } = useStore();
  const [settings, setSettings] = useState(
    room?.settings || {
      controlMode: "open",
      autoplayNext: true,
      looping: false,
    },
  );

  if (!room) return null;

  const isOwnerOrMod =
    room.participants[participantId!]?.role === "owner" ||
    room.participants[participantId!]?.role === "moderator";

  const hasOwner = Object.values(room.participants).some(
    (p) => p.role === "owner",
  );

  const handleSave = () => {
    if (isOwnerOrMod) {
      sendCommand("update_settings", { settings });
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Cinematic overlay */}
      <div
        className="bg-theme-bg/60 absolute inset-0 backdrop-blur-md"
        onClick={onClose}
      />

      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 10 }}
        transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
        className="bg-theme-bg/95 border-theme-border rounded-theme font-theme relative z-10 w-full max-w-md overflow-hidden border-2 tracking-wide uppercase shadow-[0_10px_40px_var(--color-theme-shadow)] backdrop-blur-3xl"
      >
        <div className="border-theme-border/30 bg-theme-bg/50 flex items-center justify-between border-b-2 p-5">
          <h2 className="text-theme-text text-lg font-bold tracking-wide drop-shadow-sm">
            Terminal Settings
          </h2>
          <button
            onClick={onClose}
            className="text-theme-muted hover:text-theme-accent hover:bg-theme-accent/10 rounded-theme p-2 transition-all"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-8 p-6">
          <div className="space-y-5">
            <h3 className="text-theme-accent text-xs font-bold tracking-[0.2em]">
              Permissions
            </h3>

            <div className="space-y-4">
              <label className="group flex cursor-pointer items-start space-x-4">
                <div className="pt-1">
                  <input
                    type="radio"
                    name="controlMode"
                    value="open"
                    checked={settings.controlMode === "open"}
                    onChange={() =>
                      setSettings({ ...settings, controlMode: "open" })
                    }
                    disabled={!isOwnerOrMod}
                    className="text-theme-accent focus:ring-theme-accent/50 bg-theme-bg/50 border-theme-border h-4 w-4 transition-all focus:ring-offset-0 focus:ring-offset-transparent"
                  />
                </div>
                <div>
                  <p className="text-theme-text/80 group-hover:text-theme-accent text-sm font-bold transition-colors">
                    Open Room
                  </p>
                  <p className="text-theme-muted mt-1 text-[10px] leading-relaxed font-bold tracking-widest">
                    Everyone can control playback and edit the playlist.
                  </p>
                </div>
              </label>

              <label className="group flex cursor-pointer items-start space-x-4">
                <div className="pt-1">
                  <input
                    type="radio"
                    name="controlMode"
                    value="hybrid"
                    checked={settings.controlMode === "hybrid"}
                    onChange={() =>
                      setSettings({ ...settings, controlMode: "hybrid" })
                    }
                    disabled={!isOwnerOrMod}
                    className="text-theme-accent focus:ring-theme-accent/50 bg-theme-bg/50 border-theme-border h-4 w-4 transition-all focus:ring-offset-0 focus:ring-offset-transparent"
                  />
                </div>
                <div>
                  <p className="text-theme-text/80 group-hover:text-theme-accent text-sm font-bold transition-colors">
                    Hybrid Room
                  </p>
                  <p className="text-theme-muted mt-1 text-[10px] leading-relaxed font-bold tracking-widest">
                    Everyone can play/pause, but only moderators can edit the
                    playlist.
                  </p>
                </div>
              </label>

              <label className="group flex cursor-pointer items-start space-x-4">
                <div className="pt-1">
                  <input
                    type="radio"
                    name="controlMode"
                    value="controlled"
                    checked={settings.controlMode === "controlled"}
                    onChange={() =>
                      setSettings({ ...settings, controlMode: "controlled" })
                    }
                    disabled={!isOwnerOrMod}
                    className="text-theme-accent focus:ring-theme-accent/50 bg-theme-bg/50 border-theme-border h-4 w-4 transition-all focus:ring-offset-0 focus:ring-offset-transparent"
                  />
                </div>
                <div>
                  <p className="text-theme-text/80 group-hover:text-theme-accent text-sm font-bold transition-colors">
                    Controlled Room
                  </p>
                  <p className="text-theme-muted mt-1 text-[10px] leading-relaxed font-bold tracking-widest">
                    Only moderators can control playback and edit the playlist.
                  </p>
                </div>
              </label>
            </div>
          </div>

          <div className="border-theme-border/30 space-y-5 border-t-2 pt-6">
            <h3 className="text-theme-accent text-xs font-bold tracking-[0.2em]">
              Playback
            </h3>

            <label className="group flex cursor-pointer items-center justify-between">
              <div className="pr-4">
                <p className="text-theme-text/80 group-hover:text-theme-accent text-sm font-bold transition-colors">
                  Autoplay Next
                </p>
                <p className="text-theme-muted mt-1 text-[10px] leading-relaxed font-bold tracking-widest">
                  Automatically play the next video in the playlist.
                </p>
              </div>
              <input
                type="checkbox"
                checked={settings.autoplayNext}
                onChange={(e) =>
                  setSettings({ ...settings, autoplayNext: e.target.checked })
                }
                disabled={!isOwnerOrMod}
                className="text-theme-accent focus:ring-theme-accent/50 bg-theme-bg/50 border-theme-border h-5 w-5 rounded-md transition-all"
              />
            </label>

            <label className="group flex cursor-pointer items-center justify-between">
              <div className="pr-4">
                <p className="text-theme-text/80 group-hover:text-theme-accent text-sm font-bold transition-colors">
                  Loop Playlist
                </p>
                <p className="text-theme-muted mt-1 text-[10px] leading-relaxed font-bold tracking-widest">
                  Restart the playlist when it ends.
                </p>
              </div>
              <input
                type="checkbox"
                checked={settings.looping}
                onChange={(e) =>
                  setSettings({ ...settings, looping: e.target.checked })
                }
                disabled={!isOwnerOrMod}
                className="text-theme-accent focus:ring-theme-accent/50 bg-theme-bg/50 border-theme-border h-5 w-5 rounded-md transition-all"
              />
            </label>
          </div>

          {!hasOwner && (
            <div className="border-theme-border/30 border-t-2 pt-6">
              <div className="rounded-theme bg-theme-accent/10 border-theme-accent/30 flex items-center justify-between border p-4">
                <div>
                  <h3 className="text-theme-accent text-sm font-bold tracking-widest uppercase">
                    Orphaned Room
                  </h3>
                  <p className="text-theme-text/80 mt-1 text-[10px] leading-relaxed">
                    This room currently has no owner.
                  </p>
                </div>
                <button
                  onClick={() => {
                    sendCommand("claim_host", {});
                    onClose();
                  }}
                  className="bg-theme-accent text-theme-bg rounded-theme px-4 py-2 text-xs font-bold tracking-widest shadow-[var(--theme-shadow)] transition-all hover:shadow-[var(--theme-shadow-hover)] active:translate-y-0.5 active:shadow-none"
                >
                  CLAIM HOST
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="border-theme-border/30 bg-theme-bg/50 flex justify-end space-x-3 border-t-2 p-5">
          <button
            onClick={onClose}
            className="text-theme-muted hover:text-theme-text hover:bg-theme-bg/50 rounded-theme hover:border-theme-border border-2 border-transparent px-5 py-2.5 text-xs font-bold tracking-widest transition-all"
          >
            CANCEL
          </button>
          {isOwnerOrMod && (
            <button
              onClick={handleSave}
              className="bg-theme-accent text-theme-bg rounded-theme flex items-center space-x-2 px-5 py-2.5 text-xs font-bold tracking-widest shadow-[var(--theme-shadow)] transition-all hover:shadow-[var(--theme-shadow-hover)] active:translate-y-0.5 active:shadow-none"
            >
              <Save className="h-4 w-4" />
              <span>SAVE</span>
            </button>
          )}
        </div>
      </motion.div>
    </div>
  );
}
