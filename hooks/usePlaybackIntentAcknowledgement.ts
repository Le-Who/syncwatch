"use client";

import { useEffect } from "react";
import { useStore } from "@/lib/store";
import { PlaybackIntentManager } from "@/lib/playback-intent-manager";
import { roomSocketService } from "@/lib/socket";
import type { RoomEvent } from "@/lib/room-events";

/** Connects this Player instance to every correlated completion signal. */
export function usePlaybackIntentAcknowledgement(
  intentManager: PlaybackIntentManager,
) {
  const acknowledgement = useStore((state) => state.lastCommandAcknowledgement);

  useEffect(() => {
    if (acknowledgement) {
      intentManager.acknowledgeCommand(acknowledgement);
    }
  }, [acknowledgement, intentManager]);

  useEffect(() => {
    const handleRoomEvent = (event: RoomEvent) => {
      if (event.type === "playback_updated") {
        intentManager.acknowledgeServerNonce(event.playback.lastActionNonce);
      }
    };

    roomSocketService.onRoomEvent(handleRoomEvent);
    return () => roomSocketService.offRoomEvent(handleRoomEvent);
  }, [intentManager]);
}
