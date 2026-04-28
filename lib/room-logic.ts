/**
 * room-logic.ts — Pure, synchronous room state mutation functions.
 *
 * These functions encapsulate ALL business logic for "slow path" commands
 * (playlist edits, video_ended, settings, etc.) that were previously
 * handled by the async redis-queue-worker.
 *
 * Each function takes a room state and command payload, mutates the room
 * in-place, and returns whether the state changed. The caller is
 * responsible for version bumps, persistence, and broadcasting.
 */

import { randomUUID } from "crypto";
import { RoomState } from "./types";

// ─── Helpers ───────────────────────────────────────────────────────────

function getParticipantPermissions(
  room: RoomState,
  participantId: string,
): { canEditPlaylist: boolean; canControlPlayback: boolean; isOwnerOrMod: boolean } {
  const participant = room.participants[participantId];
  if (!participant) {
    return { canEditPlaylist: false, canControlPlayback: false, isOwnerOrMod: false };
  }
  const isOwnerOrMod =
    participant.role === "owner" || participant.role === "moderator";
  const canEditPlaylist =
    room.settings.controlMode === "open" || isOwnerOrMod;
  const canControlPlayback =
    room.settings.controlMode === "open" || isOwnerOrMod;
  return { canEditPlaylist, canControlPlayback, isOwnerOrMod };
}

/** Clamp start position: if within 5s of end, reset to 0. */
function clampStart(item: { lastPosition?: number; startPosition?: number; duration: number }): number {
  let start = item.lastPosition || item.startPosition || 0;
  if (item.duration > 0 && start >= item.duration - 5) {
    start = 0;
    item.lastPosition = 0;
  }
  return start;
}

/** Snapshot the current playback position into the active playlist item. */
function snapshotActiveItemPosition(room: RoomState): void {
  const activeItem = room.playlist.find((i) => i.id === room.currentMediaId);
  if (activeItem) {
    const elapsed =
      room.playback.status === "playing"
        ? (Date.now() - room.playback.baseTimestamp) / 1000
        : 0;
    activeItem.lastPosition =
      room.playback.basePosition + elapsed * room.playback.rate;
  }
}

// ─── Command Handlers ──────────────────────────────────────────────────

export function applyAddItem(
  room: RoomState,
  payload: any,
  participantId: string,
  participantNickname: string,
): boolean {
  const { canEditPlaylist } = getParticipantPermissions(room, participantId);
  if (!canEditPlaylist || room.playlist.length >= 500) return false;

  const newItem = {
    id: randomUUID(),
    url: payload.url,
    provider: payload.provider || "unknown",
    title: payload.title || "Unknown Video",
    duration: payload.duration || 0,
    addedBy: participantNickname,
    startPosition: payload.startPosition || 0,
    thumbnail: payload.thumbnail,
  };
  room.playlist.push(newItem);

  if (!room.currentMediaId) {
    room.currentMediaId = newItem.id;
    room.playback.basePosition = newItem.startPosition || 0;
    room.playback.baseTimestamp = Date.now();
    room.playback.status =
      room.playback.status === "playing" ? "playing" : "paused";
  }
  return true;
}

export function applyAddItems(
  room: RoomState,
  payload: any,
  participantId: string,
  participantNickname: string,
): boolean {
  const { canEditPlaylist } = getParticipantPermissions(room, participantId);
  if (!canEditPlaylist || !Array.isArray(payload.items)) return false;

  const availableSlots = 500 - room.playlist.length;
  if (availableSlots <= 0) return false;

  const itemsToProcess = payload.items.slice(0, availableSlots);
  const uniqueUrls = new Set<string>();
  const existingUrls = new Set<string>();
  for (const pi of room.playlist) {
    if (typeof pi.url === "string") existingUrls.add(pi.url);
  }

  const dedupedItems = [];
  for (const item of itemsToProcess) {
    if (typeof item.url !== "string" || !item.url.trim()) continue;
    if (!uniqueUrls.has(item.url) && !existingUrls.has(item.url)) {
      uniqueUrls.add(item.url);
      dedupedItems.push(item);
    }
  }
  if (dedupedItems.length === 0) return false;

  for (const item of dedupedItems) {
    const newBulkItem = {
      id: randomUUID(),
      url: item.url,
      provider: item.provider || "youtube",
      title: item.title || "Unknown Video",
      duration: item.duration || 0,
      addedBy: participantNickname,
      startPosition: item.startPosition || 0,
      lastPosition: 0,
      thumbnail: item.thumbnail,
    };
    room.playlist.push(newBulkItem);
    if (!room.currentMediaId) {
      room.currentMediaId = newBulkItem.id;
      room.playback.basePosition = newBulkItem.startPosition || 0;
      room.playback.baseTimestamp = Date.now();
      room.playback.status =
        room.playback.status === "playing" ? "playing" : "paused";
    }
  }
  return true;
}

export function applyRemoveItem(
  room: RoomState,
  payload: any,
  participantId: string,
  participantNickname: string,
): boolean {
  const { canEditPlaylist } = getParticipantPermissions(room, participantId);
  if (!canEditPlaylist) return false;

  if (room.currentMediaId === payload.itemId) {
    snapshotActiveItemPosition(room);
  }

  const initialLength = room.playlist.length;
  room.playlist = room.playlist.filter((item) => item.id !== payload.itemId);
  if (room.playlist.length >= initialLength) return false;

  if (room.currentMediaId === payload.itemId) {
    room.currentMediaId =
      room.playlist.length > 0 ? room.playlist[0].id : null;
    room.playback.status =
      room.playback.status === "playing" ? "playing" : "paused";
    // ⚡ Bolt: Use direct O(1) index access instead of Array.find when position is known
    const newHead = room.currentMediaId
      ? room.playlist[0]
      : null;
    room.playback.basePosition = newHead ? clampStart(newHead) : 0;
    room.playback.baseTimestamp = Date.now();
  }
  return true;
}

export function applyReorderPlaylist(
  room: RoomState,
  payload: any,
  participantId: string,
): boolean {
  const { canEditPlaylist } = getParticipantPermissions(room, participantId);
  if (!canEditPlaylist || !Array.isArray(payload.playlist)) return false;

  const itemMap = new Map<string, any>();
  for (const item of room.playlist) itemMap.set(item.id, item);

  const reconciled = [];
  for (const newItem of payload.playlist) {
    const item = itemMap.get(newItem.id);
    if (item) {
      reconciled.push(item);
      itemMap.delete(newItem.id);
    }
  }
  // Append concurrently added items
  for (const leftoverItem of itemMap.values()) {
    reconciled.push(leftoverItem);
  }
  room.playlist = reconciled;
  return true;
}

export function applySetMedia(
  room: RoomState,
  payload: any,
  participantId: string,
  participantNickname: string,
): boolean {
  const { canControlPlayback, canEditPlaylist } = getParticipantPermissions(room, participantId);
  if (!canControlPlayback && !canEditPlaylist) return false;

  snapshotActiveItemPosition(room);

  room.currentMediaId = payload.itemId;
  const targetItem = room.playlist.find((i) => i.id === payload.itemId);
  room.playback.status =
    room.playback.status === "playing" ? "playing" : "paused";
  room.playback.basePosition = targetItem ? clampStart(targetItem) : 0;
  room.playback.baseTimestamp = Date.now();
  room.playback.updatedBy = participantNickname;
  return true;
}

export function applyNext(
  room: RoomState,
  payload: any,
  participantId: string,
  participantNickname: string,
): boolean {
  const { canControlPlayback } = getParticipantPermissions(room, participantId);
  if (!canControlPlayback) return false;
  if (payload.currentMediaId !== room.currentMediaId) return false;

  snapshotActiveItemPosition(room);

  const currentIndex = room.playlist.findIndex(
    (i) => i.id === room.currentMediaId,
  );

  if (currentIndex !== -1 && currentIndex < room.playlist.length - 1) {
    const nextItem = room.playlist[currentIndex + 1];
    room.currentMediaId = nextItem.id;
    room.playback.status = "playing";
    room.playback.basePosition = clampStart(nextItem);
    room.playback.baseTimestamp = Date.now();
    room.playback.updatedBy = participantNickname;
    return true;
  } else if (room.settings.looping && room.playlist.length > 0) {
    const loopItem = room.playlist[0];
    room.currentMediaId = loopItem.id;
    room.playback.status = "playing";
    room.playback.basePosition = clampStart(loopItem);
    room.playback.baseTimestamp = Date.now();
    room.playback.updatedBy = participantNickname;
    return true;
  }
  return false;
}

export function applyClearPlaylist(
  room: RoomState,
  participantId: string,
): boolean {
  const { canEditPlaylist } = getParticipantPermissions(room, participantId);
  if (!canEditPlaylist || room.playlist.length === 0) return false;

  room.playlist = [];
  room.currentMediaId = null;
  room.playback.status = "paused";
  room.playback.basePosition = 0;
  room.playback.baseTimestamp = Date.now();
  return true;
}

export function applyUpdateSettings(
  room: RoomState,
  payload: any,
  participantId: string,
): boolean {
  const { isOwnerOrMod } = getParticipantPermissions(room, participantId);
  if (!isOwnerOrMod) return false;
  room.settings = { ...room.settings, ...payload.settings };
  return true;
}

export function applyVideoEnded(
  room: RoomState,
  payload: any,
  participantId: string,
  participantNickname: string,
): boolean {
  if (payload.currentMediaId !== room.currentMediaId) return false;

  snapshotActiveItemPosition(room);
  const endedIndex = room.playlist.findIndex(
    (i) => i.id === room.currentMediaId,
  );
  // ⚡ Bolt: Eliminate redundant Array.find by reusing Array.findIndex result
  const activeItem = endedIndex !== -1 ? room.playlist[endedIndex] : undefined;

  if (endedIndex !== -1 && endedIndex < room.playlist.length - 1) {
    if (room.settings.autoplayNext) {
      const nextItem = room.playlist[endedIndex + 1];
      room.currentMediaId = nextItem.id;
      room.playback.status = "playing";
      room.playback.basePosition = clampStart(nextItem);
      room.playback.baseTimestamp = Date.now();
      room.playback.updatedBy = participantNickname;
    } else {
      room.playback.status = "paused";
      room.playback.basePosition = activeItem?.duration || 0;
      room.playback.baseTimestamp = Date.now();
      room.playback.updatedBy = participantNickname;
    }
    return true;
  } else if (room.settings.looping && room.playlist.length > 0) {
    const loopItem = room.playlist[0];
    room.currentMediaId = loopItem.id;
    room.playback.status = "playing";
    room.playback.basePosition = clampStart(loopItem);
    room.playback.baseTimestamp = Date.now();
    room.playback.updatedBy = participantNickname;
    return true;
  } else {
    // End of playlist without looping
    room.playback.status = "paused";
    room.playback.basePosition = activeItem?.duration || 0;
    room.playback.baseTimestamp = Date.now();
    room.playback.updatedBy = participantNickname;
    return true;
  }
}

export function applyUpdateDuration(
  room: RoomState,
  payload: any,
): boolean {
  const { mediaId, duration: newDuration } = payload;
  const mediaItem = room.playlist.find((i) => i.id === mediaId);
  if (mediaItem && typeof newDuration === "number" && newDuration > 0) {
    mediaItem.duration = newDuration;
    return true;
  }
  return false;
}

export function applyUpdateRoomName(
  room: RoomState,
  payload: any,
  participantId: string,
): boolean {
  const { isOwnerOrMod } = getParticipantPermissions(room, participantId);
  if (!isOwnerOrMod) return false;
  const { name: newName } = payload;
  if (typeof newName === "string" && newName.trim().length > 0) {
    room.name = newName.trim().slice(0, 100);
    return true;
  }
  return false;
}

export function applyUpdateNickname(
  room: RoomState,
  payload: any,
  participantId: string,
): boolean {
  const participant = room.participants[participantId];
  if (!participant) return false;
  const { nickname: newNick } = payload;
  if (typeof newNick === "string" && newNick.trim().length > 0) {
    participant.nickname = newNick.trim().slice(0, 50);
    return true;
  }
  return false;
}

export function applyUpdateRole(
  room: RoomState,
  payload: any,
  participantId: string,
): boolean {
  const changer = room.participants[participantId];
  if (changer?.role !== "owner") return false;
  const { targetParticipantId, role: newRole } = payload;
  const target = room.participants[targetParticipantId];
  if (
    target &&
    targetParticipantId !== participantId &&
    ["moderator", "viewer"].includes(newRole)
  ) {
    target.role = newRole;
    return true;
  }
  return false;
}

export function applyClaimHost(
  room: RoomState,
  participantId: string,
): boolean {
  const hasOwner = Object.values(room.participants).some(
    (p) => p.role === "owner",
  );
  const claimer = room.participants[participantId];
  if (!hasOwner && claimer) {
    claimer.role = "owner";
    return true;
  }
  return false;
}

export function applyKickParticipant(
  room: RoomState,
  payload: any,
  participantId: string,
): boolean {
  const kicker = room.participants[participantId];
  if (kicker?.role !== "owner") return false;
  const { targetParticipantId: kickTargetId } = payload;
  const kickTarget = room.participants[kickTargetId];
  if (kickTarget && kickTargetId !== participantId) {
    delete room.participants[kickTargetId];
    return true;
  }
  return false;
}

// ─── Dispatcher ────────────────────────────────────────────────────────

/**
 * Apply any slow-path command to a room state.
 * Returns true if state was mutated.
 */
export function applySlowCommand(
  room: RoomState,
  type: string,
  payload: any,
  participantId: string,
  participantNickname: string,
): boolean {
  switch (type) {
    case "add_item":
      return applyAddItem(room, payload, participantId, participantNickname);
    case "add_items":
      return applyAddItems(room, payload, participantId, participantNickname);
    case "remove_item":
      return applyRemoveItem(room, payload, participantId, participantNickname);
    case "reorder_playlist":
      return applyReorderPlaylist(room, payload, participantId);
    case "set_media":
      return applySetMedia(room, payload, participantId, participantNickname);
    case "next":
      return applyNext(room, payload, participantId, participantNickname);
    case "clear_playlist":
      return applyClearPlaylist(room, participantId);
    case "update_settings":
      return applyUpdateSettings(room, payload, participantId);
    case "video_ended":
      return applyVideoEnded(room, payload, participantId, participantNickname);
    case "update_duration":
      return applyUpdateDuration(room, payload);
    case "update_room_name":
      return applyUpdateRoomName(room, payload, participantId);
    case "update_nickname":
      return applyUpdateNickname(room, payload, participantId);
    case "update_role":
      return applyUpdateRole(room, payload, participantId);
    case "claim_host":
      return applyClaimHost(room, participantId);
    case "kick_participant":
      return applyKickParticipant(room, payload, participantId);
    default:
      return false;
  }
}
