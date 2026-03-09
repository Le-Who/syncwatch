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
    room.participants[participantId || ""]?.role || "guest";
  const isOwner = currentUserRole === "owner";

  const participants = Object.values(room.participants).sort((a, b) => {
    const roles = { owner: 3, moderator: 2, guest: 1 };
    const wA = roles[a.role as keyof typeof roles] || 0;
    const wB = roles[b.role as keyof typeof roles] || 0;
    if (wA !== wB) return wB - wA;
    return a.nickname.localeCompare(b.nickname);
  });

  const handleRoleChange = (targetParticipantId: string, newRole: string) => {
    sendCommand("update_role", {
      participantId: targetParticipantId,
      role: newRole,
    });
    setOpenMenuId(null);
  };

  return (
    <div
      className="scrollbar-thin scrollbar-thumb-theme-accent/50 scrollbar-track-transparent flex h-full flex-col overflow-y-auto bg-transparent p-4"
      onClick={() => setOpenMenuId(null)}
    >
      <div className="space-y-3">
        {participants.map((p) => (
          <div
            key={p.id}
            className={`rounded-theme participant-item relative flex items-center justify-between border-2 p-3.5 transition-all ${
              p.id === participantId
                ? "bg-theme-accent/20 border-theme-accent shadow-theme"
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

                {/* Live Presence Dot - Ping */}
                <span className="absolute -right-1 -bottom-1 flex h-3.5 w-3.5 items-center justify-center">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="border-theme-bg relative inline-flex h-2.5 w-2.5 rounded-full border-2 bg-emerald-500"></span>
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
                </div>
                <p className="text-theme-muted mt-1 flex items-center gap-1 px-1 text-[11px] font-bold tracking-widest uppercase">
                  {p.role}
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
                            onClick={() => handleRoleChange(p.id, "guest")}
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
                              handleRoleChange(p.id, "owner");
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
