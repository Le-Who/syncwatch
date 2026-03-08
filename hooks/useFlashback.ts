import { useState, useCallback, useRef } from "react";

const FLASHBACK_THRESHOLD_SEC = 15; // Расстояние для детектирования миссклика
const MAX_FLASHBACKS = 5;

export interface FlashbackPoint {
  position: number;
  timestamp: number;
  mediaId: string;
}

export function useFlashback() {
  const [flashbacks, setFlashbacks] = useState<FlashbackPoint[]>([]);
  const lastKnownPosition = useRef<number>(0);

  const registerPossibleFlashback = useCallback(
    (currentPosition: number, targetSeekPosition: number, mediaId: string) => {
      if (
        Math.abs(targetSeekPosition - currentPosition) > FLASHBACK_THRESHOLD_SEC
      ) {
        setFlashbacks((prev) => {
          const newStack = [
            { position: currentPosition, timestamp: Date.now(), mediaId },
            ...prev,
          ].slice(0, MAX_FLASHBACKS);
          return newStack;
        });
      }
      lastKnownPosition.current = targetSeekPosition;
    },
    [],
  );

  const popFlashback = useCallback((currentMediaId: string): number | null => {
    let restoredPosition: number | null = null;
    setFlashbacks((prev) => {
      const fb = prev.find((p) => p.mediaId === currentMediaId);
      if (fb) {
        restoredPosition = fb.position;
        return prev.filter((p) => p !== fb);
      }
      return prev;
    });
    return restoredPosition;
  }, []);

  return { flashbacks, registerPossibleFlashback, popFlashback };
}
