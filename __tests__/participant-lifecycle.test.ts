import { describe, expect, it } from "vitest";
import { createEmptyRoom } from "../lib/room-handler";
import {
  joinParticipant,
  markParticipantDisconnected,
  removeParticipantAfterGrace,
} from "../lib/participant-lifecycle";
import {
  participant,
  roomWithOwnerAndFourFriends,
  roomWithParticipants,
} from "./helpers/room-fixtures";

describe("participant lifecycle", () => {
  it.each([1, 5, 25])("converges to %i joined participants", (count) => {
    let room = createEmptyRoom("room-a", "Room A");

    for (let index = 0; index < count; index++) {
      room = joinParticipant(
        room,
        participant(`p${index}`, index === 0 ? "owner" : "viewer", index),
        index,
      );
    }

    expect(Object.keys(room.participants)).toHaveLength(count);
  });

  it("marks a participant reconnecting without mutating the input room", () => {
    const room = roomWithParticipants(3, { leaderId: "p2" });

    const next = markParticipantDisconnected(room, "p2", 10_000);

    expect(next.participants.p2.connection).toBe("reconnecting");
    expect(next.participants.p2.lastSeen).toBe(10_000);
    expect(room.participants.p2.connection).toBe("connected");
    expect(next.leaderId).toBe("p2");
  });

  it("reconnects inside 15 seconds while preserving identity, role, and leader", () => {
    const room = roomWithParticipants(3, {
      moderatorIds: ["p1"],
      leaderId: "p1",
    });
    const disconnected = markParticipantDisconnected(room, "p1", 10_000);
    const requested = participant("p1", "viewer", 24_000);
    requested.nickname = "Renamed";

    const next = joinParticipant(disconnected, requested, 24_000);

    expect(next.participants.p1).toMatchObject({
      id: "p1",
      nickname: "Renamed",
      role: "moderator",
      joinedAt: 1,
      connection: "connected",
      lastSeen: 24_000,
    });
    expect(next.leaderId).toBe("p1");
  });

  it("preserves owner identity at 14,999ms of reconnect grace", () => {
    const room = roomWithParticipants(3, {
      moderatorIds: ["p1"],
      leaderId: "p0",
    });
    const disconnected = markParticipantDisconnected(room, "p0", 1_000);

    const next = joinParticipant(
      disconnected,
      participant("p0", "viewer", 15_999),
      15_999,
      "replacement-socket",
    );

    expect(next.participants.p0).toMatchObject({
      role: "owner",
      joinedAt: 0,
      connection: "connected",
      connectionIds: ["replacement-socket"],
    });
    expect(next.leaderId).toBe("p0");
  });

  it("expires owner identity at 15,000ms before it rejoins as a viewer", () => {
    const room = roomWithParticipants(3, {
      moderatorIds: ["p1"],
      leaderId: "p0",
    });
    const disconnected = markParticipantDisconnected(room, "p0", 1_000);

    const next = joinParticipant(
      disconnected,
      participant("p0", "owner", 16_000),
      16_000,
      "replacement-socket",
    );

    expect(next.participants.p1.role).toBe("owner");
    expect(next.participants.p0).toMatchObject({
      role: "viewer",
      joinedAt: 16_000,
      connection: "connected",
      connectionIds: ["replacement-socket"],
    });
    expect(next.leaderId).toBeNull();
    expect(
      Object.values(next.participants).filter((p) => p.role === "owner"),
    ).toHaveLength(1);
  });

  it("does not remove a reconnecting participant before grace expires", () => {
    const room = markParticipantDisconnected(
      roomWithParticipants(3),
      "p2",
      10_000,
    );

    const next = removeParticipantAfterGrace(room, "p2", 24_999);

    expect(next.participants.p2).toBeDefined();
  });

  it("elects the oldest connected moderator after owner grace expires", () => {
    const room = roomWithOwnerAndFourFriends();
    const disconnected = markParticipantDisconnected(room, "p0", 1_000);

    const next = removeParticipantAfterGrace(disconnected, "p0", 16_000);

    expect(
      Object.values(next.participants).filter((p) => p.role === "owner"),
    ).toHaveLength(1);
    expect(next.participants.p1.role).toBe("owner");
  });

  it("preserves a reconnecting owner when an unrelated viewer expires", () => {
    const room = roomWithParticipants(3, {
      moderatorIds: ["p1"],
      leaderId: "p0",
    });
    const ownerInGrace = markParticipantDisconnected(room, "p0", 2_000);
    const viewerInGrace = markParticipantDisconnected(
      ownerInGrace,
      "p2",
      1_000,
    );

    const next = removeParticipantAfterGrace(viewerInGrace, "p2", 16_000);

    expect(next.participants.p0).toMatchObject({
      role: "owner",
      connection: "reconnecting",
    });
    expect(next.participants.p1.role).toBe("moderator");
    expect(
      Object.values(next.participants).filter((p) => p.role === "owner"),
    ).toHaveLength(1);
  });

  it("skips disconnected moderators and deterministically elects the oldest connected viewer", () => {
    const room = roomWithParticipants(5, {
      moderatorIds: ["p1", "p2"],
      leaderId: "p0",
    });
    room.participants.p1.connection = "reconnecting";
    room.participants.p2.connection = "disconnected";
    room.participants.p3.joinedAt = 50;
    room.participants.p4.joinedAt = 40;
    const disconnected = markParticipantDisconnected(room, "p0", 1_000);

    const next = removeParticipantAfterGrace(disconnected, "p0", 16_000);

    expect(next.participants.p4.role).toBe("owner");
    expect(next.leaderId).toBeNull();
    expect(
      Object.values(next.participants).filter((p) => p.role === "owner"),
    ).toHaveLength(1);
  });

  it("breaks equal joinedAt ties by participant ID instead of object order", () => {
    const room = roomWithParticipants(3);
    room.participants = {
      p0: room.participants.p0,
      p2: { ...room.participants.p2, joinedAt: 10 },
      p1: { ...room.participants.p1, joinedAt: 10 },
    };
    const disconnected = markParticipantDisconnected(room, "p0", 1_000);

    const next = removeParticipantAfterGrace(disconnected, "p0", 16_000);

    expect(next.participants.p1.role).toBe("owner");
  });
});
