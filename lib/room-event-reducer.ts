import type { RoomEvent } from "./room-events";
import type { RoomState } from "./types";

export type CanonicalRoomConsumer = {
  room: RoomState;
  deliveryVersion: number;
};

/** Applies the canonical room/playback event rules shared by client stores. */
export function reduceCanonicalRoomEvent(
  state: CanonicalRoomConsumer,
  event: RoomEvent,
): CanonicalRoomConsumer {
  if (event.type === "room_state") {
    if (
      state.room.id === event.room.id &&
      event.room.sequence < state.room.sequence
    ) {
      return state;
    }
    return {
      room: event.room,
      deliveryVersion: state.deliveryVersion + 1,
    };
  }

  if (event.type === "playback_updated") {
    const playback = event.playback;
    if (
      playback.mediaItemId !== state.room.currentMediaId ||
      playback.sequence <= state.room.sequence
    ) {
      return state;
    }
    return {
      room: {
        ...state.room,
        sequence: playback.sequence,
        playback: {
          status: playback.status,
          basePosition: playback.basePosition,
          baseTimestamp: playback.baseTimestamp,
          rate: playback.rate,
          updatedBy: playback.updatedBy,
          ...(playback.lastActionNonce
            ? { lastActionNonce: playback.lastActionNonce }
            : {}),
        },
      },
      deliveryVersion: state.deliveryVersion + 1,
    };
  }

  return state;
}
