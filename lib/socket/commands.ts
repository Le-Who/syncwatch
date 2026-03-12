import { Server, Socket } from "socket.io";
import { SupabaseClient } from "@supabase/supabase-js";
import { jwtVerify } from "jose";
import { commandSchema } from "../zod-schemas";
import { checkRedisRateLimit } from "../redis-rate-limit";
import {
  getRedisRoom,
  setRedisRoomCAS,
  publishRoomEvent,
  pubClient,
} from "../redis-actor";
import { executeFastMutation } from "../redis-lua";
import { pushSlowCommand } from "../redis-queue";
import { persistRoomState, isSystemDegraded } from "../db-sync";
import { sanitizeRoom } from "../room-handler";
import { SocketContext } from "./context";

import { getJwtSecret } from "../jwt-config";

const JWT_SECRET = getJwtSecret();

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

    const ip =
      socket.handshake.headers["x-forwarded-for"] ||
      socket.handshake.address ||
      "unknown";
    if (!(await checkRedisRateLimit(`ws:command:${ip}`, 60, 10000))) {
      socket.emit("error", { message: "Rate limit exceeded" });
      return;
    }

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
        `[Zod] Dropped malformed command '${type}' from ${ip}:`,
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

      while (occRetries > 0) {
        if (!context.currentParticipantId) {
          socket.emit("error", {
            message: "Unauthorized command. No participant ID.",
          });
          return;
        }

        let room = await getRedisRoom(roomId);
        if (!room) return;

        const baseVersion = room.version;
        room.lastActivity = Date.now();
        const participant = room.participants[context.currentParticipantId];

        if (!participant) {
          socket.emit("error", {
            message: "Unauthorized command. Invalid session.",
          });
          return;
        }

        room.sequence++;

        const isFastPath = [
          "play",
          "pause",
          "seek",
          "update_rate",
          "buffering",
          "sync_correction",
        ].includes(type);

        if (isFastPath) {
          const result = await executeFastMutation(
            roomId,
            -1,
            type,
            payload,
            context.currentParticipantId,
            participant.nickname,
          );

          if (result.success && result.state) {
            const sanitizeFastRoom = sanitizeRoom(result.state);
            io.to(roomId).emit("room_state", {
              room: sanitizeFastRoom,
              serverTime: Date.now(),
            });
            persistRoomState(result.state, supabase);

            await publishRoomEvent(roomId, {
              type: "state_update",
              payload: sanitizeFastRoom,
            });

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
            // Fallback to OCC
          }
        }

        if (type === "upgrade_session") {
          try {
            if (typeof payload.token !== "string")
              throw new Error("Missing token");
            const { payload: jwtPayload } = await jwtVerify(
              payload.token,
              JWT_SECRET,
            );
            if (jwtPayload.participantId) {
              const newPid = jwtPayload.participantId as string;

              const oldParticipant =
                room.participants[context.currentParticipantId];
              const isFirst =
                Object.keys(room.participants).length === 1 && oldParticipant;

              room.participants[newPid] = {
                id: newPid,
                nickname:
                  (jwtPayload.nickname as string) ||
                  oldParticipant?.nickname ||
                  `User`,
                role: isFirst ? "owner" : "viewer",
                lastSeen: Date.now(),
              };

              if (oldParticipant) {
                if (oldParticipant.role === "owner")
                  room.participants[newPid].role = "owner";
                delete room.participants[context.currentParticipantId];
              }

              socket.data.participantId = newPid;
              context.currentParticipantId = newPid;
              stateChanged = true;

              socket.emit("session_upgraded", { participantId: newPid });
            }
          } catch (e) {
            socket.emit("error", {
              message: "Invalid session upgrade token",
            });
          }
          if (stateChanged) {
            const success = await setRedisRoomCAS(roomId, room, baseVersion);
            if (success) {
              finalRoomState = room;
              break;
            }
            await new Promise((r) => setTimeout(r, 10 + Math.random() * 20));
            occRetries--;
            continue;
          } else {
            break;
          }
        }

        const pushed = await pushSlowCommand(
          roomId,
          sequence,
          type,
          payload,
          context.currentParticipantId,
          participant.nickname,
        );

        if (!pushed) {
          socket.emit("error", { message: "Failed to queue command" });
        }

        break;
      }

      if (stateChanged && !finalRoomState) {
        socket.emit("error", {
          message: "System busy acquiring room lock. Try again.",
        });
        return;
      }

      if (finalRoomState) {
        const pClient = pubClient();
        if (pClient) {
          await publishRoomEvent(roomId, {
            type: "state_update",
            roomId,
            payload: finalRoomState,
          });
        } else {
          io.to(roomId).emit("room_state", {
            room: finalRoomState,
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
