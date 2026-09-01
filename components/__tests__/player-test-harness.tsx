import { useLayoutEffect, useRef } from "react";
import { usePlayerEvents } from "../../hooks/usePlayerEvents";

export type PlayerEventHandlers = ReturnType<typeof usePlayerEvents>;
export type PlayerEventHarnessOptions = Parameters<typeof usePlayerEvents>[0];

export function PlayerTestHarness({
  options,
  onHandlers,
}: {
  options: Omit<PlayerEventHarnessOptions, "realPlayerRef" | "playerRef">;
  onHandlers: (handlers: PlayerEventHandlers) => void;
}) {
  const realPlayerRef = useRef(null);
  const playerRef = useRef(null);
  const handlers = usePlayerEvents({
    ...options,
    realPlayerRef,
    playerRef,
  });

  useLayoutEffect(() => {
    onHandlers(handlers);
  }, [handlers, onHandlers]);

  return null;
}
