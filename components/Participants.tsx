"use client";

import { useStore } from "@/lib/store";
import { User, Crown, Shield, Clock } from "lucide-react";

export default function Participants() {
  const { room, participantId, setNickname } = useStore();

  if (!room) return null;

  const participants = Object.values(room.participants).sort((a, b) => {
    if (a.role === "owner") return -1;
    if (b.role === "owner") return 1;
    if (a.role === "moderator") return -1;
    if (b.role === "moderator") return 1;
    return a.nickname.localeCompare(b.nickname);
  });

  return (
    <div className="scrollbar-thin scrollbar-thumb-theme-accent/50 scrollbar-track-transparent flex h-full flex-col overflow-y-auto bg-transparent p-4">
      <div className="space-y-3">
        {participants.map((p) => (
          <div
            key={p.id}
            className={`rounded-theme flex items-center justify-between border-2 p-3.5 transition-all ${
              p.id === participantId
                ? "bg-theme-accent/20 border-theme-accent shadow-[var(--theme-shadow)]"
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
                    <span className="bg-theme-accent text-theme-bg rounded-sm border border-transparent px-1.5 py-0.5 text-[9px] font-bold tracking-widest uppercase shadow-[var(--theme-shadow)]">
                      YOU
                    </span>
                  )}
                </div>
                <p className="text-theme-muted mt-1 flex items-center gap-1 px-1 text-[11px] font-bold tracking-widest uppercase">
                  {p.role}
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
