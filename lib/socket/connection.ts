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
import { getClientIp } from "../rate-limit";

export function handleConnectionEvents(
  io: Server,
  socket: Socket,
  supabase: SupabaseClient | null,
  context: SocketContext,
  eventBus: RoomEventBus,
) {
  socket.on("participant_health", async (payload: unknown) => {
    if (!context.currentRoomId || !context.currentParticipantId) return;
    if (!payload || typeof payload !== "object") return;
    const health = (payload as { health?: unknown }).health;
    if (
      health !== "idle" &&
      health !== "ready" &&
      health !== "buffering" &&
      health !== "error"
    ) {
      return;
    }

    const roomId = context.currentRoomId;
    const participantId = context.currentParticipantId;
    for (let attempt = 0; attempt < 5; attempt++) {
      const room = await getRedisRoom(roomId);
      const participant = room?.participants[participantId];
      if (!room || !participant) return;
      const next = structuredClone(room);
      next.participants[participantId] = {
        ...next.participants[participantId],
        playbackHealth: health,
        lastSeen: Date.now(),
      };
      next.version = room.version + 1;
      if (!(await setRedisRoomCAS(roomId, next, room.version))) {
        await new Promise((resolve) => setTimeout(resolve, 10 + attempt * 5));
        continue;
      }
      await eventBus
        .publish(roomId, {
          type: "participant_health",
          participantId,
          health,
        })
        .catch((error) =>
          console.error("Failed publishing participant health", error),
        );
      return;
    }
  });

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

    const ip = getClientIp(
      socket.handshake.headers,
      socket.handshake.address || "unknown",
    );
    if (!(await checkRedisRateLimit(`ws:join:${ip}`, 50, 60_000))) {
      socket.emit("error", { message: "Too many join requests" });
      return;
    }

    let occRetries = 10;
    let finalRoomState: RoomState | null = null;
    let reconnected = false;
    let expiredParticipant = false;
    let ownerRolesChanged = false;

    while (occRetries > 0) {
      let room: RoomState | null = await getRedisRoom(roomId);
      const roomWasCached = Boolean(room);

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
      const nextRoom = joinParticipant(
        room,
        requestedParticipant,
        now,
        socket.id,
      );
      const success = await setRedisRoomCAS(
        roomId,
        nextRoom,
        roomWasCached ? room.version : 0,
      );
      if (success) {
        finalRoomState = nextRoom;
        const ownerIdsBefore = Object.values(room.participants)
          .filter((participant) => participant.role === "owner")
          .map((participant) => participant.id)
          .sort();
        const ownerIdsAfter = Object.values(nextRoom.participants)
          .filter((participant) => participant.role === "owner")
          .map((participant) => participant.id)
          .sort();
        ownerRolesChanged =
          Object.keys(room.participants).length > 0 &&
          ownerIdsBefore.join("\0") !== ownerIdsAfter.join("\0");
        expiredParticipant =
          Boolean(existingParticipant) &&
          existingParticipant.connection !== "connected" &&
          now - existingParticipant.lastSeen >= PARTICIPANT_GRACE_MS;
        reconnected =
          Boolean(existingParticipant) &&
          existingParticipant.connection !== "connected" &&
          !expiredParticipant;
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
    if (expiredParticipant) {
      const ownerId =
        Object.values(finalRoomState.participants).find(
          (participant) => participant.role === "owner",
        )?.id ?? null;
      await eventBus
        .publish(roomId, {
          type: "participant_left",
          participantId: pId,
          ownerId,
        })
        .catch((error) =>
          console.error("Failed publishing expired departure", error),
        );
    }
    socket.join(roomId);
    context.currentRoomId = roomId;
    context.currentParticipantId = pId;

    const sanitizedRoom = sanitizeRoom(finalRoomState);
    socket.emit("room_state", {
      room: sanitizedRoom,
      serverTime: Date.now(),
    });

    if (ownerRolesChanged) {
      await eventBus
        .publish(roomId, {
          type: "room_state",
          room: sanitizedRoom,
          serverTime: Date.now(),
          excludeSocketId: socket.id,
        })
        .catch((error) =>
          console.error("Failed publishing repaired owner state", error),
        );
    }

    const joinedInfo = sanitizedRoom.participants[pId];
    await eventBus
      .publish(roomId, {
        type: reconnected ? "participant_reconnected" : "participant_joined",
        participant: joinedInfo,
      })
      .catch((error) => console.error("Failed publishing join", error));
  });

  socket.on("request_room_state", async ({ roomId }) => {
    if (
      typeof roomId !== "string" ||
      roomId !== context.currentRoomId ||
      !context.currentParticipantId
    ) {
      return;
    }

    const room = await getRedisRoom(roomId);
    if (!room || !room.participants[context.currentParticipantId]) return;

    socket.emit("room_state", {
      room: sanitizeRoom(room),
      serverTime: Date.now(),
    });
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
      let startGrace = false;
      while (retries > 0) {
        const room = await getRedisRoom(roomId);
        if (!room || !room.participants[participantId]) return;
        const nextRoom = markParticipantDisconnected(
          room,
          participantId,
          Date.now(),
          socket.id,
        );
        if (nextRoom === room) return;
        if (await setRedisRoomCAS(roomId, nextRoom, room.version)) {
          if (
            nextRoom.participants[participantId]?.connection === "connected"
          ) {
            return;
          }
          startGrace = true;
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

      if (!startGrace) return;
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
