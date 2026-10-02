import type { CanonicalPlayback, RoomEvent } from "./room-events";
import type { RoomState } from "./types";

export type CanonicalRoomConsumer = {
  room: RoomState;
  deliveryVersion: number;
  fullSequence?: number;
  pendingPlayback?: CanonicalPlayback;
};

/** Applies the canonical room/playback event rules shared by client stores. */
export function reduceCanonicalRoomEvent(
  state: CanonicalRoomConsumer,
  event: RoomEvent,
): CanonicalRoomConsumer {
  if (event.type === "room_state") {
    if (
      state.room.id === event.room.id &&
      (state.room.generation ?? "legacy") !==
        (event.room.generation ?? "legacy")
    ) {
      return event.authoritativeRecovery
        ? {
            room: event.room,
            fullSequence: event.room.sequence,
            deliveryVersion: state.deliveryVersion + 1,
          }
        : state;
    }
    if (
      state.room.id === event.room.id &&
      event.room.sequence < (state.fullSequence ?? state.room.sequence)
    ) {
      return state;
    }
    const sameRoom = state.room.id === event.room.id;
    const room =
      sameRoom && event.room.sequence < state.room.sequence
        ? {
            ...event.room,
            currentMediaId: state.room.currentMediaId,
            mediaRun: state.room.mediaRun,
            playback: state.room.playback,
            sequence: state.room.sequence,
          }
        : event.room;
    const next: CanonicalRoomConsumer = {
      room,
      deliveryVersion:
        state.deliveryVersion +
        (!sameRoom || event.room.sequence >= state.room.sequence ? 1 : 0),
      fullSequence: event.room.sequence,
      pendingPlayback: sameRoom ? state.pendingPlayback : undefined,
    };
    if (next.pendingPlayback && next.pendingPlayback.sequence <= room.sequence)
      next.pendingPlayback = undefined;
    return next.pendingPlayback
      ? reduceCanonicalRoomEvent(next, {
          type: "playback_updated",
          playback: next.pendingPlayback,
          serverTime: event.serverTime,
        })
      : next;
  }

  if (event.type === "playback_updated") {
    const playback = event.playback;
    if (
      (playback.generation ?? "legacy") !== (state.room.generation ?? "legacy")
    )
      return state;
    if (playback.sequence <= state.room.sequence) {
      return state;
    }
    if (
      playback.mediaItemId !== state.room.currentMediaId ||
      (playback.mediaRun ?? 0) !== (state.room.mediaRun ?? 0)
    ) {
      return {
        ...state,
        fullSequence: state.fullSequence ?? state.room.sequence,
        pendingPlayback:
          playback.sequence > (state.pendingPlayback?.sequence ?? -1)
            ? playback
            : state.pendingPlayback,
      };
    }
    return {
      fullSequence: state.fullSequence ?? state.room.sequence,
      pendingPlayback: undefined,
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
