/**
 * room-logic.ts — Pure, synchronous room state mutation functions.
 *
 * These functions encapsulate business logic for room commands
 * (playlist edits, video_ended, settings, etc.) that were previously
 * handled by the async redis-queue-worker.
 *
 * Each function takes a room state and command payload, mutates the room
 * in-place, and returns whether the state changed. The caller is
 * responsible for version bumps, persistence, and broadcasting.
 */

import { randomUUID } from "crypto";
import { PlaylistItem, RoomState } from "./types";
import { getParticipantPermissions } from "./permissions";

export const FAST_COMMAND_TYPES = [
  "play",
  "pause",
  "seek",
  "update_rate",
  "buffering",
  "sync_correction",
] as const;

export type FastCommandType = (typeof FAST_COMMAND_TYPES)[number];
export type FastCommandResult = "changed" | "unchanged" | "unauthorized" | "invalid";

export function isFastCommand(type: string): type is FastCommandType {
  return (FAST_COMMAND_TYPES as readonly string[]).includes(type);
}

// ─── Helpers ───────────────────────────────────────────────────────────

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

function currentPlaybackPosition(room: RoomState): number {
  const elapsed =
    room.playback.status === "playing"
      ? (Date.now() - room.playback.baseTimestamp) / 1000
      : 0;
  return room.playback.basePosition + elapsed * room.playback.rate;
}

export function applyFastCommand(
  room: RoomState,
  type: string,
  payload: any,
  participantId: string,
  participantNickname: string,
  now = Date.now(),
): FastCommandResult {
  if (!isFastCommand(type)) return "invalid";

  const participant = room.participants[participantId];
  if (!participant) return "unauthorized";

  const { canControlPlayback } = getParticipantPermissions(room, participantId);
  if (!canControlPlayback) return "unauthorized";

  if (type === "play" || type === "seek" || type === "buffering") {
    if (typeof payload?.position !== "number" || payload.position < 0) {
      return "invalid";
    }

    if (type === "play" && room.playback.status === "playing" && !payload.forceSeek) {
      return "unchanged";
    }

    if (type === "play") {
      room.playback.status = "playing";
    } else if (type === "buffering") {
      room.playback.status = "buffering";
    }
    room.playback.basePosition = payload.position;
    room.playback.baseTimestamp = now;
    room.playback.updatedBy = participantNickname;
    if (payload.nonce) room.playback.lastActionNonce = payload.nonce;
    return "changed";
  }

  if (type === "pause") {
    if (typeof payload?.position !== "number" || payload.position < 0) {
      return "invalid";
    }
    if (room.playback.status === "paused") return "unchanged";

    room.playback.status = "paused";
    room.playback.basePosition = payload.position;
    room.playback.baseTimestamp = now;
    room.playback.updatedBy = participantNickname;
    if (payload.nonce) room.playback.lastActionNonce = payload.nonce;
    return "changed";
  }

  if (type === "update_rate") {
    const newRate = payload?.rate;
    if (typeof newRate !== "number" || newRate < 0.25 || newRate > 4.0) {
      return "invalid";
    }

    if (room.playback.status === "playing") {
      const elapsedSeconds = (now - room.playback.baseTimestamp) / 1000;
      room.playback.basePosition += elapsedSeconds * room.playback.rate;
      room.playback.baseTimestamp = now;
    }
    room.playback.rate = newRate;
    room.playback.updatedBy = participantNickname;
    if (payload.nonce) room.playback.lastActionNonce = payload.nonce;
    return "changed";
  }

  if (type === "sync_correction") {
    if (typeof payload?.position !== "number" || payload.position < 0) {
      return "invalid";
    }

    room.playback.basePosition = payload.position;
    room.playback.baseTimestamp = now;
    if (payload.nonce) room.playback.lastActionNonce = payload.nonce;
    return "changed";
  }

  return "invalid";
}

function saveFlashback(room: RoomState): void {
  if (!room.currentMediaId) return;
  room.flashbacks ??= {};
  room.flashbacks[room.currentMediaId] = {
    position: currentPlaybackPosition(room),
    savedAt: Date.now(),
  };
}

function resetReadiness(room: RoomState): void {
  for (const participant of Object.values(room.participants)) {
    participant.ready = false;
  }

  const currentItem = room.playlist.find((i) => i.id === room.currentMediaId);
  if (currentItem) currentItem.readyParticipants = {};
}

function createPlaylistItem(
  payload: any,
  participantId: string,
  participantNickname: string,
): PlaylistItem {
  return {
    id: randomUUID(),
    url: payload.url,
    provider: payload.provider || "unknown",
    title: payload.title || "Unknown Video",
    duration: payload.duration || 0,
    addedBy: participantNickname,
    requesterId: participantId,
    author: payload.author,
    startPosition: payload.startPosition || 0,
    lastPosition: 0,
    thumbnail: payload.thumbnail,
    aspectRatio: payload.aspectRatio,
    isTemporary: Boolean(payload.isTemporary),
    readyParticipants: {},
  };
}

function insertPlaylistItems(
  room: RoomState,
  items: PlaylistItem[],
  insertMode?: string,
): void {
  const shouldInsertNext = insertMode === "next" && room.currentMediaId;
  if (!shouldInsertNext) {
    room.playlist.push(...items);
    return;
  }

  const currentIndex = room.playlist.findIndex((i) => i.id === room.currentMediaId);
  if (currentIndex === -1) {
    room.playlist.push(...items);
    return;
  }
  room.playlist.splice(currentIndex + 1, 0, ...items);
}

function setInitialMediaIfNeeded(room: RoomState, firstItem: PlaylistItem): void {
  if (room.currentMediaId) return;
  room.currentMediaId = firstItem.id;
  room.playback.basePosition = firstItem.startPosition || 0;
  room.playback.baseTimestamp = Date.now();
  room.playback.status =
    room.playback.status === "playing" ? "playing" : "paused";
  resetReadiness(room);
}

// ─── Command Handlers ──────────────────────────────────────────────────

export function applyAddItem(
  room: RoomState,
  payload: any,
  participantId: string,
  participantNickname: string,
): boolean {
  const { canAddPlaylist, canEditPlaylist } = getParticipantPermissions(
    room,
    participantId,
  );
  if (!canAddPlaylist || room.playlist.length >= 500) return false;

  if (room.playlist.some((item) => item.url === payload.url)) return false;

  const newItem = createPlaylistItem(payload, participantId, participantNickname);
  insertPlaylistItems(
    room,
    [newItem],
    canEditPlaylist ? payload.insertMode : "end",
  );
  setInitialMediaIfNeeded(room, newItem);

  return true;
}

export function applyAddItems(
  room: RoomState,
  payload: any,
  participantId: string,
  participantNickname: string,
): boolean {
  const { canAddPlaylist, canEditPlaylist } = getParticipantPermissions(
    room,
    participantId,
  );
  if (!canAddPlaylist || !Array.isArray(payload.items)) return false;

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

  const newItems = dedupedItems.map((item) =>
    createPlaylistItem(
      { ...item, provider: item.provider || "youtube" },
      participantId,
      participantNickname,
    ),
  );
  insertPlaylistItems(
    room,
    newItems,
    canEditPlaylist ? payload.insertMode : "end",
  );
  setInitialMediaIfNeeded(room, newItems[0]);
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
    const newHead = room.currentMediaId
      ? room.playlist.find((i) => i.id === room.currentMediaId)
      : null;
    room.playback.basePosition = newHead ? clampStart(newHead) : 0;
    room.playback.baseTimestamp = Date.now();
    resetReadiness(room);
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
  resetReadiness(room);
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
    resetReadiness(room);
    return true;
  } else if (room.settings.looping && room.playlist.length > 0) {
    const loopItem = room.playlist[0];
    room.currentMediaId = loopItem.id;
    room.playback.status = "playing";
    room.playback.basePosition = clampStart(loopItem);
    room.playback.baseTimestamp = Date.now();
    room.playback.updatedBy = participantNickname;
    resetReadiness(room);
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
  room.leaderId = null;
  room.flashbacks = {};
  room.playback.status = "paused";
  room.playback.basePosition = 0;
  room.playback.baseTimestamp = Date.now();
  resetReadiness(room);
  return true;
}

export function applyUpdateSettings(
  room: RoomState,
  payload: any,
  participantId: string,
): boolean {
  const { isOwnerOrMod } = getParticipantPermissions(room, participantId);
  if (!isOwnerOrMod) return false;
  const {
    controlMode: _legacyControlMode,
    playlistMode: _legacyPlaylistMode,
    requestLeaderOnPause: _legacyRequestLeaderOnPause,
    unpauseWithoutLeader: _legacyUnpauseWithoutLeader,
    ...nextSettings
  } = payload.settings || {};
  room.settings = { ...room.settings, ...nextSettings };
  delete (room.settings as any).controlMode;
  delete (room.settings as any).playlistMode;
  delete (room.settings as any).requestLeaderOnPause;
  delete (room.settings as any).unpauseWithoutLeader;
  return true;
}

export function applyVideoEnded(
  room: RoomState,
  payload: any,
  participantId: string,
  participantNickname: string,
): boolean {
  const { canControlPlayback } = getParticipantPermissions(room, participantId);
  if (!canControlPlayback) return false;
  if (payload.currentMediaId !== room.currentMediaId) return false;

  snapshotActiveItemPosition(room);
  const activeItem = room.playlist.find((i) => i.id === room.currentMediaId);
  const endedIndex = room.playlist.findIndex(
    (i) => i.id === room.currentMediaId,
  );

  if (endedIndex !== -1 && endedIndex < room.playlist.length - 1) {
    if (room.settings.autoplayNext) {
      const nextItem = room.playlist[endedIndex + 1];
      room.currentMediaId = nextItem.id;
      room.playback.status = "playing";
      room.playback.basePosition = clampStart(nextItem);
      room.playback.baseTimestamp = Date.now();
      room.playback.updatedBy = participantNickname;
      resetReadiness(room);
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
    resetReadiness(room);
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

export function applySetNextItem(
  room: RoomState,
  payload: any,
  participantId: string,
): boolean {
  const { canEditPlaylist } = getParticipantPermissions(room, participantId);
  if (!canEditPlaylist || !room.currentMediaId) return false;

  const currentIndex = room.playlist.findIndex((i) => i.id === room.currentMediaId);
  const targetIndex = room.playlist.findIndex((i) => i.id === payload.itemId);
  if (currentIndex === -1 || targetIndex === -1 || currentIndex === targetIndex) {
    return false;
  }

  const [target] = room.playlist.splice(targetIndex, 1);
  const newCurrentIndex = room.playlist.findIndex((i) => i.id === room.currentMediaId);
  room.playlist.splice(newCurrentIndex + 1, 0, target);
  return true;
}

export function applyToggleItemTemporary(
  room: RoomState,
  payload: any,
  participantId: string,
): boolean {
  const { canEditPlaylist } = getParticipantPermissions(room, participantId);
  if (!canEditPlaylist) return false;

  const target = room.playlist.find((i) => i.id === payload.itemId);
  if (!target) return false;
  target.isTemporary = !target.isTemporary;
  return true;
}

export function applyShufflePlaylist(
  room: RoomState,
  participantId: string,
): boolean {
  const { canEditPlaylist } = getParticipantPermissions(room, participantId);
  if (!canEditPlaylist || room.playlist.length < 3 || !room.currentMediaId) {
    return false;
  }

  const current = room.playlist.find((i) => i.id === room.currentMediaId);
  const rest = room.playlist.filter((i) => i.id !== room.currentMediaId);
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  room.playlist = current ? [current, ...rest] : rest;
  return true;
}

export function applyRequestLeader(
  room: RoomState,
  participantId: string,
): boolean {
  const participant = room.participants[participantId];
  if (!participant) return false;

  if (room.leaderId === participantId) return false;
  if (room.leaderId && room.participants[room.leaderId]) return false;

  room.leaderId = participantId;
  return true;
}

export function applyReleaseLeader(
  room: RoomState,
  participantId: string,
): boolean {
  if (!room.leaderId) return false;
  const { isOwnerOrMod } = getParticipantPermissions(room, participantId);
  if (room.leaderId !== participantId && !isOwnerOrMod) return false;

  room.leaderId = null;
  return true;
}

export function applyTransferOwner(
  room: RoomState,
  payload: any,
  participantId: string,
): boolean {
  const owner = room.participants[participantId];
  const target = room.participants[payload.targetParticipantId];
  if (owner?.role !== "owner" || !target || target.id === owner.id) return false;

  owner.role = "moderator";
  target.role = "owner";
  return true;
}

export function applyMediaReady(
  room: RoomState,
  payload: any,
  participantId: string,
): boolean {
  const participant = room.participants[participantId];
  if (!participant || payload.mediaId !== room.currentMediaId) return false;

  const currentItem = room.playlist.find((i) => i.id === room.currentMediaId);
  if (!currentItem) return false;

  const ready = payload.ready !== false;
  participant.ready = ready;
  currentItem.readyParticipants ??= {};
  currentItem.readyParticipants[participantId] = ready;
  return true;
}

export function applyRewind(
  room: RoomState,
  payload: any,
  participantId: string,
  participantNickname: string,
): boolean {
  const { canControlPlayback } = getParticipantPermissions(room, participantId);
  if (!canControlPlayback || !room.currentMediaId) return false;

  saveFlashback(room);
  const duration =
    room.playlist.find((i) => i.id === room.currentMediaId)?.duration || 0;
  const nextPosition = Math.max(
    0,
    duration > 0
      ? Math.min(duration, currentPlaybackPosition(room) + payload.seconds)
      : currentPlaybackPosition(room) + payload.seconds,
  );

  room.playback.basePosition = nextPosition;
  room.playback.baseTimestamp = Date.now();
  room.playback.updatedBy = participantNickname;
  return true;
}

export function applyFlashback(
  room: RoomState,
  participantId: string,
  participantNickname: string,
): boolean {
  const { canControlPlayback } = getParticipantPermissions(room, participantId);
  if (!canControlPlayback || !room.currentMediaId) return false;

  const flashback = room.flashbacks?.[room.currentMediaId];
  if (!flashback) return false;

  const currentPosition = currentPlaybackPosition(room);
  room.flashbacks[room.currentMediaId] = {
    position: currentPosition,
    savedAt: Date.now(),
  };
  room.playback.basePosition = flashback.position;
  room.playback.baseTimestamp = Date.now();
  room.playback.updatedBy = participantNickname;
  return true;
}

export function applySendChat(
  room: RoomState,
  payload: any,
  participantId: string,
  participantNickname: string,
): boolean {
  const participant = room.participants[participantId];
  const message =
    typeof payload.message === "string" ? payload.message.trim() : "";
  if (!participant || !message) return false;

  room.chat ??= [];
  room.chat.push({
    id: randomUUID(),
    participantId,
    nickname: participantNickname || participant.nickname,
    message: message.slice(0, 500),
    sentAt: Date.now(),
  });

  if (room.chat.length > 100) {
    room.chat = room.chat.slice(-100);
  }

  return true;
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
    if (room.leaderId === kickTargetId) {
      room.leaderId = null;
    }
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
    case "set_next_item":
      return applySetNextItem(room, payload, participantId);
    case "toggle_item_temporary":
      return applyToggleItemTemporary(room, payload, participantId);
    case "shuffle_playlist":
      return applyShufflePlaylist(room, participantId);
    case "request_leader":
      return applyRequestLeader(room, participantId);
    case "release_leader":
      return applyReleaseLeader(room, participantId);
    case "transfer_owner":
      return applyTransferOwner(room, payload, participantId);
    case "media_ready":
      return applyMediaReady(room, payload, participantId);
    case "rewind":
      return applyRewind(room, payload, participantId, participantNickname);
    case "flashback":
      return applyFlashback(room, participantId, participantNickname);
    case "send_chat":
      return applySendChat(room, payload, participantId, participantNickname);
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
