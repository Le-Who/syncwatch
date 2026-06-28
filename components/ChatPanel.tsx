"use client";

import { useEffect, useRef, useState } from "react";
import { MessageSquare, Send } from "lucide-react";
import { useStore } from "@/lib/store";

export default function ChatPanel() {
  const { room, participantId, sendCommand } = useStore();
  const [message, setMessage] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  const messages = room?.chat ?? [];

  useEffect(() => {
    if (typeof bottomRef.current?.scrollIntoView === "function") {
      bottomRef.current.scrollIntoView({ block: "end" });
    }
  }, [messages.length]);

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = message.trim();
    if (!trimmed) return;
    sendCommand("send_chat", { message: trimmed });
    setMessage("");
  };

  if (!room) return null;

  return (
    <div className="flex h-full flex-col bg-transparent">
      <div className="scrollbar-thin scrollbar-thumb-theme-accent/50 scrollbar-track-transparent flex-1 space-y-3 overflow-y-auto p-4">
        {messages.length === 0 ? (
          <div className="text-theme-muted flex h-full flex-col items-center justify-center gap-3 text-center">
            <div className="border-theme-border/30 bg-theme-bg/40 rounded-theme flex h-14 w-14 items-center justify-center border">
              <MessageSquare className="h-6 w-6" />
            </div>
            <p className="text-xs font-bold tracking-widest uppercase">
              No messages yet
            </p>
          </div>
        ) : (
          messages.map((chat) => {
            const isMine = chat.participantId === participantId;
            return (
              <div
                key={chat.id}
                className={`flex ${isMine ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`rounded-theme max-w-[85%] border px-3 py-2 ${
                    isMine
                      ? "bg-theme-accent/20 border-theme-accent/50"
                      : "bg-theme-bg/40 border-theme-border/30"
                  }`}
                >
                  <div className="mb-1 flex items-center gap-2">
                    <span className="text-theme-text truncate text-[11px] font-bold tracking-widest uppercase">
                      {chat.nickname}
                    </span>
                    <span className="text-theme-muted shrink-0 text-[10px]">
                      {new Date(chat.sentAt).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>
                  <p className="text-theme-text break-words text-sm leading-relaxed">
                    {chat.message}
                  </p>
                </div>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      <form
        onSubmit={handleSubmit}
        className="border-theme-border/30 bg-theme-bg/50 flex shrink-0 gap-2 border-t p-3"
      >
        <input
          type="text"
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder="Message room"
          aria-label="Message room"
          maxLength={500}
          className="bg-theme-bg/50 border-theme-border/50 rounded-theme text-theme-text placeholder-theme-muted focus:border-theme-accent min-w-0 flex-1 border px-3 py-2 text-sm font-bold outline-none"
        />
        <button
          type="submit"
          disabled={!message.trim()}
          aria-label="Send message"
          className="bg-theme-accent text-theme-bg rounded-theme ring-theme-text flex h-10 w-10 shrink-0 items-center justify-center transition-all outline-none hover:brightness-110 focus-visible:ring-2 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Send className="h-4 w-4" />
        </button>
      </form>
    </div>
  );
}
