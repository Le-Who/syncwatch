import { subClient } from "../redis-actor";
import {
  isRoomEventEnvelope,
  type RoomEventEnvelope,
  type RoomEventBus,
} from "../room-event-bus";
import { sanitizeRoom } from "../room-handler";
import type { Participant } from "../types";

export interface RoomEventSubscriber {
  psubscribe(pattern: string): Promise<unknown> | unknown;
  on(
    event: "pmessage",
    listener: (pattern: string, channel: string, message: string) => void,
  ): unknown;
}

function legacyEnvelope(roomId: string, data: any): RoomEventEnvelope | null {
  switch (data?.type) {
    case "state_update":
      return {
        sourceNodeId: "legacy-redis-publisher",
        roomId,
        event: {
          type: "room_state",
          room: sanitizeRoom(data.payload),
          serverTime: Date.now(),
        },
      };
    case "participant_joined":
      return {
        sourceNodeId: "legacy-redis-publisher",
        roomId,
        event: {
          type: "participant_joined",
          participant: data.payload as Participant,
        },
      };
    case "participant_disconnected":
      return {
        sourceNodeId: "legacy-redis-publisher",
        roomId,
        event: {
          type: "participant_disconnected",
          participantId: data.payload?.participantId,
        },
      };
    case "participant_left":
      return {
        sourceNodeId: "legacy-redis-publisher",
        roomId,
        event: {
          type: "participant_left",
          participantId: data.payload?.participantId,
          ownerId: data.payload?.ownerId ?? null,
        },
      };
    default:
      return null;
  }
}

export function setupPubSubListeners(
  eventBus: RoomEventBus,
  subscriber: RoomEventSubscriber | null = subClient(),
): Promise<void> {
  if (!subscriber) return Promise.resolve();

  subscriber.on("pmessage", (_pattern, channel, message) => {
    if (!channel.startsWith("room_events:")) return;

    try {
      const roomId = channel.slice("room_events:".length);
      if (!roomId) return;
      const data: unknown = JSON.parse(message);
      const envelope = isRoomEventEnvelope(data)
        ? data
        : legacyEnvelope(roomId, data);
      if (envelope) eventBus.handleRemote(envelope);
    } catch (error) {
      console.error("PubSub parse error:", error);
    }
  });
  return Promise.resolve(subscriber.psubscribe("room_events:*")).then(
    () => undefined,
  );
}
