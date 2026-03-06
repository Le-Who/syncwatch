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
    <div className="flex flex-col h-full bg-zinc-900/50 p-4">
      <div className="space-y-3">
        {participants.map((p) => (
          <div
            key={p.id}
            className={`flex items-center justify-between p-3 rounded-xl border transition-colors ${
              p.id === participantId
                ? "bg-indigo-500/10 border-indigo-500/30"
                : "bg-zinc-900 border-zinc-800"
            }`}
          >
            <div className="flex items-center space-x-3 min-w-0">
              <div
                className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${
                  p.role === "owner"
                    ? "bg-amber-500/20 text-amber-500"
                    : p.role === "moderator"
                      ? "bg-emerald-500/20 text-emerald-500"
                      : "bg-zinc-800 text-zinc-400"
                }`}
              >
                {p.role === "owner" ? (
                  <Crown className="w-5 h-5" />
                ) : p.role === "moderator" ? (
                  <Shield className="w-5 h-5" />
                ) : (
                  <User className="w-5 h-5" />
                )}
              </div>

              <div className="min-w-0">
                <p className="text-sm font-medium text-zinc-200 truncate flex items-center gap-2">
                  {p.nickname}
                  {p.id === participantId && (
                    <span className="text-[10px] uppercase tracking-wider bg-indigo-500/20 text-indigo-400 px-1.5 py-0.5 rounded">
                      You
                    </span>
                  )}
                </p>
                <p className="text-xs text-zinc-500 capitalize flex items-center gap-1">
                  {p.role}
                </p>
              </div>
            </div>

            {/* In a real app, add a dropdown menu here for moderation actions if current user is owner/mod */}
          </div>
        ))}
      </div>
    </div>
  );
}
