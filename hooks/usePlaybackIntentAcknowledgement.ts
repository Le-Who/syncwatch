"use client";

import { useEffect } from "react";
import { PlaybackIntentManager } from "@/lib/playback-intent-manager";
import { roomSocketService } from "@/lib/socket";
import type { RoomEvent } from "@/lib/room-events";
import type { CommandAcknowledgement } from "@/lib/room-command-contract";
import { useStore } from "@/lib/store";

/** Connects this Player instance to every correlated completion signal. */
export function usePlaybackIntentAcknowledgement(
  intentManager: PlaybackIntentManager,
) {
  useEffect(() => {
    const handleCommandAcknowledgement = (
      acknowledgement?: CommandAcknowledgement,
    ) => {
      if (acknowledgement) {
        intentManager.acknowledgeCommand(acknowledgement);
      }
    };
    const handleRoomEvent = (event: RoomEvent) => {
      if (event.type === "playback_updated") {
        const room = useStore.getState().room;
        if (
          !room ||
          (event.playback.generation ?? "legacy") !==
            (room.generation ?? "legacy") ||
          (event.playback.mediaRun ?? 0) !== (room.mediaRun ?? 0) ||
          event.playback.mediaItemId !== room.currentMediaId
        )
          return;
        intentManager.acknowledgeServerNonce(event.playback.lastActionNonce);
      }
    };

    roomSocketService.on("command_ack", handleCommandAcknowledgement);
    roomSocketService.onRoomEvent(handleRoomEvent);
    return () => {
      roomSocketService.off("command_ack", handleCommandAcknowledgement);
      roomSocketService.offRoomEvent(handleRoomEvent);
    };
  }, [intentManager]);
}
