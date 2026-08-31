/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from "vitest";
import { participant } from "./helpers/room-fixtures";
import { RoomEventBus, type RoomEventEnvelope } from "../lib/room-event-bus";
import { setupPubSubListeners } from "../lib/socket/pubsub";
import { createEmptyRoom } from "../lib/room-handler";

describe("RoomEventBus", () => {
  const joinedEvent = {
    type: "participant_joined",
    participant: participant("p4"),
  } as const;

  it("delivers locally exactly once without Redis", async () => {
    const localEmit = vi.fn();
    const bus = new RoomEventBus(localEmit, null, "node-a");

    await bus.publish("room-a", joinedEvent);

    expect(localEmit).toHaveBeenCalledOnce();
    expect(localEmit).toHaveBeenCalledWith("room-a", joinedEvent);
  });

  it("delivers locally once before publishing to Redis and ignores its self-echo", async () => {
    const calls: string[] = [];
    const localEmit = vi.fn(() => calls.push("local"));
    const redisPublish = vi.fn(async (_channel: string, _message: string) => {
      calls.push("redis");
      return 1;
    });
    const bus = new RoomEventBus(
      localEmit,
      { publish: redisPublish },
      "node-a",
    );

    await bus.publish("room-a", joinedEvent);

    expect(calls).toEqual(["local", "redis"]);
    expect(localEmit).toHaveBeenCalledOnce();
    expect(redisPublish).toHaveBeenCalledOnce();

    const envelope = JSON.parse(
      redisPublish.mock.calls[0][1],
    ) as RoomEventEnvelope;
    expect(envelope).toEqual({
      sourceNodeId: "node-a",
      roomId: "room-a",
      event: joinedEvent,
    });

    bus.handleRemote(envelope);
    expect(localEmit).toHaveBeenCalledOnce();
  });

  it("delivers participant disconnect and leave events from another node", () => {
    const localEmit = vi.fn();
    const bus = new RoomEventBus(localEmit, null, "node-b");

    bus.handleRemote({
      sourceNodeId: "node-a",
      roomId: "room-a",
      event: { type: "participant_disconnected", participantId: "p2" },
    });
    bus.handleRemote({
      sourceNodeId: "node-a",
      roomId: "room-a",
      event: { type: "participant_left", participantId: "p2", ownerId: "p1" },
    });

    expect(localEmit.mock.calls).toEqual([
      ["room-a", { type: "participant_disconnected", participantId: "p2" }],
      [
        "room-a",
        { type: "participant_left", participantId: "p2", ownerId: "p1" },
      ],
    ]);
  });

  it("routes cross-node presence envelopes through the Redis subscriber", () => {
    const localEmit = vi.fn();
    const bus = new RoomEventBus(localEmit, null, "node-b");
    let onMessage:
      | ((pattern: string, channel: string, message: string) => void)
      | undefined;
    const subscriber = {
      psubscribe: vi.fn(),
      on: vi.fn(
        (
          event: string,
          listener: (pattern: string, channel: string, message: string) => void,
        ) => {
          if (event === "pmessage") onMessage = listener;
        },
      ),
    };
    setupPubSubListeners(bus, subscriber);

    const envelope: RoomEventEnvelope = {
      sourceNodeId: "node-a",
      roomId: "room-a",
      event: { type: "participant_disconnected", participantId: "p3" },
    };
    onMessage?.(
      "room_events:*",
      "room_events:room-a",
      JSON.stringify(envelope),
    );

    expect(subscriber.psubscribe).toHaveBeenCalledWith("room_events:*");
    expect(localEmit).toHaveBeenCalledWith("room-a", envelope.event);
  });

  it("keeps origin-socket exclusion local while delivering owner repair to every remote member", async () => {
    const originEmit = vi.fn();
    const remoteEmit = vi.fn();
    const redisPublish = vi.fn().mockResolvedValue(1);
    const originBus = new RoomEventBus(
      originEmit,
      { publish: redisPublish },
      "node-a",
    );
    const remoteBus = new RoomEventBus(remoteEmit, null, "node-b");
    const repairEvent = {
      type: "room_state",
      room: createEmptyRoom("room-a", "Room A"),
      serverTime: 10,
      excludeSocketId: "origin-joining-socket",
    } as const;

    await originBus.publish("room-a", repairEvent);
    const envelope = JSON.parse(
      redisPublish.mock.calls[0][1],
    ) as RoomEventEnvelope;
    remoteBus.handleRemote(envelope);

    expect(originEmit).toHaveBeenCalledOnce();
    expect(originEmit).toHaveBeenCalledWith("room-a", repairEvent);
    expect(envelope.event).not.toHaveProperty("excludeSocketId");
    expect(remoteEmit).toHaveBeenCalledOnce();
    expect(remoteEmit).toHaveBeenCalledWith("room-a", {
      type: "room_state",
      room: repairEvent.room,
      serverTime: repairEvent.serverTime,
    });
  });
});
