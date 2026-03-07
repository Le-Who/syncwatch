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
        className="absolute inset-0 bg-theme-bg/60 backdrop-blur-md"
        onClick={onClose}
      />

      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 10 }}
        transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
        className="w-full max-w-md bg-theme-bg/95 backdrop-blur-3xl border-2 border-theme-border rounded-theme shadow-[0_10px_40px_var(--color-theme-shadow)] overflow-hidden relative z-10 font-theme uppercase tracking-wide"
      >
        <div className="flex items-center justify-between p-5 border-b-2 border-theme-border/30 bg-theme-bg/50">
          <h2 className="text-lg font-bold text-theme-text tracking-wide drop-shadow-sm">
            Terminal Settings
          </h2>
          <button
            onClick={onClose}
            className="p-2 text-theme-muted hover:text-theme-accent hover:bg-theme-accent/10 rounded-theme transition-all"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-8">
          <div className="space-y-5">
            <h3 className="text-xs font-bold text-theme-accent tracking-[0.2em]">
              Permissions
            </h3>

            <div className="space-y-4">
              <label className="flex items-start space-x-4 cursor-pointer group">
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
                    className="w-4 h-4 text-theme-accent focus:ring-theme-accent/50 bg-theme-bg/50 border-theme-border focus:ring-offset-0 focus:ring-offset-transparent transition-all"
                  />
                </div>
                <div>
                  <p className="text-sm font-bold text-theme-text/80 group-hover:text-theme-accent transition-colors">
                    Open Room
                  </p>
                  <p className="text-[10px] text-theme-muted font-bold tracking-widest mt-1 leading-relaxed">
                    Everyone can control playback and edit the playlist.
                  </p>
                </div>
              </label>

              <label className="flex items-start space-x-4 cursor-pointer group">
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
                    className="w-4 h-4 text-theme-accent focus:ring-theme-accent/50 bg-theme-bg/50 border-theme-border focus:ring-offset-0 focus:ring-offset-transparent transition-all"
                  />
                </div>
                <div>
                  <p className="text-sm font-bold text-theme-text/80 group-hover:text-theme-accent transition-colors">
                    Hybrid Room
                  </p>
                  <p className="text-[10px] text-theme-muted font-bold tracking-widest mt-1 leading-relaxed">
                    Everyone can play/pause, but only moderators can edit the
                    playlist.
                  </p>
                </div>
              </label>

              <label className="flex items-start space-x-4 cursor-pointer group">
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
                    className="w-4 h-4 text-theme-accent focus:ring-theme-accent/50 bg-theme-bg/50 border-theme-border focus:ring-offset-0 focus:ring-offset-transparent transition-all"
                  />
                </div>
                <div>
                  <p className="text-sm font-bold text-theme-text/80 group-hover:text-theme-accent transition-colors">
                    Controlled Room
                  </p>
                  <p className="text-[10px] text-theme-muted font-bold tracking-widest mt-1 leading-relaxed">
                    Only moderators can control playback and edit the playlist.
                  </p>
                </div>
              </label>
            </div>
          </div>

          <div className="space-y-5 pt-6 border-t-2 border-theme-border/30">
            <h3 className="text-xs font-bold text-theme-accent tracking-[0.2em]">
              Playback
            </h3>

            <label className="flex items-center justify-between cursor-pointer group">
              <div className="pr-4">
                <p className="text-sm font-bold text-theme-text/80 group-hover:text-theme-accent transition-colors">
                  Autoplay Next
                </p>
                <p className="text-[10px] text-theme-muted font-bold tracking-widest mt-1 leading-relaxed">
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
                className="w-5 h-5 text-theme-accent focus:ring-theme-accent/50 bg-theme-bg/50 border-theme-border rounded-md transition-all"
              />
            </label>

            <label className="flex items-center justify-between cursor-pointer group">
              <div className="pr-4">
                <p className="text-sm font-bold text-theme-text/80 group-hover:text-theme-accent transition-colors">
                  Loop Playlist
                </p>
                <p className="text-[10px] text-theme-muted font-bold tracking-widest mt-1 leading-relaxed">
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
                className="w-5 h-5 text-theme-accent focus:ring-theme-accent/50 bg-theme-bg/50 border-theme-border rounded-md transition-all"
              />
            </label>
          </div>

          {!hasOwner && (
            <div className="pt-6 border-t-2 border-theme-border/30">
              <div className="p-4 rounded-theme bg-theme-accent/10 border border-theme-accent/30 flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-theme-accent uppercase tracking-widest">
                    Orphaned Room
                  </h3>
                  <p className="text-[10px] text-theme-text/80 mt-1 leading-relaxed">
                    This room currently has no owner.
                  </p>
                </div>
                <button
                  onClick={() => {
                    sendCommand("claim_host", {});
                    onClose();
                  }}
                  className="px-4 py-2 bg-theme-accent text-theme-bg text-xs font-bold rounded-theme tracking-widest shadow-[var(--theme-shadow)] hover:shadow-[var(--theme-shadow-hover)] transition-all active:translate-y-0.5 active:shadow-none"
                >
                  CLAIM HOST
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="p-5 border-t-2 border-theme-border/30 bg-theme-bg/50 flex justify-end space-x-3">
          <button
            onClick={onClose}
            className="px-5 py-2.5 text-xs font-bold tracking-widest text-theme-muted hover:text-theme-text hover:bg-theme-bg/50 rounded-theme transition-all border-2 border-transparent hover:border-theme-border"
          >
            CANCEL
          </button>
          {isOwnerOrMod && (
            <button
              onClick={handleSave}
              className="flex items-center space-x-2 px-5 py-2.5 bg-theme-accent text-theme-bg text-xs font-bold tracking-widest rounded-theme transition-all shadow-[var(--theme-shadow)] hover:shadow-[var(--theme-shadow-hover)] active:translate-y-0.5 active:shadow-none"
            >
              <Save className="w-4 h-4" />
              <span>SAVE</span>
            </button>
          )}
        </div>
      </motion.div>
    </div>
  );
}
