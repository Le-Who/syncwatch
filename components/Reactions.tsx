"use client";

import { useEffect, useState, useCallback } from "react";
import { getSocket } from "@/lib/socket";
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
    const socket = getSocket();

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
    const socket = getSocket();
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
      <div className="absolute inset-0 pointer-events-none z-40 overflow-hidden">
        {particles.map((p) => (
          <div
            key={p.id}
            className="absolute bottom-0 text-3xl sm:text-4xl animate-float-up drop-shadow-md"
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
      <div className="absolute right-4 top-1/2 -translate-y-1/2 z-50 flex flex-col items-center">
        {isOpen && (
          <div className="mb-2 bg-theme-bg/80 backdrop-blur-xl border-2 border-theme-border/50 p-2 rounded-theme shadow-lg flex flex-col-reverse gap-2 animate-in fade-in slide-in-from-bottom-2">
            {EMOJIS.map((emoji) => (
              <button
                key={emoji}
                onClick={() => {
                  sendReaction(emoji);
                  setIsOpen(false);
                }}
                className="w-10 h-10 flex items-center justify-center text-xl hover:bg-theme-accent/20 rounded-full transition-colors focus:outline-none focus-visible:ring-2 ring-theme-accent hover:scale-125 origin-center"
              >
                {emoji}
              </button>
            ))}
          </div>
        )}
        <button
          onClick={() => setIsOpen(!isOpen)}
          className={`w-12 h-12 flex items-center justify-center rounded-full text-theme-text transition-all shadow-[var(--theme-shadow)] focus:outline-none focus-visible:ring-2 ring-theme-accent border-2 border-theme-border/50 backdrop-blur-md ${
            isOpen
              ? "bg-theme-accent text-theme-bg shadow-none scale-95 border-theme-accent"
              : "bg-theme-bg/80 hover:bg-theme-accent/20 hover:border-theme-accent"
          }`}
        >
          <Smile className="w-6 h-6" />
        </button>
      </div>
    </>
  );
}
