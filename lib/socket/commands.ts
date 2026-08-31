import { Server, Socket } from "socket.io";
import { SupabaseClient } from "@supabase/supabase-js";
import { jwtVerify } from "jose";
import { commandSchema } from "../zod-schemas";
import {
  getRedisRoom,
  setRedisRoomCAS,
  publishRoomEvent,
  pubClient,
} from "../redis-actor";
import { executeFastMutation } from "../redis-lua";
import {
  applyFastCommand,
  applySlowCommand,
  isFastCommand,
} from "../room-logic";
import {
  persistRoomState,
  isSystemDegraded,
  markRoomForSync,
} from "../db-sync";
import { sanitizeRoom } from "../room-handler";
import { SocketContext } from "./context";
import { RoomState } from "../types";
import { getParticipantPermissions } from "../permissions";
import { upgradeParticipantIdentity } from "../participant-lifecycle";

import { getJwtSecret } from "../jwt-config";

const JWT_SECRET = getJwtSecret();

export function getSlowCommandRejectionMessage(
  room: RoomState,
  type: string,
  payload: any,
  participantId: string,
): string | null {
  const participant = room.participants[participantId];
  if (!participant) return "Unauthorized command. Invalid session.";

  const {
    canAddPlaylist,
    canEditPlaylist: canManagePlaylist,
    canControlPlayback,
  } = getParticipantPermissions(room, participantId);

  if (type === "add_item") {
    if (!canAddPlaylist) return "You do not have permission to add media.";
    if (room.playlist.length >= 500) return "Playlist is full.";
    if (room.playlist.some((item) => item.url === payload?.url)) {
      return "This media is already in the queue.";
    }
    return "Could not add media to the queue.";
  }

  if (type === "add_items") {
    if (!canAddPlaylist) return "You do not have permission to add media.";
    if (room.playlist.length >= 500) return "Playlist is full.";
    const submittedItems = Array.isArray(payload?.items) ? payload.items : [];
    if (submittedItems.length === 0)
      return "No playable media items were submitted.";
    const existingUrls = new Set(room.playlist.map((item) => item.url));
    if (
      submittedItems.every(
        (item: any) =>
          typeof item?.url === "string" && existingUrls.has(item.url),
      )
    ) {
      return "All submitted media is already in the queue.";
    }
    return "Could not add media to the queue.";
  }

  if (
    [
      "remove_item",
      "reorder_playlist",
      "set_next_item",
      "toggle_item_temporary",
      "shuffle_playlist",
      "clear_playlist",
    ].includes(type)
  ) {
    return canManagePlaylist
      ? "Queue action could not be applied."
      : "You do not have permission to manage the queue.";
  }

  if (["set_media", "next", "rewind", "flashback"].includes(type)) {
    return canControlPlayback
      ? "Playback action could not be applied."
      : "You do not have permission to control playback.";
  }

  if (type === "request_leader") {
    return "Leader request was denied.";
  }

  if (type === "release_leader") {
    return "Leader release was denied.";
  }

  if (
    type === "transfer_owner" ||
    type === "update_role" ||
    type === "kick_participant"
  ) {
    return "Only the room owner can change participant roles.";
  }

  if (type === "send_chat") {
    return "Chat message is empty.";
  }

  return null;
}

export function handleCommandEvents(
  io: Server,
  socket: Socket,
  supabase: SupabaseClient | null,
  context: SocketContext,
) {
  socket.on("command", async (rawCommand) => {
    if (await isSystemDegraded()) {
      socket.emit("error", { message: "System is degraded, try again later." });
      return;
    }

    if (!rawCommand || typeof rawCommand !== "object") return;

    const payloadString = JSON.stringify(rawCommand);
    if (payloadString.length > 50000) {
      socket.emit("error", {
        message: "Payload too large. Request rejected.",
      });
      return;
    }

    const { roomId, type, payload, sequence } = rawCommand;
    if (typeof type !== "string" || type.length > 50) return;

    const parsedCommand = commandSchema.safeParse({ type, payload });
    if (!parsedCommand.success) {
      console.error(
        `[Zod] Dropped malformed command '${type}' from ${socket.handshake.address || "unknown"}:`,
        JSON.stringify(parsedCommand.error.issues),
        "Payload was:",
        JSON.stringify(payload),
      );
      socket.emit("error", { message: "Invalid command payload format." });
      return;
    }

    try {
      let occRetries = 10;
      let finalRoomState = null;
      let stateChanged = false;
      let committedUpgradeParticipantId: string | null = null;
      const upgradeSourceParticipantId =
        type === "upgrade_session" ? context.currentParticipantId : null;

      while (occRetries > 0) {
        const currentParticipantId =
          upgradeSourceParticipantId ?? context.currentParticipantId;
        if (!currentParticipantId) {
          socket.emit("error", {
            message: "Unauthorized command. No participant ID.",
          });
          return;
        }

        let room = await getRedisRoom(roomId);
        if (!room) return;

        const baseVersion = room.version;
        room.lastActivity = Date.now();
        const participant = room.participants[currentParticipantId];

        if (!participant) {
          socket.emit("error", {
            message: "Unauthorized command. Invalid session.",
          });
          return;
        }

        room.sequence++;

        const isFastPath = isFastCommand(type);

        if (isFastPath) {
          const result = await executeFastMutation(
            roomId,
            -1,
            type,
            payload,
            currentParticipantId,
            participant.nickname,
          );

          if (result.success && result.state) {
            const sanitizeFastRoom = sanitizeRoom(result.state);
            persistRoomState(result.state, supabase);

            const pClient = pubClient();
            if (pClient) {
              // Multi-node: PubSub handles broadcast (including back to this node)
              await publishRoomEvent(roomId, {
                type: "state_update",
                payload: sanitizeFastRoom,
              });
            } else {
              // Single-node fallback: direct emit when no PubSub available
              io.to(roomId).emit("room_state", {
                room: sanitizeFastRoom,
                serverTime: Date.now(),
              });
            }

            break;
          } else if (result.error === "VERSION_CONFLICT") {
            socket.emit("error", { message: "VERSION_CONFLICT" });
            break;
          } else if (result.error === "UNAUTHORIZED") {
            socket.emit("error", { message: "Unauthorized operation." });
            break;
          } else if (result.error === "NO_CHANGE") {
            break;
          } else {
            const fastResult = applyFastCommand(
              room,
              type,
              payload,
              currentParticipantId,
              participant.nickname,
            );

            if (fastResult === "unauthorized") {
              socket.emit("error", { message: "Unauthorized operation." });
              break;
            }
            if (fastResult === "unchanged") {
              break;
            }
            if (fastResult === "invalid") {
              socket.emit("error", {
                message: "Invalid command payload format.",
              });
              break;
            }

            room.version++;
            room.lastActivity = Date.now();

            const casSuccess = await setRedisRoomCAS(roomId, room, baseVersion);
            if (casSuccess) {
              markRoomForSync(roomId);
              persistRoomState(room, supabase);

              const sanitizedRoom = sanitizeRoom(room);
              const pClient = pubClient();
              if (pClient) {
                await publishRoomEvent(roomId, {
                  type: "state_update",
                  payload: sanitizedRoom,
                });
              } else {
                io.to(roomId).emit("room_state", {
                  room: sanitizedRoom,
                  serverTime: Date.now(),
                });
              }
              break;
            }

            await new Promise((r) => setTimeout(r, 10 + Math.random() * 20));
            occRetries--;
            continue;
          }
        }

        if (type === "upgrade_session") {
          let upgradeCandidateParticipantId: string | null = null;
          try {
            if (typeof payload.token !== "string")
              throw new Error("Missing token");
            const { payload: jwtPayload } = await jwtVerify(
              payload.token,
              JWT_SECRET,
            );
            if (jwtPayload.participantId) {
              const newPid = jwtPayload.participantId as string;
              const oldParticipant = room.participants[currentParticipantId];
              room = upgradeParticipantIdentity(
                room,
                currentParticipantId,
                {
                  id: newPid,
                  nickname:
                    (jwtPayload.nickname as string) ||
                    oldParticipant?.nickname ||
                    "User",
                },
                Date.now(),
                socket.id,
              );

              upgradeCandidateParticipantId = newPid;
              stateChanged = true;
            }
          } catch (e) {
            socket.emit("error", {
              message: "Invalid session upgrade token",
            });
          }
          if (upgradeCandidateParticipantId) {
            const success = await setRedisRoomCAS(roomId, room, baseVersion);
            if (success) {
              finalRoomState = room;
              committedUpgradeParticipantId = upgradeCandidateParticipantId;
              break;
            }
            await new Promise((r) => setTimeout(r, 10 + Math.random() * 20));
            occRetries--;
            continue;
          } else {
            break;
          }
        }

        // Slow-path: apply mutation in-memory then save via CAS
        const changed = applySlowCommand(
          room,
          type,
          payload,
          currentParticipantId,
          participant.nickname,
        );

        if (!changed) {
          const message = getSlowCommandRejectionMessage(
            room,
            type,
            payload,
            currentParticipantId,
          );
          if (message) {
            socket.emit("error", { message });
          }
          break; // No-op command (e.g., permission denied or invalid payload)
        }

        room.version++;
        room.lastActivity = Date.now();

        const casSuccess = await setRedisRoomCAS(roomId, room, baseVersion);
        if (casSuccess) {
          // Persist to DB asynchronously
          markRoomForSync(roomId);
          persistRoomState(room, supabase);

          // Broadcast updated state
          const sanitizedRoom = sanitizeRoom(room);
          const pClient = pubClient();
          if (pClient) {
            await publishRoomEvent(roomId, {
              type: "state_update",
              payload: sanitizedRoom,
            });
          } else {
            io.to(roomId).emit("room_state", {
              room: sanitizedRoom,
              serverTime: Date.now(),
            });
          }
          break;
        }

        // CAS conflict — retry the OCC loop
        await new Promise((r) => setTimeout(r, 10 + Math.random() * 20));
        occRetries--;
        continue;
      }

      if (stateChanged && !finalRoomState) {
        socket.emit("error", {
          message: "System busy acquiring room lock. Try again.",
        });
        return;
      }

      if (finalRoomState) {
        if (committedUpgradeParticipantId) {
          socket.data.participantId = committedUpgradeParticipantId;
          context.currentParticipantId = committedUpgradeParticipantId;
          socket.emit("session_upgraded", {
            participantId: committedUpgradeParticipantId,
          });
        }
        const sanitizedRoom = sanitizeRoom(finalRoomState);
        const pClient = pubClient();
        if (pClient) {
          await publishRoomEvent(roomId, {
            type: "state_update",
            roomId,
            payload: sanitizedRoom,
          });
        } else {
          io.to(roomId).emit("room_state", {
            room: sanitizedRoom,
            serverTime: Date.now(),
          });
        }
      }
    } catch (err) {
      console.error("Lock error for room", roomId, "Command Type:", type, err);
      socket.emit("error", {
        message: "System busy acquiring room lock. Try again.",
      });
    }
  });
}
