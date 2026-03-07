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
    <div className="flex flex-col h-full bg-transparent p-4 overflow-y-auto scrollbar-thin scrollbar-thumb-theme-accent/50 scrollbar-track-transparent">
      <div className="space-y-3">
        {participants.map((p) => (
          <div
            key={p.id}
            className={`flex items-center justify-between p-3.5 rounded-theme border-2 transition-all ${
              p.id === participantId
                ? "bg-theme-accent/20 border-theme-accent shadow-[var(--theme-shadow)]"
                : "bg-theme-bg/40 border-theme-border/30 hover:bg-theme-bg/60 hover:border-theme-accent"
            }`}
          >
            <div className="flex items-center space-x-4 min-w-0">
              <div
                className={`w-11 h-11 relative rounded-theme flex items-center justify-center shrink-0 shadow-inner ${
                  p.role === "owner"
                    ? "bg-amber-500/20 text-amber-500 border-2 border-amber-500/50"
                    : p.role === "moderator"
                      ? "bg-emerald-500/20 text-emerald-500 border-2 border-emerald-500/50"
                      : "bg-theme-bg/50 text-theme-text border-2 border-theme-border/50"
                }`}
              >
                {p.role === "owner" ? (
                  <Crown className="w-5 h-5 drop-shadow-[0_0_8px_rgba(245,158,11,0.5)]" />
                ) : p.role === "moderator" ? (
                  <Shield className="w-5 h-5" />
                ) : (
                  <User className="w-5 h-5" />
                )}

                {/* Live Presence Dot - Ping */}
                <span className="absolute -bottom-1 -right-1 flex h-3.5 w-3.5 items-center justify-center">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500 border-2 border-theme-bg"></span>
                </span>
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-0.5">
                  {p.id === participantId ? (
                    <input
                      value={p.nickname}
                      onChange={(e) => setNickname(e.target.value)}
                      className="text-[15px] font-bold text-theme-text bg-transparent border-b-2 border-theme-accent/50 focus:border-theme-accent focus:outline-none truncate w-full max-w-[140px] uppercase tracking-wide py-0.5 px-1 transition-all"
                      title="Edit your nickname"
                    />
                  ) : (
                    <p className="text-[15px] font-bold text-theme-text truncate uppercase tracking-wide px-1">
                      {p.nickname}
                    </p>
                  )}
                  {p.id === participantId && (
                    <span className="text-[9px] uppercase tracking-widest bg-theme-accent text-theme-bg font-bold px-1.5 py-0.5 rounded-sm border border-transparent shadow-[var(--theme-shadow)]">
                      YOU
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-theme-muted uppercase tracking-widest font-bold flex items-center gap-1 px-1 mt-1">
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
