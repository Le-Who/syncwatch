import { Server, Socket } from "socket.io";
import { SupabaseClient } from "@supabase/supabase-js";
import { jwtVerify } from "jose";
import { RoomState } from "./types";
import { checkRedisRateLimit, getRedisClient } from "./redis-rate-limit";
import {
  getRedisRoom,
  setRedisRoomCAS,
  publishRoomEvent,
  pubClient,
} from "./redis-actor";
import { executeFastMutation } from "./redis-lua";
import { pushSlowCommand } from "./redis-queue";
import { commandSchema } from "./zod-schemas";
import { persistRoomState, loadRoomFromDB, isSystemDegraded } from "./db-sync";

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || "super-secret-key-for-development-only-123",
);

export function createEmptyRoom(id: string, name: string): RoomState {
  return {
    id,
    name,
    settings: {
      controlMode: "open",
      autoplayNext: true,
      looping: false,
    },
    participants: {},
    playlist: [],
    currentMediaId: null,
    playback: {
      status: "paused",
      basePosition: 0,
      baseTimestamp: Date.now(),
      rate: 1,
      updatedBy: "system",
    },
    version: 1,
    sequence: 1,
    lastActivity: Date.now(),
  };
}

export function sanitizeRoom(room: RoomState): RoomState {
  const sanitized = { ...room, participants: { ...room.participants } };
  for (const pid in sanitized.participants) {
    sanitized.participants[pid] = { ...sanitized.participants[pid] };
    delete (sanitized.participants[pid] as any).sessionToken;
  }
  return sanitized;
}

export function registerRoomHandlers(
  io: Server,
  socket: Socket,
  supabase: SupabaseClient | null,
) {
  let currentRoomId: string | null = null;
  let currentParticipantId: string | null = null;

  socket.on(
    "ping_time",
    async (
      clientTime: number,
      callback: (serverTime: number, clientTime: number) => void,
    ) => {
      callback(Date.now(), clientTime);
      if (currentRoomId) {
        const redisClient = getRedisClient();
        if (redisClient) {
          redisClient
            .expire(`room_state:${currentRoomId}`, 86400)
            .catch(() => {});
        }
      }
    },
  );

  socket.on("join_room", async ({ roomId, nickname }) => {
    if (await isSystemDegraded()) {
      socket.emit("error", { message: "System is degraded, try again later." });
      return;
    }

    const ip =
      socket.handshake.headers["x-forwarded-for"] ||
      socket.handshake.address ||
      "unknown";
    if (!(await checkRedisRateLimit(`ws:join:${ip}`, 50, 60000))) {
      socket.emit("error", { message: "Too many join requests" });
      return;
    }

    let occRetries = 10;
    let finalRoomState = null;

    while (occRetries > 0) {
      let room: RoomState | null = await getRedisRoom(roomId);

      if (!room) {
        room = await loadRoomFromDB(roomId, supabase);
        if (!room) {
          room = createEmptyRoom(roomId, `Room ${roomId}`);
        }
      }

      const baseVersion = room.version;
      room.lastActivity = Date.now();

      const pId = socket.data.participantId;
      const isFirst = Object.keys(room.participants).length === 0;

      const isGuest = pId.startsWith("guest_");

      if (!isGuest) {
        const existingParticipant = room.participants[pId];
        if (existingParticipant) {
          existingParticipant.lastSeen = Date.now();
          existingParticipant.nickname =
            nickname || existingParticipant.nickname;
        } else {
          room.participants[pId] = {
            id: pId,
            nickname: nickname || `Guest ${Math.floor(Math.random() * 1000)}`,
            role: isFirst ? "owner" : "guest",
            lastSeen: Date.now(),
          };
        }
      }

      room.version++;

      const success = await setRedisRoomCAS(roomId, room, baseVersion);
      if (success) {
        finalRoomState = room;
        break;
      }

      await new Promise((r) => setTimeout(r, 10 + Math.random() * 20));
      occRetries--;
    }

    if (!finalRoomState) {
      socket.emit("error", {
        message: "Could not join room due to high load.",
      });
      return;
    }

    const pId = socket.data.participantId;
    const isGuest = pId.startsWith("guest_");
    socket.join(roomId);
    currentRoomId = roomId;
    currentParticipantId = pId;

    socket.emit("room_state", {
      room: sanitizeRoom(finalRoomState),
      serverTime: Date.now(),
    });

    if (!isGuest) {
      const joinedInfo = { ...finalRoomState.participants[pId] };
      publishRoomEvent(roomId, {
        type: "participant_joined",
        payload: joinedInfo,
      }).catch((e) => console.error("Failed publishing join", e));
    }
  });

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
        stateChanged = false;
        if (!currentParticipantId) {
          socket.emit("error", {
            message: "Unauthorized command. No participant ID.",
          });
          return;
        }

        if (
          currentParticipantId.startsWith("guest_") &&
          type !== "upgrade_session"
        ) {
          socket.emit("error", {
            message:
              "Unauthorized command. Guest accounts cannot send commands.",
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
            currentParticipantId,
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

              const oldParticipant = room.participants[currentParticipantId];
              const isFirst =
                Object.keys(room.participants).length === 1 && oldParticipant;

              room.participants[newPid] = {
                id: newPid,
                nickname:
                  (jwtPayload.nickname as string) ||
                  oldParticipant?.nickname ||
                  `User`,
                role: isFirst ? "owner" : "guest",
                lastSeen: Date.now(),
              };

              if (oldParticipant) {
                if (oldParticipant.role === "owner")
                  room.participants[newPid].role = "owner";
                delete room.participants[currentParticipantId];
              }

              socket.data.participantId = newPid;
              currentParticipantId = newPid;
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
          currentParticipantId,
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

  socket.on("reaction", (payload) => {
    try {
      if (!currentRoomId || !currentParticipantId) return;
      socket.to(currentRoomId).emit("reaction", payload);
    } catch (e) {
      console.error("Error processing reaction:", e);
    }
  });

  socket.on("disconnect", () => {
    if (currentRoomId && currentParticipantId) {
      setTimeout(async () => {
        let retries = 5;
        while (retries > 0) {
          const r = await getRedisRoom(currentRoomId!);
          if (!r) break;

          const participant = r.participants[currentParticipantId!];
          if (participant) {
            if (Date.now() - participant.lastSeen > 10000) {
              delete r.participants[currentParticipantId!];
              r.version++;

              const remaining = Object.values(r.participants);
              if (remaining.length === 0) {
                persistRoomState(r, supabase);
              } else {
                if (!remaining.some((p: any) => p.role === "owner")) {
                  (remaining[0] as any).role = "owner";
                }
              }

              const success = await setRedisRoomCAS(
                currentRoomId!,
                r,
                r.version - 1,
              );
              if (success) {
                io.to(currentRoomId!).emit("participant_left", {
                  participantId: currentParticipantId,
                });
                if (
                  remaining.length > 0 &&
                  !remaining.some((p: any) => p.role === "owner")
                ) {
                  io.to(currentRoomId!).emit("room_state", {
                    room: sanitizeRoom(r),
                    serverTime: Date.now(),
                  });
                }

                const pClient = pubClient();
                if (pClient) {
                  await publishRoomEvent(currentRoomId!, {
                    type: "state_update",
                    roomId: currentRoomId,
                    payload: r,
                  });
                }
                break;
              }
              await new Promise((resolve) =>
                setTimeout(resolve, 30 + Math.random() * 50),
              );
              retries--;
            } else {
              break;
            }
          } else {
            break;
          }
        }
      }, 15000);
    }
  });
}
