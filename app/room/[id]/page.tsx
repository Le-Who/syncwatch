"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useStore } from "@/lib/store";
import { motion } from "motion/react";
import {
  Users,
  Settings,
  Copy,
  Check,
  PlaySquare,
  ListVideo,
} from "lucide-react";
import Player from "@/components/Player";
import Playlist from "@/components/Playlist";
import Participants from "@/components/Participants";
import RoomSettingsDialog from "@/components/RoomSettingsDialog";

export default function RoomPage() {
  const params = useParams();
  const roomId = params.id as string;
  const {
    room,
    isConnected,
    nickname,
    setNickname,
    connect,
    disconnect,
    init,
  } = useStore();

  const [isJoining, setIsJoining] = useState(true);
  const [tempName, setTempName] = useState("");
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState<"playlist" | "participants">(
    "playlist",
  );
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  useEffect(() => {
    init();
  }, [init]);

  useEffect(() => {
    if (nickname) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTempName(nickname);
    }
  }, [nickname]);

  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault();
    if (tempName.trim()) {
      setNickname(tempName.trim());
      connect(roomId, tempName.trim());
      setIsJoining(false);
    }
  };

  const copyInviteLink = () => {
    const url = `${window.location.origin}/room/${roomId}`;
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (isJoining) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-zinc-950 p-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-2xl p-8 shadow-2xl"
        >
          <h1 className="text-2xl font-bold text-white mb-2">Join Room</h1>
          <p className="text-zinc-400 mb-6">
            Enter a nickname to join the watch party.
          </p>

          <form onSubmit={handleJoin} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-zinc-300 mb-1">
                Nickname
              </label>
              <input
                type="text"
                value={tempName}
                onChange={(e) => setTempName(e.target.value)}
                placeholder="e.g. MovieBuff99"
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-white placeholder-zinc-600 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                autoFocus
                maxLength={20}
              />
            </div>
            <button
              type="submit"
              disabled={!tempName.trim()}
              className="w-full py-3 px-4 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl font-medium transition-colors"
            >
              Join
            </button>
          </form>
        </motion.div>
      </main>
    );
  }

  if (!isConnected || !room) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-zinc-950">
        <div className="flex flex-col items-center space-y-4">
          <div className="w-8 h-8 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-zinc-400">Connecting to room...</p>
        </div>
      </main>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-zinc-950 text-zinc-50 overflow-hidden">
      {/* Header */}
      <header className="h-16 border-b border-zinc-800 flex items-center justify-between px-4 lg:px-6 shrink-0 bg-zinc-900/50">
        <div className="flex items-center space-x-4">
          <Link
            href="/"
            className="flex items-center space-x-2 text-white hover:text-indigo-400 transition-colors"
          >
            <PlaySquare className="w-6 h-6" />
            <span className="font-bold text-lg hidden sm:block">SyncWatch</span>
          </Link>
          <div className="h-6 w-px bg-zinc-800 hidden sm:block" />
          <h2 className="font-medium text-zinc-200 truncate max-w-[200px] sm:max-w-xs">
            {room.name}
          </h2>
        </div>

        <div className="flex items-center space-x-2 sm:space-x-3">
          <button
            onClick={copyInviteLink}
            className="flex items-center space-x-2 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-sm font-medium transition-colors"
          >
            {copied ? (
              <Check className="w-4 h-4 text-emerald-400" />
            ) : (
              <Copy className="w-4 h-4" />
            )}
            <span className="hidden sm:block">
              {copied ? "Copied!" : "Invite"}
            </span>
          </button>

          <button
            onClick={() => setIsSettingsOpen(true)}
            className="p-1.5 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-lg transition-colors"
            title="Room Settings"
          >
            <Settings className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex flex-1 overflow-hidden flex-col lg:flex-row">
        {/* Player Area */}
        <div className="flex-1 flex flex-col min-h-[40vh] lg:min-h-0 relative bg-black">
          <Player />
        </div>

        {/* Sidebar */}
        <div className="w-full lg:w-80 xl:w-96 border-l border-zinc-800 bg-zinc-900/30 flex flex-col shrink-0 h-[50vh] lg:h-auto">
          {/* Tabs */}
          <div className="flex border-b border-zinc-800 shrink-0">
            <button
              onClick={() => setActiveTab("playlist")}
              className={`flex-1 py-3 text-sm font-medium flex items-center justify-center space-x-2 border-b-2 transition-colors ${
                activeTab === "playlist"
                  ? "border-indigo-500 text-white"
                  : "border-transparent text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50"
              }`}
            >
              <ListVideo className="w-4 h-4" />
              <span>Playlist</span>
            </button>
            <button
              onClick={() => setActiveTab("participants")}
              className={`flex-1 py-3 text-sm font-medium flex items-center justify-center space-x-2 border-b-2 transition-colors ${
                activeTab === "participants"
                  ? "border-indigo-500 text-white"
                  : "border-transparent text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50"
              }`}
            >
              <Users className="w-4 h-4" />
              <span>Users ({Object.keys(room.participants).length})</span>
            </button>
          </div>

          {/* Tab Content */}
          <div className="flex-1 overflow-y-auto">
            {activeTab === "playlist" ? <Playlist /> : <Participants />}
          </div>
        </div>
      </div>

      {isSettingsOpen && (
        <RoomSettingsDialog onClose={() => setIsSettingsOpen(false)} />
      )}
    </div>
  );
}
