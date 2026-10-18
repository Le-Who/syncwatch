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
  // Undo returns a position synchronously; React may defer render updates.
  const stackRef = useRef<FlashbackPoint[]>([]);

  const registerPossibleFlashback = useCallback(
    (currentPosition: number, targetSeekPosition: number, mediaId: string) => {
      if (
        Math.abs(targetSeekPosition - currentPosition) > FLASHBACK_THRESHOLD_SEC
      ) {
        const newStack = [
          { position: currentPosition, timestamp: Date.now(), mediaId },
          ...stackRef.current,
        ].slice(0, MAX_FLASHBACKS);
        stackRef.current = newStack;
        setFlashbacks(newStack);
      }
    },
    [],
  );

  const popFlashback = useCallback((currentMediaId: string): number | null => {
    const fb = stackRef.current.find(
      (point) => point.mediaId === currentMediaId,
    );
    if (!fb) return null;
    const newStack = stackRef.current.filter((point) => point !== fb);
    stackRef.current = newStack;
    setFlashbacks(newStack);
    return fb.position;
  }, []);

  return { flashbacks, registerPossibleFlashback, popFlashback };
}
