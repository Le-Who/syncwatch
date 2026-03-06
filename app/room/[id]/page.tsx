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
      <main className="flex min-h-screen items-center justify-center bg-[#050505] p-4 relative overflow-hidden">
        {/* Cinematic ambient glow */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[60vw] h-[60vw] bg-indigo-600/10 rounded-full blur-[120px] pointer-events-none" />

        <motion.div
          initial={{ opacity: 0, y: 20, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          className="w-full max-w-md bg-[#0a0a0a]/80 backdrop-blur-3xl border border-white/5 rounded-3xl p-8 shadow-2xl relative z-10"
        >
          <div className="flex items-center space-x-3 mb-8">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-[0_0_20px_rgba(99,102,241,0.3)]">
              <PlaySquare className="w-5 h-5 text-white" />
            </div>
            <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-zinc-400">
              Join Room
            </h1>
          </div>
          <p className="text-zinc-400 mb-8 font-light">
            Enter a nickname to join this SyncWatch party.
          </p>

          <form onSubmit={handleJoin} className="space-y-6">
            <div className="group">
              <input
                type="text"
                value={tempName}
                onChange={(e) => setTempName(e.target.value)}
                placeholder="Nickname"
                className="w-full bg-[#111111] border border-white/10 rounded-2xl px-5 py-4 text-white placeholder-zinc-600 focus:outline-none focus:border-indigo-500/50 focus:bg-[#151515] transition-all"
                autoFocus
                maxLength={20}
              />
            </div>
            <button
              type="submit"
              disabled={!tempName.trim()}
              className="w-full py-4 px-4 bg-white hover:bg-zinc-200 disabled:opacity-50 disabled:cursor-not-allowed text-black rounded-2xl font-bold transition-all shadow-[0_0_30px_rgba(255,255,255,0.1)] hover:shadow-[0_0_40px_rgba(255,255,255,0.2)] active:scale-[0.98]"
            >
              Enter Room
            </button>
          </form>
        </motion.div>
      </main>
    );
  }

  if (!isConnected || !room) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#050505] relative">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[40vw] h-[40vw] bg-indigo-500/5 rounded-full blur-[100px]" />
        <div className="flex flex-col items-center space-y-6 relative z-10">
          <div className="w-12 h-12 border-2 border-white/10 border-t-white rounded-full animate-spin" />
          <p className="text-zinc-500 font-medium tracking-wide">CONNECTING</p>
        </div>
      </main>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-[#050505] text-zinc-50 overflow-hidden font-sans">
      {/* Header */}
      <header className="h-16 border-b border-white/5 flex items-center justify-between px-4 lg:px-8 shrink-0 bg-[#0a0a0a]/50 backdrop-blur-xl z-20">
        <div className="flex items-center space-x-6">
          <Link
            href="/"
            className="flex items-center space-x-3 text-white group"
          >
            <div className="w-8 h-8 rounded-lg bg-indigo-600/20 text-indigo-400 flex items-center justify-center group-hover:bg-indigo-500 group-hover:text-white transition-all">
              <PlaySquare className="w-4 h-4" />
            </div>
            <span className="font-bold tracking-tight hidden sm:block">
              SyncWatch
            </span>
          </Link>
          <div className="h-4 w-px bg-white/10 hidden sm:block" />
          <h2 className="font-medium text-zinc-300 truncate max-w-[200px] sm:max-w-xs">
            {room.name}
          </h2>
        </div>

        <div className="flex items-center space-x-3 sm:space-x-4">
          <button
            onClick={copyInviteLink}
            className="flex items-center space-x-2 px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/5 rounded-xl text-sm font-medium transition-all"
          >
            {copied ? (
              <Check className="w-4 h-4 text-emerald-400" />
            ) : (
              <Copy className="w-4 h-4 text-zinc-400" />
            )}
            <span className="hidden sm:block text-zinc-300">
              {copied ? "Copied!" : "Invite"}
            </span>
          </button>

          <button
            onClick={() => setIsSettingsOpen(true)}
            className="p-2 text-zinc-400 hover:text-white hover:bg-white/5 rounded-xl transition-all"
            title="Room Settings"
          >
            <Settings className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex flex-1 overflow-hidden flex-col lg:flex-row relative">
        {/* Player Glow Background (Cinematic) */}
        {room.playback.status === "playing" && (
          <div className="absolute min-w-[50vw] h-[50vw] left-1/4 top-1/4 -translate-y-1/4 -translate-x-1/4 bg-white/5 rounded-full blur-[150px] pointer-events-none transition-opacity duration-1000 opacity-100" />
        )}

        {/* Player Area */}
        <div className="flex-1 flex flex-col min-h-[40vh] lg:min-h-0 relative bg-black/50 z-10 shadow-[20px_0_50px_rgba(0,0,0,0.5)]">
          <Player />
        </div>

        {/* Sidebar */}
        <div className="w-full lg:w-[400px] xl:w-[440px] border-l border-white/5 bg-[#0a0a0a]/80 backdrop-blur-3xl flex flex-col shrink-0 h-[50vh] lg:h-auto z-20">
          {/* Tabs */}
          <div className="flex border-b border-white/5 shrink-0 px-2 pt-2 gap-2">
            <button
              onClick={() => setActiveTab("playlist")}
              className={`flex-1 py-3 px-4 text-sm font-medium flex items-center justify-center space-x-2 rounded-t-xl transition-all ${
                activeTab === "playlist"
                  ? "bg-white/5 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.1)]"
                  : "text-zinc-500 hover:text-zinc-300 hover:bg-white/[0.02]"
              }`}
            >
              <ListVideo className="w-4 h-4" />
              <span>Playlist</span>
            </button>
            <button
              onClick={() => setActiveTab("participants")}
              className={`flex-1 py-3 px-4 text-sm font-medium flex items-center justify-center space-x-2 rounded-t-xl transition-all ${
                activeTab === "participants"
                  ? "bg-white/5 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.1)]"
                  : "text-zinc-500 hover:text-zinc-300 hover:bg-white/[0.02]"
              }`}
            >
              <Users className="w-4 h-4" />
              <span>Users ({Object.keys(room.participants).length})</span>
            </button>
          </div>

          {/* Tab Content */}
          <div className="flex-1 overflow-y-auto relative">
            {/* Top inner shadow for depth */}
            <div className="absolute top-0 left-0 right-0 h-4 bg-gradient-to-b from-black/20 to-transparent pointer-events-none z-10" />
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
