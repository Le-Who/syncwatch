"use client";

import Link from "next/link";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";

export default function Home() {
  const [roomId, setRoomId] = useState("");
  const [newRoomId, setNewRoomId] = useState("");
  const router = useRouter();

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNewRoomId(crypto.randomUUID().split("-")[0]);
  }, []);

  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault();
    if (roomId.trim()) {
      router.push(`/room/${roomId.trim()}`);
    }
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-center relative overflow-hidden p-4 sm:p-8 select-none">
      {/* Primary Center Card - Uses Theme Engine .theme-panel */}
      <motion.div
        initial={{ opacity: 0, scale: 0.95, filter: "brightness(0.5)" }}
        animate={{ opacity: 1, scale: 1, filter: "brightness(1)" }}
        transition={{ duration: 0.6, ease: "easeOut" }}
        className="relative z-10 max-w-lg w-full theme-panel p-8 sm:p-12"
      >
        {/* Top Decorative Strip */}
        <div className="absolute top-0 left-0 w-full h-1 bg-theme-accent animate-pulse rounded-t-[inherit]" />
        <div className="absolute -top-[14px] left-4 bg-theme-accent text-theme-bg text-[10px] font-bold px-3 py-[2px] tracking-widest rounded-full uppercase">
          SYS_INIT
        </div>

        <div className="space-y-6 text-center">
          <motion.h1
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3, duration: 0.5 }}
            className="text-5xl sm:text-6xl font-black text-theme-text tracking-tighter uppercase drop-shadow-md"
          >
            SYNC_
            <br className="sm:hidden" />
            WATCH
          </motion.h1>
          <div className="h-px w-full bg-theme-border/30 relative">
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-1/3 h-full bg-theme-accent" />
          </div>
          <p className="text-theme-text font-medium text-sm md:text-base uppercase tracking-widest opacity-80 leading-relaxed drop-shadow-sm">
            Synchronized Media Uplink
            <br />
            YouTube / Twitch / Direct MP4
          </p>
        </div>

        <div className="mt-10 space-y-8">
          {newRoomId && (
            <motion.div
              whileHover={{ y: -4, scale: 1.02 }}
              whileTap={{ y: 0, scale: 0.98 }}
              className="transition-all"
            >
              <Link
                href={`/room/${newRoomId}`}
                className="block w-full py-4 px-4 bg-theme-accent text-theme-bg font-bold uppercase tracking-widest text-center text-sm sm:text-base rounded-theme shadow-[var(--theme-shadow)] hover:shadow-[var(--theme-shadow-hover)] border-2 border-transparent transition-all cursor-pointer"
              >
                ++ Initialize New Room ++
              </Link>
            </motion.div>
          )}

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t border-theme-border border-dashed opacity-50" />
            </div>
            <div className="relative flex justify-center text-xs">
              <span className="bg-theme-card backdrop-blur-md px-4 text-theme-muted uppercase tracking-widest font-bold rounded-full border border-theme-border/30 py-1">
                OR ATTACH TO EXISTING
              </span>
            </div>
          </div>

          <form onSubmit={handleJoin} className="space-y-4">
            <div className="relative group">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-theme-accent font-bold">
                &gt;
              </span>
              <input
                type="text"
                placeholder="ROOM_ID_STRING"
                value={roomId}
                onChange={(e) => setRoomId(e.target.value)}
                className="w-full bg-theme-bg/50 backdrop-blur-sm border-2 border-theme-border/50 rounded-theme pl-10 pr-4 py-4 text-theme-text placeholder-theme-muted focus:outline-none focus:border-theme-accent focus:shadow-[0_0_15px_var(--color-theme-accent)] transition-all uppercase tracking-widest text-sm sm:text-base select-auto"
                spellCheck="false"
                autoComplete="off"
              />
            </div>

            <button
              type="submit"
              disabled={!roomId.trim()}
              className="w-full py-4 px-4 bg-transparent border-2 border-theme-accent text-theme-accent hover:bg-theme-accent hover:text-theme-bg rounded-theme disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-theme-accent disabled:cursor-not-allowed uppercase tracking-widest font-bold transition-all text-sm sm:text-base cursor-pointer"
            >
              EXECUTE_JOIN
            </button>
          </form>
        </div>
      </motion.div>
    </main>
  );
}
