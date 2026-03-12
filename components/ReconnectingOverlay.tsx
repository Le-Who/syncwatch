"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { useStore } from "@/lib/store";
import { WifiOff, RefreshCw } from "lucide-react";
import { motion } from "motion/react";

/**
 * Lightweight external store for reconnection state.
 * Avoids React 19 "set-state-in-effect" lint violations by keeping
 * mutable countdown/retry state outside the React tree.
 */
const reconnectStore = {
  wasConnected: false,
  countdown: 5,
  retryCount: 0,
  listeners: new Set<() => void>(),

  subscribe(listener: () => void) {
    reconnectStore.listeners.add(listener);
    return () => { reconnectStore.listeners.delete(listener); };
  },

  getSnapshot() {
    return {
      wasConnected: reconnectStore.wasConnected,
      countdown: reconnectStore.countdown,
      retryCount: reconnectStore.retryCount,
    };
  },

  markConnected() {
    reconnectStore.wasConnected = true;
    reconnectStore.countdown = 5;
    reconnectStore.retryCount = 0;
    reconnectStore._notify();
  },

  tick() {
    reconnectStore.countdown -= 1;
    reconnectStore._notify();
  },

  retried() {
    reconnectStore.retryCount += 1;
    reconnectStore.countdown = 5;
    reconnectStore._notify();
  },

  resetCountdown() {
    reconnectStore.countdown = 5;
    reconnectStore._notify();
  },

  _notify() {
    for (const l of reconnectStore.listeners) l();
  },
};

// Stable snapshot reference for useSyncExternalStore
let cachedSnapshot = reconnectStore.getSnapshot();
function getSnapshot() {
  const next = reconnectStore.getSnapshot();
  if (
    next.wasConnected !== cachedSnapshot.wasConnected ||
    next.countdown !== cachedSnapshot.countdown ||
    next.retryCount !== cachedSnapshot.retryCount
  ) {
    cachedSnapshot = next;
  }
  return cachedSnapshot;
}

/**
 * B5: Reconnecting overlay shown when WebSocket connection is lost.
 * Displays animated reconnecting state with auto-retry countdown and manual retry button.
 */
export function ReconnectingOverlay() {
  const isConnected = useStore((s) => s.isConnected);
  const room = useStore((s) => s.room);
  const nickname = useStore((s) => s.nickname);
  const connect = useStore((s) => s.connect);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const { wasConnected, countdown, retryCount } = useSyncExternalStore(
    reconnectStore.subscribe,
    getSnapshot,
    getSnapshot,
  );

  // Track connection established
  useEffect(() => {
    if (isConnected) {
      reconnectStore.markConnected();
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
  }, [isConnected]);

  // Auto-retry countdown timer
  useEffect(() => {
    if (isConnected || !wasConnected || !room) return;

    reconnectStore.resetCountdown();
    timerRef.current = setInterval(() => {
      reconnectStore.tick();
      if (reconnectStore.countdown <= 0) {
        reconnectStore.retried();
        connect(room.id, nickname);
      }
    }, 1000);

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [isConnected, wasConnected, room, nickname, connect]);

  // Don't show if never connected or currently connected
  if (isConnected || !wasConnected) return null;

  const handleManualRetry = () => {
    if (room) {
      reconnectStore.retried();
      connect(room.id, nickname);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="font-theme fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md"
    >
      <motion.div
        initial={{ scale: 0.9, y: 20 }}
        animate={{ scale: 1, y: 0 }}
        transition={{ type: "spring", damping: 20, stiffness: 300 }}
        className="bg-theme-bg/95 border-theme-border rounded-theme flex flex-col items-center space-y-6 border-2 p-8 text-center shadow-2xl backdrop-blur-xl"
      >
        <div className="relative">
          <WifiOff className="text-theme-danger h-12 w-12 animate-pulse" />
          <div className="border-theme-accent absolute -right-1 -bottom-1 h-4 w-4 animate-spin rounded-full border-2 border-t-transparent" />
        </div>

        <div>
          <p className="text-theme-text mb-2 text-lg font-bold tracking-wider uppercase">
            Connection Lost
          </p>
          <p className="text-theme-muted text-xs font-bold tracking-widest uppercase">
            Auto-retrying in {countdown}s...
            {retryCount > 0 && ` (attempt ${retryCount})`}
          </p>
        </div>

        <button
          onClick={handleManualRetry}
          className="bg-theme-accent text-theme-bg rounded-theme flex items-center space-x-2 px-6 py-3 text-xs font-bold tracking-widest uppercase shadow-lg transition-all hover:scale-105 active:scale-95"
        >
          <RefreshCw className="h-4 w-4" />
          <span>Retry Now</span>
        </button>
      </motion.div>
    </motion.div>
  );
}
