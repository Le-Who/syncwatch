import { getRedisClient } from "./redis-rate-limit";
import {
  getRedisRoom,
  setRedisRoom,
  publishRoomEvent,
  withLock,
} from "./redis-actor";
import { randomUUID } from "crypto";
import { sanitizeRoom } from "../server";

export async function processQueueForRoom(roomId: string) {
  const redisClient = getRedisClient();
  if (!redisClient) return;

  // Use a Redis lock so only one worker node processes a room's queue at a time
  await withLock(`queue_lock:${roomId}`, 5000, async () => {
    let processedCount = 0;
    let stateChanged = false;

    let room = await getRedisRoom(roomId);
    if (!room) return;

    const baseVersion = room.version;

    while (true) {
      const item = await redisClient.lpop(`room_queue:${roomId}`);
      if (!item) break; // Queue empty

      try {
        const cmd = JSON.parse(item);
        const {
          type,
          payload,
          participantId,
          participantNickname,
          sequence,
          timestamp,
        } = cmd;

        // Discard stale commands older than 30s
        if (Date.now() - timestamp > 30000) continue;

        const participant = room.participants[participantId];
        if (!participant) continue;

        const isOwnerOrMod =
          participant.role === "owner" || participant.role === "moderator";
        const canEditPlaylist =
          room.settings.controlMode === "open" || isOwnerOrMod;
        const canControlPlayback =
          room.settings.controlMode === "open" ||
          isOwnerOrMod ||
          (room.settings.controlMode === "hybrid" &&
            ["play", "pause", "seek", "buffering", "next"].includes(type));

        // Same logic as before
        switch (type) {
          case "add_item":
            if (!canEditPlaylist || room.playlist.length >= 500) break;
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
            stateChanged = true;
            break;

          case "add_items":
            if (!canEditPlaylist || !Array.isArray(payload.items)) break;
            const availableSlots = 500 - room.playlist.length;
            if (availableSlots <= 0) break;
            const itemsToProcess = payload.items.slice(0, availableSlots);
            const uniqueUrls = new Set<string>();
            const dedupedItemsToProcess = [];
            for (const item of itemsToProcess) {
              if (typeof item.url !== "string" || !item.url.trim()) continue;
              const alreadyExists = room.playlist.some(
                (pi: any) => pi.url === item.url,
              );
              if (!uniqueUrls.has(item.url) && !alreadyExists) {
                uniqueUrls.add(item.url);
                dedupedItemsToProcess.push(item);
              }
            }
            if (dedupedItemsToProcess.length === 0) break;

            for (const item of dedupedItemsToProcess) {
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
            stateChanged = true;
            break;

          case "remove_item":
            if (!canEditPlaylist) break;
            if (room.currentMediaId === payload.itemId) {
              const currentItem = room.playlist.find(
                (i: any) => i.id === payload.itemId,
              );
              if (currentItem && room.playback.status === "playing") {
                const elapsed =
                  (Date.now() - room.playback.baseTimestamp) / 1000;
                currentItem.lastPosition =
                  room.playback.basePosition + elapsed * room.playback.rate;
              }
            }
            const initialLength = room.playlist.length;
            room.playlist = room.playlist.filter(
              (item: any) => item.id !== payload.itemId,
            );
            if (room.playlist.length < initialLength) {
              if (room.currentMediaId === payload.itemId) {
                room.currentMediaId =
                  room.playlist.length > 0 ? room.playlist[0].id : null;
                room.playback.status =
                  room.playback.status === "playing" ? "playing" : "paused";
                const newHead = room.currentMediaId
                  ? room.playlist.find((i: any) => i.id === room.currentMediaId)
                  : null;
                let startHead = newHead
                  ? newHead.lastPosition || newHead.startPosition || 0
                  : 0;
                if (
                  newHead &&
                  newHead.duration > 0 &&
                  startHead >= newHead.duration - 5
                ) {
                  startHead = 0;
                  newHead.lastPosition = 0;
                }
                room.playback.basePosition = startHead;
                room.playback.baseTimestamp = Date.now();
              }
              stateChanged = true;
            }
            break;

          case "reorder_playlist":
            if (!canEditPlaylist || !Array.isArray(payload.playlist)) break;
            const oldIds = new Set(room.playlist.map((i: any) => i.id));
            const newOrderIds = payload.playlist.map((i: any) => i.id);

            // Reconcile arrays instead of blind overwrite (Concurrency Fix)
            const reconciledPlaylist = [];

            // 1. Maintain items that exist in both, in the new order
            for (const id of newOrderIds) {
              const item = room.playlist.find((i: any) => i.id === id);
              if (item) {
                reconciledPlaylist.push(item);
                oldIds.delete(id);
              }
            }

            // 2. Append items that were concurrently added (exist in oldIds but not in payload)
            for (const leftoverId of oldIds) {
              const item = room.playlist.find((i: any) => i.id === leftoverId);
              if (item) reconciledPlaylist.push(item);
            }

            room.playlist = reconciledPlaylist;
            stateChanged = true;
            break;

          case "set_media":
            if (!canControlPlayback && !canEditPlaylist) break;
            const activeItemSet = room.playlist.find(
              (i: any) => i.id === room.currentMediaId,
            );
            if (activeItemSet) {
              const elapsed =
                room.playback.status === "playing"
                  ? (Date.now() - room.playback.baseTimestamp) / 1000
                  : 0;
              activeItemSet.lastPosition =
                room.playback.basePosition + elapsed * room.playback.rate;
            }
            room.currentMediaId = payload.itemId;
            const targetItemForSet = room.playlist.find(
              (i: any) => i.id === payload.itemId,
            );
            room.playback.status =
              room.playback.status === "playing" ? "playing" : "paused";
            let startSet =
              targetItemForSet?.lastPosition ||
              targetItemForSet?.startPosition ||
              0;
            if (
              targetItemForSet &&
              targetItemForSet.duration > 0 &&
              startSet >= targetItemForSet.duration - 5
            ) {
              startSet = 0;
              targetItemForSet.lastPosition = 0;
            }
            room.playback.basePosition = startSet;
            room.playback.baseTimestamp = Date.now();
            room.playback.updatedBy = participantNickname;
            stateChanged = true;
            break;

          case "next":
            if (!canControlPlayback) break;
            if (payload.currentMediaId !== room.currentMediaId) break;
            const activeItemNext = room.playlist.find(
              (i: any) => i.id === room.currentMediaId,
            );
            if (activeItemNext) {
              const elapsed =
                room.playback.status === "playing"
                  ? (Date.now() - room.playback.baseTimestamp) / 1000
                  : 0;
              activeItemNext.lastPosition =
                room.playback.basePosition + elapsed * room.playback.rate;
            }
            const currentIndex = room.playlist.findIndex(
              (i: any) => i.id === room.currentMediaId,
            );
            if (
              currentIndex !== -1 &&
              currentIndex < room.playlist.length - 1
            ) {
              const nextItem = room.playlist[currentIndex + 1];
              room.currentMediaId = nextItem.id;
              room.playback.status = "playing";
              let startNext =
                nextItem.lastPosition || nextItem.startPosition || 0;
              if (nextItem.duration > 0 && startNext >= nextItem.duration - 5) {
                startNext = 0;
                nextItem.lastPosition = 0;
              }
              room.playback.basePosition = startNext;
              room.playback.baseTimestamp = Date.now();
              room.playback.updatedBy = participantNickname;
              stateChanged = true;
            } else if (room.settings.looping && room.playlist.length > 0) {
              const loopItem = room.playlist[0];
              room.currentMediaId = loopItem.id;
              room.playback.status = "playing";
              let startLoop =
                loopItem.lastPosition || loopItem.startPosition || 0;
              if (loopItem.duration > 0 && startLoop >= loopItem.duration - 5) {
                startLoop = 0;
                loopItem.lastPosition = 0;
              }
              room.playback.basePosition = startLoop;
              room.playback.baseTimestamp = Date.now();
              room.playback.updatedBy = participantNickname;
              stateChanged = true;
            } // Else ends naturally, handled by fast-path next/ended mostly
            break;

          case "clear_playlist":
            if (!canEditPlaylist) break;
            if (room.playlist.length > 0) {
              room.playlist = [];
              room.currentMediaId = null;
              room.playback.status = "paused";
              room.playback.basePosition = 0;
              room.playback.baseTimestamp = Date.now();
              stateChanged = true;
            }
            break;

          case "update_settings":
            if (!isOwnerOrMod) break;
            room.settings = { ...room.settings, ...payload.settings };
            stateChanged = true;
            break;

          // Legacy Sync Events remaining
          case "update_duration":
          case "update_room_name":
          case "update_nickname":
          case "update_role":
          case "claim_host":
          case "kick_participant":
          case "video_ended":
            // Not fully re-mapped yet, keep the structural intent
            break;
        }

        if (stateChanged) room.sequence++;
        processedCount++;
      } catch (e) {
        console.error("Worker error processing item", e);
      }
    }

    if (stateChanged) {
      room.version++;
      room.lastActivity = Date.now();
      await setRedisRoom(roomId, room); // Direct overwrite, we hold the lock

      // Re-publish to socket threads
      await publishRoomEvent(roomId, {
        type: "state_update",
        payload: room, // Note: scrub sensitive info if needed
      });
    }
  });
}
