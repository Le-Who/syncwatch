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
    <main className="flex min-h-screen flex-col items-center justify-center bg-[#050505] relative overflow-hidden font-mono p-4 sm:p-8 select-none">
      {/* Decorative Grid Background - Dark to stay subdued */}
      <div className="absolute inset-0 bg-[linear-gradient(rgba(0,229,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(0,229,255,0.03)_1px,transparent_1px)] bg-[size:32px_32px] pointer-events-none" />

      {/* Primary Center Card - The "Active Zone" with solid contrasting background */}
      <motion.div
        initial={{ opacity: 0, scale: 0.95, filter: "brightness(0)" }}
        animate={{ opacity: 1, scale: 1, filter: "brightness(1)" }}
        transition={{ duration: 0.4, ease: "easeOut" }}
        className="relative z-10 max-w-lg w-full bg-[#111111] border-2 border-[#00E5FF] p-8 sm:p-12 shadow-[12px_12px_0_#FF00FF]"
      >
        {/* Top Decorative Strip */}
        <div className="absolute top-0 left-0 w-full h-1 bg-[#00E5FF] animate-pulse" />
        <div className="absolute -top-[14px] -left-[2px] bg-[#00E5FF] text-black text-[10px] font-bold px-2 py-[2px] tracking-widest break-words max-w-[50%] overflow-hidden truncate">
          SYS_INIT_SEQUENCE
        </div>

        <div className="space-y-6 text-center">
          <motion.h1
            initial={{ textShadow: "0 0 0 transparent" }}
            animate={{ textShadow: "2px 2px 0 #FF00FF, -2px -2px 0 #00E5FF" }}
            transition={{ delay: 0.5, duration: 0.1 }}
            className="text-5xl sm:text-6xl font-black text-white tracking-tighter uppercase"
          >
            SYNC_
            <br className="sm:hidden" />
            WATCH
          </motion.h1>
          <div className="h-px w-full bg-zinc-800 relative">
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-1/3 h-full bg-[#00E5FF]" />
          </div>
          <p className="text-[#00E5FF] text-sm uppercase tracking-widest opacity-80 leading-relaxed font-semibold">
            Synchronized Media Uplink
            <br />
            YouTube / Twitch / Direct MP4
          </p>
        </div>

        <div className="mt-10 space-y-8">
          {newRoomId && (
            <motion.div
              whileHover={{ x: -4, y: -4, boxShadow: "8px 8px 0 #00E5FF" }}
              whileTap={{ x: 2, y: 2, boxShadow: "0px 0px 0 #00E5FF" }}
              className="bg-[#FF00FF] transition-all"
            >
              <Link
                href={`/room/${newRoomId}`}
                className="block w-full py-4 px-4 text-black font-bold uppercase tracking-widest text-center text-sm sm:text-base border-2 border-[#FF00FF] cursor-pointer"
              >
                ++ INITIALIZE NEW ROOM ++
              </Link>
            </motion.div>
          )}

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t border-zinc-800 border-dashed" />
            </div>
            <div className="relative flex justify-center text-xs">
              <span className="bg-[#111111] px-4 text-zinc-500 uppercase tracking-widest font-bold">
                OR ATTACH TO EXISTING
              </span>
            </div>
          </div>

          <form onSubmit={handleJoin} className="space-y-4">
            <div className="relative group">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[#00E5FF] font-bold">
                &gt;
              </span>
              <input
                type="text"
                placeholder="ROOM_ID_STRING_"
                value={roomId}
                onChange={(e) => setRoomId(e.target.value)}
                className="w-full bg-[#050505] border-2 border-zinc-700 pl-10 pr-4 py-4 text-white placeholder-zinc-600 focus:outline-none focus:border-[#00E5FF] focus:shadow-[0_0_15px_rgba(0,229,255,0.3)] transition-all uppercase tracking-widest text-sm sm:text-base select-auto"
                spellCheck="false"
                autoComplete="off"
              />
              <div className="absolute inset-x-0 bottom-0 h-0.5 bg-transparent group-focus-within:bg-[#00E5FF] transition-colors" />
            </div>

            <button
              type="submit"
              disabled={!roomId.trim()}
              className="w-full py-4 px-4 bg-transparent border-2 border-[#00E5FF] text-[#00E5FF] hover:bg-[#00E5FF] hover:text-black disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-[#00E5FF] disabled:cursor-not-allowed uppercase tracking-widest font-bold transition-all text-sm sm:text-base cursor-pointer"
            >
              EXECUTE_JOIN
            </button>
          </form>
        </div>
      </motion.div>

      {/* Decorative corners */}
      <div className="absolute top-4 left-4 w-8 h-8 border-t-2 border-l-2 border-zinc-800" />
      <div className="absolute top-4 right-4 w-8 h-8 border-t-2 border-r-2 border-zinc-800" />
      <div className="absolute bottom-4 left-4 w-8 h-8 border-b-2 border-l-2 border-zinc-800" />
      <div className="absolute bottom-4 right-4 w-8 h-8 border-b-2 border-r-2 border-zinc-800" />
    </main>
  );
}
