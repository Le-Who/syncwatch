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
import Reactions from "@/components/Reactions";
import { useSettingsStore } from "@/lib/store";

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
    sendCommand,
    participantId,
  } = useStore();

  const [isJoining, setIsJoining] = useState(true);
  const [tempName, setTempName] = useState("");
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState<"playlist" | "participants">(
    "playlist",
  );
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isEditingRoomName, setIsEditingRoomName] = useState(false);
  const [editRoomName, setEditRoomName] = useState("");
  const { theaterMode } = useSettingsStore();

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

  const participant = room?.participants[participantId!];
  const canEditRoom =
    participant?.role === "owner" || participant?.role === "moderator";

  const handleRoomNameSubmit = () => {
    if (editRoomName.trim() && editRoomName !== room?.name && canEditRoom) {
      sendCommand("update_room_name", { name: editRoomName.trim() });
    }
    setIsEditingRoomName(false);
  };

  if (isJoining) {
    return (
      <main className="font-theme selection:bg-theme-accent selection:text-theme-bg relative flex min-h-screen items-center justify-center overflow-hidden bg-transparent p-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          className="theme-panel relative z-10 w-full max-w-md p-8"
        >
          <div className="border-theme-border/30 mb-8 flex items-center justify-between border-b-2 pb-4">
            <div className="flex items-center space-x-3">
              <Zap className="text-theme-accent fill-theme-accent h-8 w-8" />
              <h1 className="text-theme-text text-3xl font-bold tracking-tighter uppercase drop-shadow-md">
                SyncWatch
              </h1>
            </div>
            <div className="text-theme-accent border-theme-accent rounded-full border px-2 py-0.5 text-[10px] font-bold tracking-widest uppercase">
              v2.SYS
            </div>
          </div>

          <div className="bg-theme-bg/50 border-theme-border/30 rounded-theme mb-8 border p-4 backdrop-blur-sm">
            <p className="text-theme-accent mb-2 text-sm font-bold tracking-wider uppercase">
              <span className="text-theme-text">&gt; </span> Initialize
              Connection
            </p>
            <p className="text-theme-muted text-xs tracking-widest uppercase">
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
                className="bg-theme-bg/50 border-theme-border/50 rounded-theme text-theme-text placeholder-theme-muted focus:border-theme-accent w-full border-2 px-5 py-4 font-bold tracking-widest uppercase backdrop-blur-sm transition-all focus:shadow-[0_0_15px_var(--color-theme-accent)] focus:outline-none"
                autoFocus
                maxLength={20}
              />
            </div>

            <button
              type="submit"
              disabled={!tempName.trim()}
              className="bg-theme-accent text-theme-bg rounded-theme ring-theme-accent w-full border-2 border-transparent px-4 py-4 font-bold tracking-[0.2em] uppercase shadow-[var(--theme-shadow)] transition-all hover:-translate-y-0.5 hover:shadow-[var(--theme-shadow-hover)] focus-visible:ring-4 active:translate-y-0.5 active:shadow-none disabled:opacity-50"
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
      <main className="font-theme relative flex min-h-screen items-center justify-center bg-transparent">
        <div className="theme-panel relative z-10 flex flex-col items-center space-y-8 p-10">
          <div className="border-theme-accent border-b-theme-danger h-16 w-16 animate-spin rounded-full border-4 border-t-transparent" />
          <div className="text-center">
            <p className="text-theme-text mb-2 animate-pulse font-bold tracking-[0.3em] uppercase">
              Establishing Uplink
            </p>
            <p className="text-theme-muted text-xs tracking-widest uppercase">
              Handshake in progress...
            </p>
          </div>
        </div>
      </main>
    );
  }

  return (
    <div className="text-theme-text font-theme selection:bg-theme-accent selection:text-theme-bg flex h-screen flex-col overflow-hidden bg-transparent">
      {/* Header */}
      <header className="border-theme-border bg-theme-card relative z-20 flex h-[72px] shrink-0 items-center justify-between border-b-4 px-4 shadow-[0_4px_32px_var(--color-theme-shadow)] backdrop-blur-xl lg:px-6">
        <div className="relative z-10 flex items-center space-x-6">
          <Link
            href="/"
            className="text-theme-text group ring-theme-accent flex items-center space-x-3 outline-none focus-visible:ring-2"
          >
            <div className="bg-theme-accent text-theme-bg rounded-theme flex h-10 w-10 items-center justify-center shadow-[var(--theme-shadow)] transition-transform group-hover:scale-105 group-active:scale-95 group-active:shadow-none">
              <Zap className="h-6 w-6 fill-current" />
            </div>
            <span className="hidden text-xl font-bold tracking-tighter uppercase drop-shadow-sm sm:block">
              SyncWatch
            </span>
          </Link>
          <div className="bg-theme-border/30 hidden h-8 w-1 -skew-x-12 transform sm:block" />
          <div className="flex flex-col">
            <span className="text-theme-accent mb-0.5 text-[10px] font-bold tracking-widest uppercase">
              Active Terminal
            </span>
            {isEditingRoomName ? (
              <input
                value={editRoomName}
                onChange={(e) => setEditRoomName(e.target.value)}
                onBlur={handleRoomNameSubmit}
                onKeyDown={(e) => e.key === "Enter" && handleRoomNameSubmit()}
                autoFocus
                className="text-theme-text border-theme-accent w-full max-w-[150px] truncate border-b-2 bg-transparent font-bold tracking-wide uppercase focus:outline-none sm:max-w-xs"
              />
            ) : (
              <h2
                className={`text-theme-text max-w-[150px] truncate font-bold tracking-wide uppercase sm:max-w-xs ${
                  canEditRoom
                    ? "hover:text-theme-accent cursor-pointer transition-colors"
                    : ""
                }`}
                onClick={() => {
                  if (canEditRoom) {
                    setEditRoomName(room.name);
                    setIsEditingRoomName(true);
                  }
                }}
                title={canEditRoom ? "Click to rename room" : ""}
              >
                {room.name}
              </h2>
            )}
          </div>
        </div>

        <div className="relative z-10 flex items-center space-x-4">
          <button
            onClick={copyInviteLink}
            className="bg-theme-bg/50 border-theme-accent hover:bg-theme-accent hover:text-theme-bg text-theme-accent rounded-theme ring-theme-text flex items-center space-x-2 border-2 px-4 py-2.5 text-xs font-bold tracking-wider uppercase shadow-[var(--theme-shadow)] transition-all outline-none focus-visible:ring-2 active:translate-y-0.5 active:shadow-none"
          >
            {copied ? (
              <Check className="h-4 w-4" />
            ) : (
              <Copy className="h-4 w-4" />
            )}
            <span className="hidden sm:block">
              {copied ? "DATA_COPIED" : "SHARE_LINK"}
            </span>
          </button>

          <button
            onClick={() => setIsSettingsOpen(true)}
            className="border-theme-border/50 hover:border-theme-accent text-theme-muted hover:text-theme-accent bg-theme-bg/50 rounded-theme ring-theme-text flex h-10 w-10 items-center justify-center border-2 shadow-sm backdrop-blur-md transition-all outline-none focus-visible:ring-2"
            title="SYSTEM_CONFIG"
          >
            <Settings className="h-5 w-5" />
          </button>
        </div>
      </header>

      {/* Main Content */}
      <div className="relative mt-1 flex flex-1 flex-col overflow-hidden bg-transparent lg:flex-row">
        {/* Player Area */}
        <div className="relative z-10 flex min-h-[40vh] flex-1 flex-col p-2 transition-all duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] lg:min-h-0 lg:p-4">
          <div className="border-theme-border/50 bg-theme-bg rounded-theme relative h-full w-full overflow-hidden border-2 shadow-[var(--theme-shadow)]">
            <Player />
            <Reactions />
          </div>
        </div>

        {/* Sidebar */}
        <div
          className={`group/sidebar z-20 flex shrink-0 flex-col transition-all duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] ${
            theaterMode
              ? "absolute top-0 right-0 bottom-0 w-[90%] translate-x-[calc(100%-20px)] p-2 focus-within:translate-x-0 hover:translate-x-0 sm:w-[400px] lg:p-4 xl:w-[460px]"
              : "relative h-[50vh] w-full p-2 lg:h-auto lg:w-[400px] lg:p-4 lg:pl-0 xl:w-[460px]"
          } `}
        >
          {theaterMode && (
            <div className="bg-theme-accent/20 border-theme-accent/40 absolute top-1/2 left-0 z-50 flex h-32 w-5 -translate-y-1/2 cursor-pointer items-center justify-center rounded-l-md border-y border-l opacity-100 backdrop-blur-md transition-opacity group-hover/sidebar:opacity-0">
              <div className="bg-theme-accent h-10 w-1 animate-pulse rounded-full"></div>
            </div>
          )}
          <div
            className={`flex flex-1 flex-col overflow-hidden transition-all duration-700 ${
              theaterMode
                ? "bg-theme-bg/95 border-theme-border/50 rounded-theme ml-4 border-2 shadow-[-20px_0_40px_rgba(0,0,0,0.5)] backdrop-blur-2xl"
                : "theme-panel"
            }`}
          >
            {/* Tabs */}
            <div className="border-theme-border flex shrink-0 border-b-2">
              <button
                onClick={() => setActiveTab("playlist")}
                className={`flex flex-1 items-center justify-center space-x-2 px-4 py-4 text-xs font-bold tracking-[0.15em] uppercase transition-all outline-none ${
                  activeTab === "playlist"
                    ? "bg-theme-accent text-theme-bg shadow-inner"
                    : "text-theme-muted hover:text-theme-accent hover:bg-theme-border/10"
                }`}
              >
                <ListVideo className="h-4 w-4" />
                <span>Queue</span>
              </button>
              <div className="bg-theme-border w-0.5" />
              <button
                onClick={() => setActiveTab("participants")}
                className={`flex flex-1 items-center justify-center space-x-2 px-4 py-4 text-xs font-bold tracking-[0.15em] uppercase transition-all outline-none ${
                  activeTab === "participants"
                    ? "bg-theme-accent text-theme-bg shadow-inner"
                    : "text-theme-muted hover:text-theme-accent hover:bg-theme-border/10"
                }`}
              >
                <Users className="h-4 w-4" />
                <span>Entities ({Object.keys(room.participants).length})</span>
              </button>
            </div>

            {/* Tab Content Area */}
            <div className="relative flex-1 overflow-y-auto bg-transparent p-2">
              {activeTab === "playlist" ? <Playlist /> : <Participants />}
            </div>

            {/* Decorative Footer */}
            <div className="border-theme-border/30 bg-theme-bg/30 flex h-6 items-center justify-between border-t-[1px] px-3">
              <div className="flex space-x-1">
                <div className="bg-theme-accent h-1.5 w-1.5 animate-pulse rounded-full"></div>
                <div className="bg-theme-accent h-1.5 w-1.5 animate-pulse rounded-full delay-75"></div>
                <div className="bg-theme-accent h-1.5 w-1.5 animate-pulse rounded-full delay-150"></div>
              </div>
              <span className="text-theme-muted text-[9px] font-bold tracking-widest uppercase">
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
