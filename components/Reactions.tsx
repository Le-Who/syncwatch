"use client";

import { useEffect, useState, useCallback } from "react";
import { roomSocketService } from "@/lib/socket";
import { Smile } from "lucide-react";

interface EmojiParticle {
  id: string;
  emoji: string;
  x: number;
  duration: number;
}

const EMOJIS = ["🔥", "😂", "💖", "👀", "🤯", "💯"];

export default function Reactions() {
  const [particles, setParticles] = useState<EmojiParticle[]>([]);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    const socket = roomSocketService.getSocket();

    const handleReaction = (payload: { emoji: string }) => {
      const newParticle = {
        id: crypto.randomUUID(),
        emoji: payload.emoji,
        x: Math.random() * 80 + 10, // 10% to 90%
        duration: 2.5 + Math.random() * 1.5,
      };

      setParticles((prev) => [...prev, newParticle]);

      // Remove after animation completes
      setTimeout(() => {
        setParticles((prev) => prev.filter((p) => p.id !== newParticle.id));
      }, 4000);
    };

    socket.on("reaction", handleReaction);
    return () => {
      socket.off("reaction", handleReaction);
    };
  }, []);

  const sendReaction = useCallback((emoji: string) => {
    const socket = roomSocketService.getSocket();
    socket.emit("reaction", { emoji });

    // Play locally too
    const newParticle = {
      id: crypto.randomUUID(),
      emoji,
      x: Math.random() * 80 + 10,
      duration: 2.5 + Math.random() * 1.5,
    };
    setParticles((prev) => [...prev, newParticle]);
    setTimeout(() => {
      setParticles((prev) => prev.filter((p) => p.id !== newParticle.id));
    }, 4000);
  }, []);

  return (
    <>
      {/* Particles Layer */}
      <div className="pointer-events-none absolute inset-0 z-40 overflow-hidden">
        {particles.map((p) => (
          <div
            key={p.id}
            className="animate-float-up absolute bottom-0 text-3xl drop-shadow-md sm:text-4xl"
            style={{
              left: `${p.x}%`,
              animationDuration: `${p.duration}s`,
            }}
          >
            {p.emoji}
          </div>
        ))}
      </div>

      {/* Reaction Controls */}
      <div className="absolute top-1/2 right-4 z-50 flex -translate-y-1/2 flex-col items-center">
        {isOpen && (
          <div className="bg-theme-bg/80 border-theme-border/50 rounded-theme animate-in fade-in slide-in-from-bottom-2 mb-2 flex flex-col-reverse gap-2 border-2 p-2 shadow-lg backdrop-blur-xl">
            {EMOJIS.map((emoji) => (
              <button
                key={emoji}
                onClick={() => {
                  sendReaction(emoji);
                  setIsOpen(false);
                }}
                className="hover:bg-theme-accent/20 ring-theme-accent flex h-10 w-10 origin-center items-center justify-center rounded-full text-xl transition-colors hover:scale-125 focus:outline-none focus-visible:ring-2"
              >
                {emoji}
              </button>
            ))}
          </div>
        )}
        <button
          onClick={() => setIsOpen(!isOpen)}
          className={`text-theme-text ring-theme-accent border-theme-border/50 shadow-theme flex h-12 w-12 items-center justify-center rounded-full border-2 backdrop-blur-md transition-all focus:outline-none focus-visible:ring-2 ${
            isOpen
              ? "bg-theme-accent text-theme-bg border-theme-accent scale-95 shadow-none"
              : "bg-theme-bg/80 hover:bg-theme-accent/20 hover:border-theme-accent"
          }`}
        >
          <Smile className="h-6 w-6" />
        </button>
      </div>
    </>
  );
}
