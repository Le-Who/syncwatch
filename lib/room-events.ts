import type { Server } from "socket.io";
import type {
  CanonicalPlaybackStatus,
  Participant,
  PlaybackHealth,
  RoomState,
} from "./types";

export interface CanonicalPlayback {
  mediaItemId: string | null;
  status: CanonicalPlaybackStatus;
  basePosition: number;
  baseTimestamp: number;
  rate: number;
  sequence: number;
  updatedBy: string;
  lastActionNonce?: string;
}

export type RoomEvent =
  | {
      type: "room_state";
      room: RoomState;
      serverTime: number;
      excludeSocketId?: string;
    }
  | {
      type: "playback_updated";
      playback: CanonicalPlayback;
      serverTime: number;
    }
  | { type: "participant_joined"; participant: Participant }
  | { type: "participant_reconnected"; participant: Participant }
  | { type: "participant_disconnected"; participantId: string }
  | {
      type: "participant_left";
      participantId: string;
      ownerId: string | null;
    }
  | {
      type: "participant_health";
      participantId: string;
      health: PlaybackHealth;
    };

export type LocalRoomEventEmitter = (roomId: string, event: RoomEvent) => void;

function assertNever(value: never): never {
  throw new Error(`Unhandled room event: ${JSON.stringify(value)}`);
}

export function emitRoomEventToSocketIo(
  io: Pick<Server, "to">,
  roomId: string,
  event: RoomEvent,
): void {
  const room = io.to(roomId);

  switch (event.type) {
    case "room_state": {
      const recipients = event.excludeSocketId
        ? room.except(event.excludeSocketId)
        : room;
      recipients.emit("room_state", {
        room: event.room,
        serverTime: event.serverTime,
      });
      return;
    }
    case "playback_updated":
      room.emit("playback_updated", {
        playback: event.playback,
        serverTime: event.serverTime,
      });
      return;
    case "participant_joined":
      room.emit("participant_joined", event.participant);
      return;
    case "participant_reconnected":
      room.emit("participant_reconnected", event.participant);
      return;
    case "participant_disconnected":
      room.emit("participant_disconnected", {
        participantId: event.participantId,
      });
      return;
    case "participant_left":
      room.emit("participant_left", {
        participantId: event.participantId,
        ownerId: event.ownerId,
      });
      return;
    case "participant_health":
      room.emit("participant_health", {
        participantId: event.participantId,
        health: event.health,
      });
      return;
    default:
      return assertNever(event);
  }
}
