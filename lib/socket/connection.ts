import { Server, Socket } from "socket.io";
import { SupabaseClient } from "@supabase/supabase-js";
import { checkRedisRateLimit, getRedisClient } from "../redis-rate-limit";
import {
  getRedisRoom,
  setRedisRoomCAS,
  publishRoomEvent,
  pubClient,
} from "../redis-actor";
import { persistRoomState, loadRoomFromDB, isSystemDegraded } from "../db-sync";
import { createEmptyRoom, sanitizeRoom } from "../room-handler";
import { RoomState } from "../types";
import { SocketContext } from "./context";

export function handleConnectionEvents(
  io: Server,
  socket: Socket,
  supabase: SupabaseClient | null,
  context: SocketContext,
) {
  socket.on(
    "ping_time",
    async (
      clientTime: number,
      callback: (serverTime: number, clientTime: number) => void,
    ) => {
      callback(Date.now(), clientTime);
      if (context.currentRoomId) {
        const redisClient = getRedisClient();
        if (redisClient) {
          redisClient
            .expire(`room_state:${context.currentRoomId}`, 86400)
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

      const existingParticipant = room.participants[pId];
      if (existingParticipant) {
        existingParticipant.lastSeen = Date.now();
        existingParticipant.nickname = nickname || existingParticipant.nickname;
      } else {
        room.participants[pId] = {
          id: pId,
          nickname: nickname || `Guest ${Math.floor(Math.random() * 1000)}`,
          role: isFirst ? "owner" : "viewer",
          lastSeen: Date.now(),
        };
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
    socket.join(roomId);
    context.currentRoomId = roomId;
    context.currentParticipantId = pId;

    socket.emit("room_state", {
      room: sanitizeRoom(finalRoomState),
      serverTime: Date.now(),
    });

    const joinedInfo = { ...finalRoomState.participants[pId] };
    publishRoomEvent(roomId, {
      type: "participant_joined",
      payload: joinedInfo,
    }).catch((e) => console.error("Failed publishing join", e));
  });

  socket.on("reaction", (payload) => {
    try {
      if (!context.currentRoomId || !context.currentParticipantId) return;
      socket.to(context.currentRoomId).emit("reaction", payload);
    } catch (e) {
      console.error("Error processing reaction:", e);
    }
  });

  socket.on("disconnect", () => {
    if (context.currentRoomId && context.currentParticipantId) {
      const { currentRoomId, currentParticipantId } = context;
      setTimeout(async () => {
        let retries = 5;
        while (retries > 0) {
          const r = await getRedisRoom(currentRoomId);
          if (!r) break;

          const participant = r.participants[currentParticipantId];
          if (participant) {
            if (Date.now() - participant.lastSeen > 10000) {
              delete r.participants[currentParticipantId];
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
                currentRoomId,
                r,
                r.version - 1,
              );
              if (success) {
                // Ensure room departure state is written via DB queue
                persistRoomState(r, supabase);

                io.to(currentRoomId).emit("participant_left", {
                  participantId: currentParticipantId,
                });
                if (
                  remaining.length > 0 &&
                  !remaining.some((p: any) => p.role === "owner")
                ) {
                  io.to(currentRoomId).emit("room_state", {
                    room: sanitizeRoom(r),
                    serverTime: Date.now(),
                  });
                }

                const pClient = pubClient();
                if (pClient) {
                  await publishRoomEvent(currentRoomId, {
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
