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
  connectionId?: string,
): RoomState {
  const existing = room.participants[requested.id];
  if (
    existing &&
    existing.connection !== "connected" &&
    now - existing.lastSeen >= PARTICIPANT_GRACE_MS
  ) {
    const roomAfterDeparture = removeParticipantAfterGrace(
      room,
      requested.id,
      now,
    );
    return joinParticipant(
      roomAfterDeparture,
      {
        ...requested,
        role: "viewer",
        joinedAt: now,
        lastSeen: now,
        connection: "connected",
        connectionIds: [],
      },
      now,
      connectionId,
    );
  }
  let nextParticipant: Participant;

  if (existing) {
    const connectionIds = new Set([
      ...(existing.connectionIds ?? []),
      ...(requested.connectionIds ?? []),
    ]);
    if (connectionId) connectionIds.add(connectionId);
    nextParticipant = {
      ...existing,
      ...requested,
      id: existing.id,
      nickname: requested.nickname || existing.nickname,
      role: existing.role,
      joinedAt: existing.joinedAt,
      connection: "connected",
      connectionIds: [...connectionIds],
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
      connectionIds: connectionId
        ? [connectionId]
        : Array.from(new Set(requested.connectionIds ?? [])),
    };
  }

  delete nextParticipant.disconnected;

  return ensureOwnerWhenConnected(
    withParticipantChange(
      room,
      { ...room.participants, [nextParticipant.id]: nextParticipant },
      now,
    ),
    now,
  );
}

export function markParticipantDisconnected(
  room: RoomState,
  participantId: string,
  now: number,
  connectionId?: string,
): RoomState {
  const participant = room.participants[participantId];
  if (!participant) return room;

  const activeConnectionIds = participant.connectionIds ?? [];
  if (connectionId && !activeConnectionIds.includes(connectionId)) return room;
  const connectionIds = connectionId
    ? activeConnectionIds.filter((activeId) => activeId !== connectionId)
    : [];
  const hasActiveConnection = connectionIds.length > 0;
  const nextParticipant: Participant = {
    ...participant,
    connection: hasActiveConnection ? "connected" : "reconnecting",
    connectionIds,
    lastSeen: now,
    ...(hasActiveConnection ? {} : { disconnected: true }),
  };
  if (hasActiveConnection) delete nextParticipant.disconnected;

  return withParticipantChange(
    room,
    {
      ...room.participants,
      [participantId]: nextParticipant,
    },
    now,
  );
}

function compareParticipantAge(left: Participant, right: Participant): number {
  return left.joinedAt - right.joinedAt || left.id.localeCompare(right.id);
}

function hasAuthoritativeConnection(participant: Participant): boolean {
  return (
    participant.connection === "connected" &&
    (participant.connectionIds?.length ?? 0) > 0
  );
}

function isValidOwner(participant: Participant, now: number): boolean {
  return (
    participant.role === "owner" &&
    (hasAuthoritativeConnection(participant) ||
      (participant.connection !== "connected" &&
        now - participant.lastSeen < PARTICIPANT_GRACE_MS))
  );
}

function electOwner(participants: Participant[]): Participant | null {
  const connected = participants.filter(hasAuthoritativeConnection);
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

function ensureOwnerWhenConnected(room: RoomState, now: number): RoomState {
  const participantValues = Object.values(room.participants);
  if (!participantValues.some(hasAuthoritativeConnection)) {
    return room;
  }

  const validOwner = participantValues
    .filter((participant) => isValidOwner(participant, now))
    .sort(compareParticipantAge)[0];
  const selectedOwner = validOwner ?? electOwner(participantValues);
  if (!selectedOwner) return room;

  let changed = false;
  const participants = Object.fromEntries(
    Object.entries(room.participants).map(([id, participant]) => {
      const role: Participant["role"] =
        id === selectedOwner.id
          ? "owner"
          : participant.role === "owner"
            ? "viewer"
            : participant.role;
      changed ||= role !== participant.role;
      return [
        id,
        role === participant.role ? participant : { ...participant, role },
      ];
    }),
  );

  return changed ? { ...room, participants } : room;
}

export function upgradeParticipantIdentity(
  room: RoomState,
  currentParticipantId: string,
  replacement: { id: string; nickname: string },
  now: number,
  connectionId: string,
): RoomState {
  const current = room.participants[currentParticipantId];
  if (!current) return room;

  if (replacement.id === currentParticipantId) {
    const connectionIds = Array.from(
      new Set([...(current.connectionIds ?? []), connectionId]),
    );
    const participant: Participant = {
      ...current,
      nickname: replacement.nickname || current.nickname,
      connection: "connected",
      connectionIds,
      lastSeen: now,
    };
    delete participant.disconnected;
    return ensureOwnerWhenConnected(
      withParticipantChange(
        room,
        { ...room.participants, [currentParticipantId]: participant },
        now,
      ),
      now,
    );
  }

  const currentConnectionIds = current.connectionIds ?? [];
  const remainingCurrentConnectionIds = currentConnectionIds.filter(
    (activeId) => activeId !== connectionId,
  );
  const replacesCurrentIdentity =
    currentConnectionIds.length === 0 ||
    remainingCurrentConnectionIds.length === 0;
  const existingReplacement = room.participants[replacement.id];
  const replacementConnectionIds = Array.from(
    new Set([...(existingReplacement?.connectionIds ?? []), connectionId]),
  );
  const replacementParticipant: Participant = {
    ...(existingReplacement ?? current),
    id: replacement.id,
    nickname:
      replacement.nickname || existingReplacement?.nickname || current.nickname,
    role:
      replacesCurrentIdentity && current.role === "owner"
        ? "owner"
        : (existingReplacement?.role ??
          (replacesCurrentIdentity ? current.role : "viewer")),
    joinedAt:
      existingReplacement?.joinedAt ??
      (replacesCurrentIdentity ? current.joinedAt : now),
    lastSeen: now,
    connection: "connected",
    connectionIds: replacementConnectionIds,
  };
  delete replacementParticipant.disconnected;

  const participants = { ...room.participants };
  if (replacesCurrentIdentity) {
    delete participants[currentParticipantId];
  } else {
    participants[currentParticipantId] = {
      ...current,
      connection: "connected",
      connectionIds: remainingCurrentConnectionIds,
    };
  }
  participants[replacement.id] = replacementParticipant;

  const upgradedRoom = {
    ...withParticipantChange(room, participants, now),
    leaderId:
      replacesCurrentIdentity && room.leaderId === currentParticipantId
        ? replacement.id
        : room.leaderId,
  };
  return ensureOwnerWhenConnected(upgradedRoom, now);
}

function selectOwnerAfterDeparture(
  participants: Participant[],
  departing: Participant,
  now: number,
): Participant | null {
  if (departing.role !== "owner") {
    const validOwner = participants
      .filter((participant) => isValidOwner(participant, now))
      .sort(compareParticipantAge)[0];
    if (validOwner) return validOwner;
  }

  return electOwner(participants);
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
  const electedOwner = selectOwnerAfterDeparture(
    remainingEntries.map(([, participant]) => participant),
    departing,
    now,
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
