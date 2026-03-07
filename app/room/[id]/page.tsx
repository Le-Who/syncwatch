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
      <main className="flex min-h-screen items-center justify-center bg-transparent p-4 relative overflow-hidden font-theme selection:bg-theme-accent selection:text-theme-bg">
        <motion.div
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          className="w-full max-w-md theme-panel p-8 relative z-10"
        >
          <div className="flex items-center justify-between mb-8 border-b-2 border-theme-border/30 pb-4">
            <div className="flex items-center space-x-3">
              <Zap className="w-8 h-8 text-theme-accent fill-theme-accent" />
              <h1 className="text-3xl font-bold text-theme-text tracking-tighter uppercase drop-shadow-md">
                SyncWatch
              </h1>
            </div>
            <div className="text-[10px] text-theme-accent border border-theme-accent px-2 py-0.5 uppercase tracking-widest font-bold rounded-full">
              v2.SYS
            </div>
          </div>

          <div className="bg-theme-bg/50 backdrop-blur-sm border border-theme-border/30 p-4 mb-8 rounded-theme">
            <p className="text-theme-accent text-sm uppercase tracking-wider mb-2 font-bold">
              <span className="text-theme-text">&gt; </span> Initialize
              Connection
            </p>
            <p className="text-theme-muted text-xs uppercase tracking-widest">
              Provide identification handle for Room Access.
            </p>
          </div>

          <form onSubmit={handleJoin} className="space-y-6">
            <div className="relative">
              <input
                type="text"
                value={tempName}
                onChange={(e) => setTempName(e.target.value)}
                placeholder="ENTER_HANDLE"
                className="w-full bg-theme-bg/50 backdrop-blur-sm border-2 border-theme-border/50 rounded-theme px-5 py-4 text-theme-text placeholder-theme-muted focus:outline-none focus:border-theme-accent focus:shadow-[0_0_15px_var(--color-theme-accent)] transition-all uppercase font-bold tracking-widest"
                autoFocus
                maxLength={20}
              />
            </div>

            <button
              type="submit"
              disabled={!tempName.trim()}
              className="w-full py-4 px-4 bg-theme-accent text-theme-bg disabled:opacity-50 font-bold uppercase tracking-[0.2em] transition-all rounded-theme shadow-[var(--theme-shadow)] hover:shadow-[var(--theme-shadow-hover)] hover:-translate-y-0.5 active:translate-y-0.5 active:shadow-none focus-visible:ring-4 ring-theme-accent border-2 border-transparent"
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
      <main className="flex min-h-screen items-center justify-center bg-transparent relative font-theme">
        <div className="flex flex-col items-center space-y-8 relative z-10 theme-panel p-10">
          <div className="w-16 h-16 border-4 border-theme-accent border-t-transparent border-b-theme-danger rounded-full animate-spin" />
          <div className="text-center">
            <p className="text-theme-text font-bold tracking-[0.3em] uppercase mb-2 animate-pulse">
              Establishing Uplink
            </p>
            <p className="text-theme-muted text-xs uppercase tracking-widest">
              Handshake in progress...
            </p>
          </div>
        </div>
      </main>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-transparent text-theme-text overflow-hidden font-theme selection:bg-theme-accent selection:text-theme-bg">
      {/* Header */}
      <header className="h-[72px] border-b-4 border-theme-border flex items-center justify-between px-4 lg:px-6 shrink-0 bg-theme-card backdrop-blur-xl z-20 shadow-[0_4px_32px_var(--color-theme-shadow)] relative">
        <div className="flex items-center space-x-6 relative z-10">
          <Link
            href="/"
            className="flex items-center space-x-3 text-theme-text group outline-none focus-visible:ring-2 ring-theme-accent"
          >
            <div className="w-10 h-10 bg-theme-accent text-theme-bg flex items-center justify-center rounded-theme transition-transform group-hover:scale-105 shadow-[var(--theme-shadow)] group-active:scale-95 group-active:shadow-none">
              <Zap className="w-6 h-6 fill-current" />
            </div>
            <span className="font-bold tracking-tighter text-xl hidden sm:block uppercase drop-shadow-sm">
              SyncWatch
            </span>
          </Link>
          <div className="h-8 w-1 bg-theme-border/30 hidden sm:block transform -skew-x-12" />
          <div className="flex flex-col">
            <span className="text-[10px] text-theme-accent uppercase tracking-widest font-bold mb-0.5">
              Active Terminal
            </span>
            <h2 className="font-bold text-theme-text truncate max-w-[150px] sm:max-w-xs uppercase tracking-wide">
              {room.name}
            </h2>
          </div>
        </div>

        <div className="flex items-center space-x-4 relative z-10">
          <button
            onClick={copyInviteLink}
            className="flex items-center space-x-2 px-4 py-2.5 bg-theme-bg/50 border-2 border-theme-accent hover:bg-theme-accent hover:text-theme-bg text-theme-accent font-bold uppercase text-xs tracking-wider transition-all rounded-theme shadow-[var(--theme-shadow)] active:translate-y-0.5 active:shadow-none outline-none focus-visible:ring-2 ring-theme-text"
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
            className="w-10 h-10 flex items-center justify-center border-2 border-theme-border/50 hover:border-theme-accent text-theme-muted hover:text-theme-accent bg-theme-bg/50 backdrop-blur-md rounded-theme transition-all shadow-sm outline-none focus-visible:ring-2 ring-theme-text"
            title="SYSTEM_CONFIG"
          >
            <Settings className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex flex-1 overflow-hidden flex-col lg:flex-row relative mt-1 bg-transparent">
        {/* Player Area */}
        <div className="flex-1 flex flex-col min-h-[40vh] lg:min-h-0 relative z-10 p-2 lg:p-4">
          <div className="w-full h-full border-2 border-theme-border/50 shadow-[var(--theme-shadow)] bg-theme-bg rounded-theme overflow-hidden relative">
            <Player />
          </div>
        </div>

        {/* Sidebar */}
        <div className="w-full lg:w-[400px] xl:w-[460px] flex flex-col shrink-0 h-[50vh] lg:h-auto z-20 p-2 lg:p-4 lg:pl-0">
          <div className="flex-1 flex flex-col theme-panel overflow-hidden">
            {/* Tabs */}
            <div className="flex border-b-2 border-theme-border shrink-0">
              <button
                onClick={() => setActiveTab("playlist")}
                className={`flex-1 py-4 px-4 text-xs font-bold uppercase tracking-[0.15em] flex items-center justify-center space-x-2 transition-all outline-none 
                  ${
                    activeTab === "playlist"
                      ? "bg-theme-accent text-theme-bg shadow-inner"
                      : "text-theme-muted hover:text-theme-accent hover:bg-theme-border/10"
                  }`}
              >
                <ListVideo className="w-4 h-4" />
                <span>Queue</span>
              </button>
              <div className="w-0.5 bg-theme-border" />
              <button
                onClick={() => setActiveTab("participants")}
                className={`flex-1 py-4 px-4 text-xs font-bold uppercase tracking-[0.15em] flex items-center justify-center space-x-2 transition-all outline-none 
                  ${
                    activeTab === "participants"
                      ? "bg-theme-accent text-theme-bg shadow-inner"
                      : "text-theme-muted hover:text-theme-accent hover:bg-theme-border/10"
                  }`}
              >
                <Users className="w-4 h-4" />
                <span>Entities ({Object.keys(room.participants).length})</span>
              </button>
            </div>

            {/* Tab Content Area */}
            <div className="flex-1 overflow-y-auto relative bg-transparent p-2">
              {activeTab === "playlist" ? <Playlist /> : <Participants />}
            </div>

            {/* Decorative Footer */}
            <div className="h-6 border-t-[1px] border-theme-border/30 bg-theme-bg/30 flex items-center px-3 justify-between">
              <div className="flex space-x-1">
                <div className="w-1.5 h-1.5 bg-theme-accent animate-pulse rounded-full"></div>
                <div className="w-1.5 h-1.5 bg-theme-accent animate-pulse delay-75 rounded-full"></div>
                <div className="w-1.5 h-1.5 bg-theme-accent animate-pulse delay-150 rounded-full"></div>
              </div>
              <span className="text-[9px] text-theme-muted uppercase tracking-widest font-bold">
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
