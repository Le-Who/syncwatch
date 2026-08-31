"use client";

import { useState, useRef, useEffect } from "react";
import { useStore } from "@/lib/store";
import {
  User,
  Crown,
  Shield,
  MoreVertical,
  ShieldPlus,
  ShieldMinus,
  RadioTower,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";

export default function Participants() {
  const { room, participantId, setNickname, sendCommand } = useStore();
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpenMenuId(null);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  if (!room) return null;

  const currentUserRole =
    room.participants[participantId || ""]?.role || "viewer";
  const isOwner = currentUserRole === "owner";
  const isOwnerOrMod = currentUserRole === "owner" || currentUserRole === "moderator";
  const isLeader = room.leaderId === participantId;
  const leader = room.leaderId ? room.participants[room.leaderId] : null;
  const canReleaseActiveLeader = Boolean(leader && (isLeader || isOwnerOrMod));
  const canRequestLeader = !leader;
  const leaderButtonDisabled = !canReleaseActiveLeader && !canRequestLeader;
  const leaderButtonLabel = canReleaseActiveLeader
    ? "Release"
    : canRequestLeader
      ? "Lead"
      : "Taken";

  const participants = Object.values(room.participants).sort((a, b) => {
    const roles = { owner: 3, moderator: 2, viewer: 1 };
    const wA = roles[a.role as keyof typeof roles] || 0;
    const wB = roles[b.role as keyof typeof roles] || 0;
    if (wA !== wB) return wB - wA;
    return a.nickname.localeCompare(b.nickname);
  });

  const handleRoleChange = (targetParticipantId: string, newRole: string) => {
    sendCommand("update_role", {
      targetParticipantId,
      role: newRole,
    });
    setOpenMenuId(null);
  };

  const handleTransferOwner = (targetParticipantId: string) => {
    sendCommand("transfer_owner", { targetParticipantId });
    setOpenMenuId(null);
  };

  return (
    <div
      className="scrollbar-thin scrollbar-thumb-theme-accent/50 scrollbar-track-transparent flex h-full flex-col overflow-y-auto bg-transparent p-4"
      onClick={() => setOpenMenuId(null)}
    >
      <div className="border-theme-border/30 bg-theme-bg/35 rounded-theme mb-4 flex items-center justify-between border-2 p-3">
        <div className="min-w-0">
          <p className="text-theme-muted text-[10px] font-bold tracking-widest uppercase">
            Leader
          </p>
          <p className="text-theme-text truncate text-sm font-bold">
            {leader ? leader.nickname : "No active leader"}
          </p>
        </div>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            if (canReleaseActiveLeader) {
              sendCommand("release_leader", {});
            } else if (canRequestLeader) {
              sendCommand("request_leader", {});
            }
          }}
          disabled={leaderButtonDisabled}
          aria-label={
            canReleaseActiveLeader
              ? "Release leader"
              : canRequestLeader
                ? "Request leader"
                : "Leader already active"
          }
          className={`rounded-theme ring-theme-accent flex h-10 items-center gap-2 border-2 px-3 text-xs font-bold tracking-widest uppercase outline-none focus-visible:ring-2 ${
            canReleaseActiveLeader
              ? "border-theme-danger text-theme-danger hover:bg-theme-danger/10"
              : leaderButtonDisabled
                ? "border-theme-border text-theme-muted cursor-not-allowed opacity-60"
              : "border-theme-accent text-theme-accent hover:bg-theme-accent/10"
          }`}
        >
          <RadioTower className="h-4 w-4" />
          <span>{leaderButtonLabel}</span>
        </button>
      </div>

      <div className="space-y-3">
        {participants.map((p) => (
          <div
            key={p.id}
            className={`rounded-theme participant-item relative flex items-center justify-between border-2 p-3.5 transition-all ${p.disconnected ? 'opacity-50' : ''} ${
              p.id === participantId
                ? "bg-theme-accent/20 border-theme-accent shadow-theme"
                : p.disconnected
                  ? "bg-theme-bg/20 border-red-500/30"
                  : "bg-theme-bg/40 border-theme-border/30 hover:bg-theme-bg/60 hover:border-theme-accent"
            }`}
          >
            <div className="flex min-w-0 items-center space-x-4">
              <div
                className={`rounded-theme relative flex h-11 w-11 shrink-0 items-center justify-center shadow-inner ${
                  p.role === "owner"
                    ? "border-2 border-amber-500/50 bg-amber-500/20 text-amber-500"
                    : p.role === "moderator"
                      ? "border-2 border-emerald-500/50 bg-emerald-500/20 text-emerald-500"
                      : "bg-theme-bg/50 text-theme-text border-theme-border/50 border-2"
                }`}
              >
                {p.role === "owner" ? (
                  <Crown className="h-5 w-5 drop-shadow-[0_0_8px_rgba(245,158,11,0.5)]" />
                ) : p.role === "moderator" ? (
                  <Shield className="h-5 w-5" />
                ) : (
                  <User className="h-5 w-5" />
                )}

                {/* Live Presence Dot */}
                <span className="absolute -right-1 -bottom-1 flex h-3.5 w-3.5 items-center justify-center">
                  {p.disconnected ? (
                    <span className="border-theme-bg relative inline-flex h-2.5 w-2.5 rounded-full border-2 bg-red-500"></span>
                  ) : (
                    <>
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>
                      <span className="border-theme-bg relative inline-flex h-2.5 w-2.5 rounded-full border-2 bg-emerald-500"></span>
                    </>
                  )}
                </span>
              </div>

              <div className="min-w-0 flex-1">
                <div className="mb-0.5 flex items-center gap-2">
                  {p.id === participantId ? (
                    <input
                      value={p.nickname}
                      onChange={(e) => setNickname(e.target.value)}
                      className="text-theme-text border-theme-accent/50 focus:border-theme-accent w-full max-w-[140px] truncate border-b-2 bg-transparent px-1 py-0.5 text-[15px] font-bold tracking-wide uppercase transition-all focus:outline-none"
                      title="Edit your nickname"
                    />
                  ) : (
                    <p className="text-theme-text truncate px-1 text-[15px] font-bold tracking-wide uppercase">
                      {p.nickname}
                    </p>
                  )}
                  {p.id === participantId && (
                    <span className="bg-theme-accent text-theme-bg shadow-theme rounded-sm border border-transparent px-1.5 py-0.5 text-[9px] font-bold tracking-widest uppercase">
                      YOU
                    </span>
                  )}
                  {room.leaderId === p.id && (
                    <span className="border-theme-accent text-theme-accent rounded-sm border px-1.5 py-0.5 text-[9px] font-bold tracking-widest uppercase">
                      LEADER
                    </span>
                  )}
                </div>
                <p className="text-theme-muted mt-1 flex items-center gap-1 px-1 text-[11px] font-bold tracking-widest uppercase">
                  {p.disconnected ? (
                    <span className="text-red-400">Reconnecting…</span>
                  ) : p.ready === false ? (
                    <span className="text-amber-400">Loading media</span>
                  ) : (
                    p.role
                  )}
                </p>
              </div>
            </div>

            {/* Admin Controls */}
            {isOwner && p.id !== participantId && (
              <div
                className="relative ml-2"
                ref={openMenuId === p.id ? menuRef : null}
              >
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setOpenMenuId(openMenuId === p.id ? null : p.id);
                  }}
                  className="text-theme-muted hover:text-theme-accent bg-theme-bg/30 border-theme-border/50 hover:border-theme-accent rounded-full border p-1.5 transition-all"
                  aria-label="Manage user"
                >
                  <MoreVertical className="h-4 w-4" />
                </button>

                <AnimatePresence>
                  {openMenuId === p.id && (
                    <motion.div
                      initial={{ opacity: 0, scale: 0.9, y: -10 }}
                      animate={{ opacity: 1, scale: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.9, y: -10 }}
                      transition={{ duration: 0.2, ease: "easeOut" }}
                      className="bg-theme-bg/90 border-theme-border/50 shadow-theme-hover absolute top-full right-0 z-50 mt-2 w-48 overflow-hidden rounded-xl border backdrop-blur-xl"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="flex flex-col p-1">
                        {p.role !== "moderator" && (
                          <button
                            onClick={() => handleRoleChange(p.id, "moderator")}
                            className="hover:bg-theme-accent/20 hover:text-theme-accent text-theme-text flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-semibold tracking-wide transition-colors"
                          >
                            <ShieldPlus className="h-4 w-4" /> Make Moderator
                          </button>
                        )}
                        {p.role === "moderator" && (
                          <button
                            onClick={() => handleRoleChange(p.id, "viewer")}
                            className="text-theme-text flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-semibold tracking-wide transition-colors hover:bg-orange-500/20 hover:text-orange-500"
                          >
                            <ShieldMinus className="h-4 w-4" /> Remove Mod
                          </button>
                        )}
                        <button
                          onClick={() => {
                            if (
                              confirm(
                                `Are you sure you want to transfer ownership to ${p.nickname}? You will become a moderator.`,
                              )
                            ) {
                              handleTransferOwner(p.id);
                            }
                          }}
                          className="text-theme-text flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-semibold tracking-wide transition-colors hover:bg-amber-500/20 hover:text-amber-500"
                        >
                          <Crown className="h-4 w-4" /> Transfer Owner
                        </button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
