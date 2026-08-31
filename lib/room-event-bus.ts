import { randomUUID } from "node:crypto";
import type { LocalRoomEventEmitter, RoomEvent } from "./room-events";

export interface RoomEventEnvelope {
  sourceNodeId: string;
  roomId: string;
  event: RoomEvent;
}

export interface RoomEventPublisher {
  publish(channel: string, message: string): Promise<unknown> | unknown;
}

const roomEventTypes = new Set<RoomEvent["type"]>([
  "room_state",
  "playback_updated",
  "participant_joined",
  "participant_reconnected",
  "participant_disconnected",
  "participant_left",
  "participant_health",
]);

export function isRoomEventEnvelope(
  value: unknown,
): value is RoomEventEnvelope {
  if (!value || typeof value !== "object") return false;
  const envelope = value as Partial<RoomEventEnvelope>;
  return (
    typeof envelope.sourceNodeId === "string" &&
    typeof envelope.roomId === "string" &&
    Boolean(envelope.event) &&
    typeof envelope.event === "object" &&
    roomEventTypes.has((envelope.event as RoomEvent).type)
  );
}

export class RoomEventBus {
  public readonly nodeId: string;

  constructor(
    private readonly localEmit: LocalRoomEventEmitter,
    private readonly redisPublisher: RoomEventPublisher | null = null,
    nodeId: string = randomUUID(),
  ) {
    this.nodeId = nodeId;
  }

  async publish(roomId: string, event: RoomEvent): Promise<void> {
    this.localEmit(roomId, event);

    if (!this.redisPublisher) return;

    const envelope: RoomEventEnvelope = {
      sourceNodeId: this.nodeId,
      roomId,
      event,
    };
    await this.redisPublisher.publish(
      `room_events:${roomId}`,
      JSON.stringify(envelope),
    );
  }

  handleRemote(envelope: RoomEventEnvelope): void {
    if (envelope.sourceNodeId === this.nodeId) return;
    this.localEmit(envelope.roomId, envelope.event);
  }
}
