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
    <main className="flex min-h-screen flex-col items-center justify-center bg-zinc-950 text-zinc-50 p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-md w-full space-y-8 text-center"
      >
        <div className="space-y-4">
          <h1 className="text-5xl font-bold tracking-tight text-white">
            SyncWatch
          </h1>
          <p className="text-zinc-400 text-lg">
            Watch videos together with friends in perfect sync. Support for
            YouTube, direct mp4, and more.
          </p>
        </div>

        <div className="pt-8 space-y-6">
          {newRoomId && (
            <Link
              href={`/room/${newRoomId}`}
              className="block w-full py-3 px-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-medium transition-colors"
            >
              Create a New Room
            </Link>
          )}

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t border-zinc-800" />
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="bg-zinc-950 px-2 text-zinc-500">
                or join existing
              </span>
            </div>
          </div>

          <form onSubmit={handleJoin} className="space-y-3">
            <input
              type="text"
              placeholder="Enter Room Code"
              value={roomId}
              onChange={(e) => setRoomId(e.target.value)}
              className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <button
              type="submit"
              disabled={!roomId.trim()}
              className="w-full py-3 px-4 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl font-medium transition-colors"
            >
              Join Room
            </button>
          </form>
        </div>
      </motion.div>
    </main>
  );
}
