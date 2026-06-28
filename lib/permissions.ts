import type { RoomState } from "./types";

export interface ParticipantPermissions {
  canAddPlaylist: boolean;
  canEditPlaylist: boolean;
  canControlPlayback: boolean;
  canManageRoom: boolean;
  isOwner: boolean;
  isOwnerOrMod: boolean;
  isLeader: boolean;
  hasActiveLeader: boolean;
}

export function getParticipantPermissions(
  room: RoomState,
  participantId: string,
): ParticipantPermissions {
  const participant = room.participants[participantId];
  const isOwner = participant?.role === "owner";
  const isOwnerOrMod =
    participant?.role === "owner" || participant?.role === "moderator";
  const hasActiveLeader = Boolean(
    room.leaderId && room.participants[room.leaderId],
  );
  const isLeader = hasActiveLeader && room.leaderId === participantId;
  const canControlPlayback = Boolean(
    participant && (!hasActiveLeader || isLeader || isOwnerOrMod),
  );

  return {
    canAddPlaylist: Boolean(participant),
    canEditPlaylist: isOwnerOrMod,
    canControlPlayback,
    canManageRoom: isOwnerOrMod,
    isOwner,
    isOwnerOrMod,
    isLeader,
    hasActiveLeader,
  };
}
