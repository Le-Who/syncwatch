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

  const handleSave = () => {
    if (isOwnerOrMod) {
      sendCommand("update_settings", { settings });
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Cinematic dark overlay */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-md"
        onClick={onClose}
      />

      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 10 }}
        transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
        className="w-full max-w-md bg-[#0a0a0a]/90 backdrop-blur-3xl border border-white/10 rounded-3xl shadow-2xl overflow-hidden relative z-10"
      >
        <div className="flex items-center justify-between p-5 border-b border-white/5 bg-white/[0.02]">
          <h2 className="text-lg font-semibold text-white tracking-wide">
            Room Settings
          </h2>
          <button
            onClick={onClose}
            className="p-2 text-zinc-400 hover:text-white hover:bg-white/10 rounded-xl transition-all"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-8">
          <div className="space-y-5">
            <h3 className="text-xs font-semibold text-indigo-400 uppercase tracking-widest">
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
                    className="w-4 h-4 text-indigo-500 focus:ring-indigo-500/50 bg-[#111] border-white/20 focus:ring-offset-0 focus:ring-offset-transparent transition-all"
                  />
                </div>
                <div>
                  <p className="text-sm font-medium text-zinc-200 group-hover:text-white transition-colors">
                    Open Room
                  </p>
                  <p className="text-[13px] text-zinc-500 font-light mt-0.5 leading-relaxed">
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
                    className="w-4 h-4 text-indigo-500 focus:ring-indigo-500/50 bg-[#111] border-white/20 focus:ring-offset-0 focus:ring-offset-transparent transition-all"
                  />
                </div>
                <div>
                  <p className="text-sm font-medium text-zinc-200 group-hover:text-white transition-colors">
                    Hybrid Room
                  </p>
                  <p className="text-[13px] text-zinc-500 font-light mt-0.5 leading-relaxed">
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
                    className="w-4 h-4 text-indigo-500 focus:ring-indigo-500/50 bg-[#111] border-white/20 focus:ring-offset-0 focus:ring-offset-transparent transition-all"
                  />
                </div>
                <div>
                  <p className="text-sm font-medium text-zinc-200 group-hover:text-white transition-colors">
                    Controlled Room
                  </p>
                  <p className="text-[13px] text-zinc-500 font-light mt-0.5 leading-relaxed">
                    Only moderators can control playback and edit the playlist.
                  </p>
                </div>
              </label>
            </div>
          </div>

          <div className="space-y-5 pt-6 border-t border-white/5">
            <h3 className="text-xs font-semibold text-indigo-400 uppercase tracking-widest">
              Playback
            </h3>

            <label className="flex items-center justify-between cursor-pointer group">
              <div className="pr-4">
                <p className="text-sm font-medium text-zinc-200 group-hover:text-white transition-colors">
                  Autoplay Next
                </p>
                <p className="text-[13px] text-zinc-500 font-light mt-0.5 leading-relaxed">
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
                className="w-5 h-5 text-indigo-500 focus:ring-indigo-500/50 bg-[#111] border-white/20 rounded-md focus:ring-offset-0 transition-all"
              />
            </label>

            <label className="flex items-center justify-between cursor-pointer group">
              <div className="pr-4">
                <p className="text-sm font-medium text-zinc-200 group-hover:text-white transition-colors">
                  Loop Playlist
                </p>
                <p className="text-[13px] text-zinc-500 font-light mt-0.5 leading-relaxed">
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
                className="w-5 h-5 text-indigo-500 focus:ring-indigo-500/50 bg-[#111] border-white/20 rounded-md focus:ring-offset-0 transition-all"
              />
            </label>
          </div>
        </div>

        <div className="p-5 border-t border-white/5 bg-black/40 flex justify-end space-x-3">
          <button
            onClick={onClose}
            className="px-5 py-2.5 text-sm font-bold text-zinc-400 hover:text-white hover:bg-white/10 rounded-xl transition-all"
          >
            Cancel
          </button>
          {isOwnerOrMod && (
            <button
              onClick={handleSave}
              className="flex items-center space-x-2 px-5 py-2.5 bg-white text-black hover:bg-zinc-200 text-sm font-bold rounded-xl transition-all shadow-[0_0_20px_rgba(255,255,255,0.1)] hover:shadow-[0_0_30px_rgba(255,255,255,0.2)] active:scale-[0.98]"
            >
              <Save className="w-4 h-4" />
              <span>Save Changes</span>
            </button>
          )}
        </div>
      </motion.div>
    </div>
  );
}
