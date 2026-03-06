"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useStore } from "@/lib/store";
import { motion } from "motion/react";
import { Users, Settings, Copy, Check, Zap, ListVideo } from "lucide-react";
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
      <main className="flex min-h-screen items-center justify-center bg-[#050505] p-4 relative overflow-hidden font-mono selection:bg-[#FF00FF] selection:text-white">
        {/* Brutalist Grid Background */}
        <div className="absolute inset-0 bg-[linear-gradient(rgba(0,229,255,0.05)_1px,transparent_1px),linear-gradient(90deg,rgba(0,229,255,0.05)_1px,transparent_1px)] bg-[size:40px_40px] pointer-events-none" />

        <motion.div
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          className="w-full max-w-md bg-[#050505] border-4 border-[#00E5FF] p-8 shadow-[12px_12px_0px_#FF00FF] relative z-10"
        >
          <div className="flex items-center justify-between mb-8 border-b-2 border-[#333333] pb-4">
            <div className="flex items-center space-x-3">
              <Zap className="w-8 h-8 text-[#00E5FF] fill-[#00E5FF]" />
              <h1 className="text-3xl font-bold text-white tracking-tighter uppercase drop-shadow-[0_0_10px_rgba(0,229,255,0.8)]">
                SyncWatch
              </h1>
            </div>
            <div className="text-[10px] text-[#FF00FF] border border-[#FF00FF] px-2 py-0.5 uppercase tracking-widest font-bold">
              v2.SYS
            </div>
          </div>

          <div className="bg-black border border-[#333333] p-4 mb-8">
            <p className="text-[#00E5FF] text-sm uppercase tracking-wider mb-2">
              <span className="text-white">&gt; </span> Initialize Connection
            </p>
            <p className="text-zinc-500 text-xs uppercase tracking-widest">
              Provide identification handle for Room Access.
            </p>
          </div>

          <form onSubmit={handleJoin} className="space-y-6">
            <div className="relative">
              <div className="absolute top-0 right-0 w-2 h-2 border-t-2 border-r-2 border-[#00E5FF]" />
              <div className="absolute bottom-0 left-0 w-2 h-2 border-b-2 border-l-2 border-[#00E5FF]" />

              <input
                type="text"
                value={tempName}
                onChange={(e) => setTempName(e.target.value)}
                placeholder="ENTER_HANDLE_"
                className="w-full bg-[#111111] border-2 border-transparent px-5 py-4 text-[#00E5FF] placeholder-zinc-700 focus:outline-none focus:border-[#00E5FF] transition-all uppercase font-bold tracking-widest"
                autoFocus
                maxLength={20}
              />
            </div>

            <button
              type="submit"
              disabled={!tempName.trim()}
              className="w-full py-4 px-4 bg-[#FF00FF] hover:bg-white text-black disabled:opacity-50 disabled:bg-[#333333] disabled:text-zinc-600 font-bold uppercase tracking-[0.2em] transition-colors border-2 border-transparent hover:border-black shadow-[4px_4px_0_#00E5FF] active:translate-y-1 active:shadow-none outline-none focus-visible:ring-4 ring-[#00E5FF]"
            >
              Establish Link
            </button>
          </form>
        </motion.div>
      </main>
    );
  }

  if (!isConnected || !room) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#050505] relative font-mono">
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,0,255,0.05)_1px,transparent_1px),linear-gradient(90deg,rgba(255,0,255,0.05)_1px,transparent_1px)] bg-[size:40px_40px] pointer-events-none" />
        <div className="flex flex-col items-center space-y-8 relative z-10 bg-black p-10 border-2 border-[#FF00FF] shadow-[10px_10px_0_#00E5FF]">
          <div className="w-16 h-16 border-4 border-[#00E5FF] border-t-transparent border-b-[#FF00FF] rounded-none animate-spin" />
          <div className="text-center">
            <p className="text-white font-bold tracking-[0.3em] uppercase mb-2 animate-pulse">
              Establishing Uplink
            </p>
            <p className="text-[#00E5FF] text-xs uppercase tracking-widest">
              Handshake in progress...
            </p>
          </div>
        </div>
      </main>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-[#050505] text-zinc-50 overflow-hidden font-mono selection:bg-[#FF00FF] selection:text-white">
      {/* Brutalist Header */}
      <header className="h-[72px] border-b-4 border-[#00E5FF] flex items-center justify-between px-4 lg:px-6 shrink-0 bg-[#050505] z-20 shadow-[0_4px_0_#FF00FF] relative">
        <div className="absolute top-0 right-0 w-32 h-full bg-[repeating-linear-gradient(45deg,transparent,transparent_4px,rgba(0,229,255,0.1)_4px,rgba(0,229,255,0.1)_8px)] pointer-events-none" />

        <div className="flex items-center space-x-6 relative z-10">
          <Link
            href="/"
            className="flex items-center space-x-3 text-white group outline-none focus-visible:ring-2 ring-[#00E5FF] ring-offset-4 ring-offset-[#050505]"
          >
            <div className="w-10 h-10 bg-[#FF00FF] text-black flex items-center justify-center group-hover:bg-white group-hover:text-black transition-colors shadow-[2px_2px_0_#00E5FF] group-active:translate-y-px group-active:shadow-none">
              <Zap className="w-6 h-6 fill-current" />
            </div>
            <span className="font-bold tracking-tighter text-xl hidden sm:block uppercase drop-shadow-[0_0_8px_rgba(255,0,255,0.5)]">
              SyncWatch
            </span>
          </Link>
          <div className="h-8 w-1 bg-[#333333] hidden sm:block transform -skew-x-12" />
          <div className="flex flex-col">
            <span className="text-[10px] text-[#00E5FF] uppercase tracking-widest font-bold mb-0.5">
              Active Terminal
            </span>
            <h2 className="font-bold text-white truncate max-w-[150px] sm:max-w-xs uppercase tracking-wide">
              {room.name}
            </h2>
          </div>
        </div>

        <div className="flex items-center space-x-4 relative z-10">
          <button
            onClick={copyInviteLink}
            className="flex items-center space-x-2 px-4 py-2.5 bg-black border-2 border-[#00E5FF] hover:bg-[#00E5FF] hover:text-black text-[#00E5FF] font-bold uppercase text-xs tracking-wider transition-all shadow-[2px_2px_0_#FF00FF] active:translate-y-px active:shadow-none outline-none focus-visible:ring-2 ring-white"
          >
            {copied ? (
              <Check className="w-4 h-4" />
            ) : (
              <Copy className="w-4 h-4" />
            )}
            <span className="hidden sm:block">
              {copied ? "DATA_COPIED" : "SHARE_LINK"}
            </span>
          </button>

          <button
            onClick={() => setIsSettingsOpen(true)}
            className="w-10 h-10 flex items-center justify-center border-2 border-[#333333] hover:border-[#FF00FF] text-zinc-400 hover:text-[#FF00FF] bg-black transition-all shadow-[2px_2px_0_#00E5FF] active:translate-y-px active:shadow-none outline-none focus-visible:ring-2 ring-white"
            title="SYSTEM_CONFIG"
          >
            <Settings className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex flex-1 overflow-hidden flex-col lg:flex-row relative mt-1 bg-[#111111]">
        {/* Background Decorative Grid */}
        <div className="absolute inset-0 bg-[linear-gradient(rgba(0,229,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(0,229,255,0.03)_1px,transparent_1px)] bg-[size:32px_32px] pointer-events-none" />

        {/* Player Area - Strict min-height to ensure dimensions > 0 immediately */}
        <div className="flex-1 flex flex-col min-h-[40vh] lg:min-h-0 relative z-10 p-2 lg:p-4">
          <div className="w-full h-full border-2 border-[#333333] shadow-[8px_8px_0_rgba(0,0,0,0.5)] bg-black overflow-hidden relative">
            <Player />

            {/* Architectural corner markers */}
            <div className="absolute top-0 left-0 w-4 h-4 border-t-2 border-l-2 border-[#00E5FF] pointer-events-none z-50"></div>
            <div className="absolute top-0 right-0 w-4 h-4 border-t-2 border-r-2 border-[#00E5FF] pointer-events-none z-50"></div>
            <div className="absolute bottom-0 left-0 w-4 h-4 border-b-2 border-l-2 border-[#00E5FF] pointer-events-none z-50"></div>
            <div className="absolute bottom-0 right-0 w-4 h-4 border-b-2 border-r-2 border-[#00E5FF] pointer-events-none z-50"></div>
          </div>
        </div>

        {/* Sidebar */}
        <div className="w-full lg:w-[400px] xl:w-[460px] flex flex-col shrink-0 h-[50vh] lg:h-auto z-20 p-2 lg:p-4 lg:pl-0 border-t-2 lg:border-t-0 border-[#333333]">
          <div className="flex-1 flex flex-col bg-black border-2 border-[#FF00FF] shadow-[8px_8px_0_#00E5FF]">
            {/* Brutalist Tabs */}
            <div className="flex border-b-2 border-[#FF00FF] shrink-0">
              <button
                onClick={() => setActiveTab("playlist")}
                className={`flex-1 py-4 px-4 text-xs font-bold uppercase tracking-[0.15em] flex items-center justify-center space-x-2 transition-all outline-none focus-visible:bg-white focus-visible:text-black
                  ${
                    activeTab === "playlist"
                      ? "bg-[#FF00FF] text-black shadow-[inset_0_-2px_0_#FFF]"
                      : "text-zinc-500 hover:text-[#FF00FF] hover:bg-[#111111]"
                  }`}
              >
                <ListVideo className="w-4 h-4" />
                <span>Queue</span>
              </button>
              <div className="w-0.5 bg-[#FF00FF]" />
              <button
                onClick={() => setActiveTab("participants")}
                className={`flex-1 py-4 px-4 text-xs font-bold uppercase tracking-[0.15em] flex items-center justify-center space-x-2 transition-all outline-none focus-visible:bg-white focus-visible:text-black
                  ${
                    activeTab === "participants"
                      ? "bg-[#FF00FF] text-black shadow-[inset_0_-2px_0_#FFF]"
                      : "text-zinc-500 hover:text-[#FF00FF] hover:bg-[#111111]"
                  }`}
              >
                <Users className="w-4 h-4" />
                <span>Entities ({Object.keys(room.participants).length})</span>
              </button>
            </div>

            {/* Tab Content Area */}
            <div className="flex-1 overflow-y-auto relative bg-[#050505] p-2">
              {activeTab === "playlist" ? <Playlist /> : <Participants />}
            </div>

            {/* Decorative Footer */}
            <div className="h-6 border-t-2 border-[#FF00FF] bg-[#050505] flex items-center px-3 justify-between">
              <div className="flex space-x-1">
                <div className="w-1.5 h-1.5 bg-[#00E5FF] animate-pulse"></div>
                <div className="w-1.5 h-1.5 bg-[#00E5FF] animate-pulse delay-75"></div>
                <div className="w-1.5 h-1.5 bg-[#00E5FF] animate-pulse delay-150"></div>
              </div>
              <span className="text-[9px] text-zinc-600 uppercase tracking-widest font-bold">
                Secure Connection
              </span>
            </div>
          </div>
        </div>
      </div>

      {isSettingsOpen && (
        <RoomSettingsDialog onClose={() => setIsSettingsOpen(false)} />
      )}
    </div>
  );
}
