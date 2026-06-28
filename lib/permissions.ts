import type { RoomState } from "./types";

export interface ParticipantPermissions {
  canAddPlaylist: boolean;
  canEditPlaylist: boolean;
  canControlPlayback: boolean;
  canManageRoom: boolean;
  isOwner: boolean;
  isOwnerOrMod: boolean;
}

export function getParticipantPermissions(
  room: RoomState,
  participantId: string,
): ParticipantPermissions {
  const participant = room.participants[participantId];
  const isOwner = participant?.role === "owner";
  const isOwnerOrMod =
    participant?.role === "owner" || participant?.role === "moderator";

  return {
    canAddPlaylist: Boolean(participant),
    canEditPlaylist: isOwnerOrMod,
    canControlPlayback: isOwnerOrMod,
    canManageRoom: isOwnerOrMod,
    isOwner,
    isOwnerOrMod,
  };
}
