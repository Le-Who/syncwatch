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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl overflow-hidden"
      >
        <div className="flex items-center justify-between p-4 border-b border-zinc-800">
          <h2 className="text-lg font-semibold text-white">Room Settings</h2>
          <button
            onClick={onClose}
            className="p-2 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          <div className="space-y-4">
            <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider">
              Permissions
            </h3>

            <div className="space-y-3">
              <label className="flex items-start space-x-3 cursor-pointer group">
                <input
                  type="radio"
                  name="controlMode"
                  value="open"
                  checked={settings.controlMode === "open"}
                  onChange={() =>
                    setSettings({ ...settings, controlMode: "open" })
                  }
                  disabled={!isOwnerOrMod}
                  className="mt-1 text-indigo-600 focus:ring-indigo-500 bg-zinc-950 border-zinc-700"
                />
                <div>
                  <p className="text-sm font-medium text-zinc-200 group-hover:text-white transition-colors">
                    Open Room
                  </p>
                  <p className="text-xs text-zinc-500">
                    Everyone can control playback and edit the playlist.
                  </p>
                </div>
              </label>

              <label className="flex items-start space-x-3 cursor-pointer group">
                <input
                  type="radio"
                  name="controlMode"
                  value="hybrid"
                  checked={settings.controlMode === "hybrid"}
                  onChange={() =>
                    setSettings({ ...settings, controlMode: "hybrid" })
                  }
                  disabled={!isOwnerOrMod}
                  className="mt-1 text-indigo-600 focus:ring-indigo-500 bg-zinc-950 border-zinc-700"
                />
                <div>
                  <p className="text-sm font-medium text-zinc-200 group-hover:text-white transition-colors">
                    Hybrid Room
                  </p>
                  <p className="text-xs text-zinc-500">
                    Everyone can play/pause, but only moderators can edit the
                    playlist.
                  </p>
                </div>
              </label>

              <label className="flex items-start space-x-3 cursor-pointer group">
                <input
                  type="radio"
                  name="controlMode"
                  value="controlled"
                  checked={settings.controlMode === "controlled"}
                  onChange={() =>
                    setSettings({ ...settings, controlMode: "controlled" })
                  }
                  disabled={!isOwnerOrMod}
                  className="mt-1 text-indigo-600 focus:ring-indigo-500 bg-zinc-950 border-zinc-700"
                />
                <div>
                  <p className="text-sm font-medium text-zinc-200 group-hover:text-white transition-colors">
                    Controlled Room
                  </p>
                  <p className="text-xs text-zinc-500">
                    Only moderators can control playback and edit the playlist.
                  </p>
                </div>
              </label>
            </div>
          </div>

          <div className="space-y-4 pt-4 border-t border-zinc-800">
            <h3 className="text-sm font-medium text-zinc-400 uppercase tracking-wider">
              Playback
            </h3>

            <label className="flex items-center justify-between cursor-pointer group">
              <div>
                <p className="text-sm font-medium text-zinc-200 group-hover:text-white transition-colors">
                  Autoplay Next
                </p>
                <p className="text-xs text-zinc-500">
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
                className="w-4 h-4 text-indigo-600 focus:ring-indigo-500 bg-zinc-950 border-zinc-700 rounded"
              />
            </label>

            <label className="flex items-center justify-between cursor-pointer group">
              <div>
                <p className="text-sm font-medium text-zinc-200 group-hover:text-white transition-colors">
                  Loop Playlist
                </p>
                <p className="text-xs text-zinc-500">
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
                className="w-4 h-4 text-indigo-600 focus:ring-indigo-500 bg-zinc-950 border-zinc-700 rounded"
              />
            </label>
          </div>
        </div>

        <div className="p-4 border-t border-zinc-800 bg-zinc-900 flex justify-end space-x-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-zinc-300 hover:text-white hover:bg-zinc-800 rounded-lg transition-colors"
          >
            Cancel
          </button>
          {isOwnerOrMod && (
            <button
              onClick={handleSave}
              className="flex items-center space-x-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg transition-colors"
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
