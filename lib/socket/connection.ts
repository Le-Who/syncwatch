import { Server, Socket } from "socket.io";
import { SupabaseClient } from "@supabase/supabase-js";
import { checkRedisRateLimit, getRedisClient } from "../redis-rate-limit";
import { getRedisRoom, setRedisRoomCAS } from "../redis-actor";
import { persistRoomState, loadRoomFromDB, isSystemDegraded } from "../db-sync";
import { createEmptyRoom, sanitizeRoom } from "../room-handler";
import { Participant, RoomState } from "../types";
import { SocketContext } from "./context";
import { RoomEventBus } from "../room-event-bus";
import {
  joinParticipant,
  markParticipantDisconnected,
  PARTICIPANT_GRACE_MS,
  removeParticipantAfterGrace,
} from "../participant-lifecycle";

export function handleConnectionEvents(
  io: Server,
  socket: Socket,
  supabase: SupabaseClient | null,
  context: SocketContext,
  eventBus: RoomEventBus,
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
    let finalRoomState: RoomState | null = null;
    let reconnected = false;

    while (occRetries > 0) {
      let room: RoomState | null = await getRedisRoom(roomId);

      if (!room) {
        room = await loadRoomFromDB(roomId, supabase);
        if (!room) {
          room = createEmptyRoom(roomId, `Room ${roomId}`);
        }
      }

      const pId = socket.data.participantId;
      const existingParticipant = room.participants[pId];
      const now = Date.now();
      const requestedParticipant: Participant = {
        id: pId,
        nickname:
          nickname ||
          existingParticipant?.nickname ||
          `Guest ${Math.floor(Math.random() * 1000)}`,
        role: existingParticipant?.role ?? "viewer",
        joinedAt: existingParticipant?.joinedAt ?? now,
        lastSeen: now,
        connection: "connected",
        playbackHealth: "idle",
        readyMediaId: null,
      };
      const nextRoom = joinParticipant(room, requestedParticipant, now);
      const success = await setRedisRoomCAS(roomId, nextRoom, room.version);
      if (success) {
        finalRoomState = nextRoom;
        reconnected =
          Boolean(existingParticipant) &&
          existingParticipant.connection !== "connected";
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

    const joinedInfo = sanitizeRoom(finalRoomState).participants[pId];
    await eventBus
      .publish(roomId, {
        type: reconnected ? "participant_reconnected" : "participant_joined",
        participant: joinedInfo,
      })
      .catch((error) => console.error("Failed publishing join", error));
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
    if (!context.currentRoomId || !context.currentParticipantId) return;
    const roomId = context.currentRoomId;
    const participantId = context.currentParticipantId;

    void (async () => {
      let retries = 5;
      let marked = false;
      while (retries > 0) {
        const room = await getRedisRoom(roomId);
        if (!room || !room.participants[participantId]) return;
        const nextRoom = markParticipantDisconnected(
          room,
          participantId,
          Date.now(),
        );
        if (await setRedisRoomCAS(roomId, nextRoom, room.version)) {
          marked = true;
          await eventBus
            .publish(roomId, {
              type: "participant_disconnected",
              participantId,
            })
            .catch((error) =>
              console.error("Failed publishing disconnect", error),
            );
          break;
        }
        retries--;
        await new Promise((resolve) =>
          setTimeout(resolve, 30 + Math.random() * 50),
        );
      }

      if (!marked) return;
      setTimeout(() => {
        void (async () => {
          let cleanupRetries = 5;
          while (cleanupRetries > 0) {
            const room = await getRedisRoom(roomId);
            if (!room) return;
            const nextRoom = removeParticipantAfterGrace(
              room,
              participantId,
              Date.now(),
            );
            if (nextRoom === room) return;

            if (await setRedisRoomCAS(roomId, nextRoom, room.version)) {
              persistRoomState(nextRoom, supabase);
              const ownerId =
                Object.values(nextRoom.participants).find(
                  (participant) => participant.role === "owner",
                )?.id ?? null;
              await eventBus
                .publish(roomId, {
                  type: "participant_left",
                  participantId,
                  ownerId,
                })
                .catch((error) =>
                  console.error("Failed publishing departure", error),
                );
              return;
            }

            cleanupRetries--;
            await new Promise((resolve) =>
              setTimeout(resolve, 30 + Math.random() * 50),
            );
          }
        })();
      }, PARTICIPANT_GRACE_MS);
    })();
  });
}
