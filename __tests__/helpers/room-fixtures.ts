import { createEmptyRoom } from "../../lib/room-handler";
import type { Participant, RoomState } from "../../lib/types";

export function participant(
  id: string,
  role: Participant["role"] = "viewer",
  joinedAt = 0,
): Participant {
  return {
    id,
    nickname: id,
    role,
    joinedAt,
    lastSeen: joinedAt,
    connection: "connected",
    playbackHealth: "idle",
    readyMediaId: null,
  };
}

export function roomWithParticipants(
  participantCount: number,
  options: {
    leaderId?: string | null;
    ownerId?: string;
    moderatorIds?: string[];
  } = {},
): RoomState {
  const room = createEmptyRoom("room-test", "Test Room");
  const ownerId = options.ownerId ?? "p0";
  room.participants = Object.fromEntries(
    Array.from({ length: participantCount }, (_, index) => {
      const id = `p${index}`;
      const role =
        id === ownerId
          ? "owner"
          : options.moderatorIds?.includes(id)
            ? "moderator"
            : "viewer";
      return [
        id,
        { ...participant(id, role, index), connectionIds: [`socket-${id}`] },
      ];
    }),
  );
  room.leaderId = options.leaderId ?? null;
  return room;
}

export function roomWithOwnerAndFourFriends(): RoomState {
  return roomWithParticipants(5, {
    ownerId: "p0",
    moderatorIds: ["p1", "p2"],
    leaderId: null,
  });
}
