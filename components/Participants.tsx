"use client";

import { useStore } from "@/lib/store";
import { User, Crown, Shield, Clock } from "lucide-react";

export default function Participants() {
  const { room, participantId } = useStore();

  if (!room) return null;

  const participants = Object.values(room.participants).sort((a, b) => {
    if (a.role === "owner") return -1;
    if (b.role === "owner") return 1;
    if (a.role === "moderator") return -1;
    if (b.role === "moderator") return 1;
    return a.nickname.localeCompare(b.nickname);
  });

  return (
    <div className="flex flex-col h-full bg-transparent p-4 overflow-y-auto scrollbar-thin scrollbar-thumb-zinc-700/50 scrollbar-track-transparent">
      <div className="space-y-3">
        {participants.map((p) => (
          <div
            key={p.id}
            className={`flex items-center justify-between p-3.5 rounded-2xl border transition-all ${
              p.id === participantId
                ? "bg-indigo-500/10 border-indigo-500/30 shadow-[0_0_20px_rgba(99,102,241,0.1)]"
                : "bg-black/20 border-white/5 hover:bg-black/40 hover:border-white/10"
            }`}
          >
            <div className="flex items-center space-x-4 min-w-0">
              <div
                className={`w-11 h-11 relative rounded-xl flex items-center justify-center shrink-0 shadow-inner ${
                  p.role === "owner"
                    ? "bg-gradient-to-br from-amber-500/20 to-orange-600/20 text-amber-500 border border-amber-500/20"
                    : p.role === "moderator"
                      ? "bg-gradient-to-br from-emerald-500/20 to-teal-600/20 text-emerald-400 border border-emerald-500/20"
                      : "bg-gradient-to-br from-white/5 to-white/10 text-zinc-400 border border-white/5"
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
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500 border-2 border-[#111]"></span>
                </span>
              </div>

              <div className="min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <p className="text-[15px] font-medium text-zinc-100 truncate">
                    {p.nickname}
                  </p>
                  {p.id === participantId && (
                    <span className="text-[9px] uppercase tracking-widest bg-indigo-500/20 text-indigo-300 font-bold px-1.5 py-0.5 rounded-md border border-indigo-500/30">
                      YOU
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-zinc-500 capitalize tracking-wide font-light flex items-center gap-1">
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
