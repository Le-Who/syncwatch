import type { Participant, RoomState } from "./types";

export const PARTICIPANT_GRACE_MS = 15_000;

function withParticipantChange(
  room: RoomState,
  participants: Record<string, Participant>,
  now: number,
): RoomState {
  return {
    ...room,
    participants,
    version: room.version + 1,
    lastActivity: now,
  };
}

export function joinParticipant(
  room: RoomState,
  requested: Participant,
  now: number,
): RoomState {
  const existing = room.participants[requested.id];
  let nextParticipant: Participant;

  if (existing) {
    nextParticipant = {
      ...existing,
      ...requested,
      id: existing.id,
      nickname: requested.nickname || existing.nickname,
      role: existing.role,
      joinedAt: existing.joinedAt,
      connection: "connected",
      lastSeen: now,
    };
  } else {
    const isFirstParticipant = Object.keys(room.participants).length === 0;
    nextParticipant = {
      ...requested,
      role: isFirstParticipant
        ? "owner"
        : requested.role === "owner"
          ? "viewer"
          : requested.role,
      joinedAt: now,
      lastSeen: now,
      connection: "connected",
    };
  }

  delete nextParticipant.disconnected;

  return withParticipantChange(
    room,
    { ...room.participants, [nextParticipant.id]: nextParticipant },
    now,
  );
}

export function markParticipantDisconnected(
  room: RoomState,
  participantId: string,
  now: number,
): RoomState {
  const participant = room.participants[participantId];
  if (!participant) return room;

  return withParticipantChange(
    room,
    {
      ...room.participants,
      [participantId]: {
        ...participant,
        connection: "reconnecting",
        disconnected: true,
        lastSeen: now,
      },
    },
    now,
  );
}

function compareParticipantAge(left: Participant, right: Participant): number {
  return left.joinedAt - right.joinedAt || left.id.localeCompare(right.id);
}

function electOwner(participants: Participant[]): Participant | null {
  const connected = participants.filter(
    (participant) => participant.connection === "connected",
  );
  const currentOwner = connected
    .filter((participant) => participant.role === "owner")
    .sort(compareParticipantAge)[0];
  if (currentOwner) return currentOwner;

  const moderator = connected
    .filter((participant) => participant.role === "moderator")
    .sort(compareParticipantAge)[0];
  if (moderator) return moderator;

  return (
    connected
      .filter((participant) => participant.role === "viewer")
      .sort(compareParticipantAge)[0] ?? null
  );
}

export function removeParticipantAfterGrace(
  room: RoomState,
  participantId: string,
  now: number,
): RoomState {
  const departing = room.participants[participantId];
  if (
    !departing ||
    departing.connection === "connected" ||
    now - departing.lastSeen < PARTICIPANT_GRACE_MS
  ) {
    return room;
  }

  const remainingEntries = Object.entries(room.participants).filter(
    ([id]) => id !== participantId,
  );
  const electedOwner = electOwner(
    remainingEntries.map(([, participant]) => participant),
  );
  const participants: Record<string, Participant> = Object.fromEntries(
    remainingEntries.map(([id, participant]) => {
      const role: Participant["role"] =
        id === electedOwner?.id
          ? "owner"
          : participant.role === "owner"
            ? "viewer"
            : participant.role;
      return [id, { ...participant, role }];
    }),
  );

  return {
    ...withParticipantChange(room, participants, now),
    leaderId: room.leaderId === participantId ? null : room.leaderId,
  };
}
