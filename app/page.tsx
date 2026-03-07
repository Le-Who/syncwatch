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
    setNewRoomId(crypto.randomUUID());
  }, []);

  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault();
    if (roomId.trim()) {
      router.push(`/room/${roomId.trim()}`);
    }
  };

  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden p-4 select-none sm:p-8">
      {/* Primary Center Card - Uses Theme Engine .theme-panel */}
      <motion.div
        initial={{ opacity: 0, scale: 0.95, filter: "brightness(0.5)", z: 0 }}
        animate={{ opacity: 1, scale: 1, filter: "brightness(1)", z: 0 }}
        transition={{ duration: 0.6, ease: "easeOut" }}
        style={{ willChange: "transform, filter, opacity" }}
        className="theme-panel relative z-10 w-full max-w-lg p-8 sm:p-12"
      >
        {/* Top Decorative Strip */}
        <div className="bg-theme-accent absolute top-0 left-0 h-1 w-full animate-pulse rounded-t-[inherit]" />
        <div className="bg-theme-accent text-theme-bg absolute -top-[14px] left-4 rounded-full px-3 py-[2px] text-[10px] font-bold tracking-widest uppercase">
          SYS_INIT
        </div>

        <div className="space-y-6 text-center">
          <motion.h1
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3, duration: 0.5 }}
            className="text-theme-text text-5xl font-black tracking-tighter uppercase drop-shadow-md sm:text-6xl"
          >
            SYNC_
            <br className="sm:hidden" />
            WATCH
          </motion.h1>
          <div className="bg-theme-border/30 relative h-px w-full">
            <div className="bg-theme-accent absolute top-0 left-1/2 h-full w-1/3 -translate-x-1/2" />
          </div>
          <p className="text-theme-text text-sm leading-relaxed font-medium tracking-widest uppercase opacity-80 drop-shadow-sm md:text-base">
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
                className="bg-theme-accent text-theme-bg rounded-theme shadow-theme hover:shadow-theme-hover block w-full cursor-pointer border-2 border-transparent px-4 py-4 text-center text-sm font-bold tracking-widest uppercase transition-all sm:text-base"
              >
                ++ Initialize New Room ++
              </Link>
            </motion.div>
          )}

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="border-theme-border w-full border-t border-dashed opacity-50" />
            </div>
            <div className="relative flex justify-center text-xs">
              <span className="bg-theme-card text-theme-muted border-theme-border/30 rounded-full border px-4 py-1 font-bold tracking-widest uppercase backdrop-blur-md">
                OR ATTACH TO EXISTING
              </span>
            </div>
          </div>

          <form onSubmit={handleJoin} className="space-y-4">
            <div className="group relative">
              <span className="text-theme-accent absolute top-1/2 left-4 -translate-y-1/2 font-bold">
                &gt;
              </span>
              <input
                type="text"
                placeholder="ROOM_ID_STRING"
                value={roomId}
                onChange={(e) => setRoomId(e.target.value)}
                className="bg-theme-bg/50 border-theme-border/50 rounded-theme text-theme-text placeholder-theme-muted focus:border-theme-accent w-full border-2 py-4 pr-4 pl-10 text-sm tracking-widest uppercase backdrop-blur-sm transition-all select-auto focus:shadow-[0_0_15px_var(--color-theme-accent)] focus:outline-none sm:text-base"
                spellCheck="false"
                autoComplete="off"
              />
            </div>

            <button
              type="submit"
              disabled={!roomId.trim()}
              className="border-theme-accent text-theme-accent hover:bg-theme-accent hover:text-theme-bg rounded-theme disabled:hover:text-theme-accent w-full cursor-pointer border-2 bg-transparent px-4 py-4 text-sm font-bold tracking-widest uppercase transition-all disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent sm:text-base"
            >
              EXECUTE_JOIN
            </button>
          </form>
        </div>
      </motion.div>
    </main>
  );
}
