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
import { z } from "zod";
import { parseReaction } from "../reactions";

const roomRequestSchema = z.object({
  roomId: z.string().min(1).max(128),
  // Ignore unusable optional correlation, as older clients omit it entirely.
  snapshotRequestId: z.string().max(64).optional().catch(undefined),
});
const joinRoomSchema = roomRequestSchema.extend({
  nickname: z.string().max(50).optional(),
});

export function handleConnectionEvents(
  io: Server,
  socket: Socket,
  supabase: SupabaseClient | null,
  context: SocketContext,
  eventBus: RoomEventBus,
) {
  let disconnected = false;
  let joiningRoomId: string | null = null;
  let joinOperations = Promise.resolve();
  const disconnectRetries = new Map<string, ReturnType<typeof setTimeout>>();
  const disconnecting = new Set<string>();
  const graceTimers = new Map<string, ReturnType<typeof setTimeout>>();

  function handleAsync<Args extends unknown[]>(
    label: string,
    operation: (...args: Args) => Promise<void>,
  ) {
    return async (...args: Args) => {
      try {
        await operation(...args);
      } catch (error) {
        console.error(`Failed processing ${label}`, error);
      }
    };
  }

  function scheduleGraceCleanup(
    roomId: string,
    participantId: string,
    delay = PARTICIPANT_GRACE_MS,
    retryDelay = 100,
  ) {
    const key = JSON.stringify([roomId, participantId]);
    if (graceTimers.has(key)) return;
    const timer = setTimeout(() => {
      graceTimers.delete(key);
      void (async () => {
        const room = await getRedisRoom(roomId);
        const participant = room?.participants[participantId];
        if (!room || !participant || participant.connection === "connected")
          return;
        const remaining =
          PARTICIPANT_GRACE_MS - (Date.now() - participant.lastSeen);
        if (remaining > 0) {
          scheduleGraceCleanup(roomId, participantId, remaining);
          return;
        }
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

        scheduleGraceCleanup(
          roomId,
          participantId,
          retryDelay,
          Math.min(retryDelay * 2, 5000),
        );
      })().catch((error) => {
        console.error("Failed cleaning up disconnected participant", error);
        scheduleGraceCleanup(
          roomId,
          participantId,
          retryDelay,
          Math.min(retryDelay * 2, 5000),
        );
      });
    }, delay);
    timer.unref?.();
    graceTimers.set(key, timer);
  }

  function retryDisconnect(
    roomId: string,
    participantId: string,
    delay: number,
  ) {
    const key = JSON.stringify([roomId, participantId]);
    if (disconnectRetries.has(key)) return;
    const timer = setTimeout(() => {
      disconnectRetries.delete(key);
      void disconnectParticipant(
        roomId,
        participantId,
        Math.min(delay * 2, 5000),
      );
    }, delay);
    timer.unref?.();
    disconnectRetries.set(key, timer);
  }

  async function disconnectParticipant(
    roomId: string,
    participantId: string,
    retryDelay = 100,
  ) {
    const key = JSON.stringify([roomId, participantId]);
    if (disconnecting.has(key) || disconnectRetries.has(key)) return;
    disconnecting.add(key);
    try {
      const room = await getRedisRoom(roomId);
      if (!room || !room.participants[participantId]) return;
      const nextRoom = markParticipantDisconnected(
        room,
        participantId,
        Date.now(),
        socket.id,
      );
      if (nextRoom === room) {
        // A lost CAS reply can leave the socket already removed, before this
        // task had the chance to retain its grace cleanup.
        const participant = room.participants[participantId];
        if (participant.connection !== "connected") {
          scheduleGraceCleanup(
            roomId,
            participantId,
            Math.max(
              1,
              PARTICIPANT_GRACE_MS - (Date.now() - participant.lastSeen),
            ),
          );
        }
        return;
      }
      if (await setRedisRoomCAS(roomId, nextRoom, room.version)) {
        if (nextRoom.participants[participantId]?.connection === "connected") {
          return;
        }
        scheduleGraceCleanup(roomId, participantId);
        await eventBus
          .publish(roomId, {
            type: "participant_disconnected",
            participantId,
          })
          .catch((error) =>
            console.error("Failed publishing disconnect", error),
          );
        return;
      }
      retryDisconnect(roomId, participantId, retryDelay);
    } catch (error) {
      console.error("Failed disconnecting participant", error);
      retryDisconnect(roomId, participantId, retryDelay);
    } finally {
      disconnecting.delete(key);
    }
  }

  context.disconnectParticipant = disconnectParticipant;
  context.isDisconnected = () => disconnected;
  context.isJoiningRoom = () => joiningRoomId !== null;

  socket.on(
    "participant_health",
    handleAsync("participant health", async (payload: unknown) => {
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
        if (
          disconnected ||
          context.currentRoomId !== roomId ||
          context.currentParticipantId !== participantId ||
          participant.connection !== "connected" ||
          (participant.connectionIds &&
            !participant.connectionIds.includes(socket.id))
        ) {
          return;
        }
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
    }),
  );

  socket.on("ping_time", async (clientTime: unknown, callback: unknown) => {
    if (
      typeof clientTime !== "number" ||
      !Number.isFinite(clientTime) ||
      typeof callback !== "function"
    )
      return;
    callback(Date.now(), clientTime);
    if (context.currentRoomId) {
      const redisClient = getRedisClient();
      if (redisClient) {
        redisClient
          .expire(`room_state:${context.currentRoomId}`, 86400)
          .catch(() => {});
      }
    }
  });

  async function joinRoom({
    roomId,
    nickname,
    snapshotRequestId,
  }: z.infer<typeof joinRoomSchema>) {
    if (await isSystemDegraded()) {
      socket.emit("error", { message: "System is degraded, try again later." });
      return;
    }

    const ip = getClientIp(
      socket.handshake.headers,
      socket.handshake.address || "unknown",
    );
    if (
      !(await checkRedisRateLimit(
        `ws:join:participant:${socket.data.participantId}`,
        50,
        60_000,
      )) ||
      !(await checkRedisRateLimit(`ws:join:${ip}`, 1000, 60_000))
    ) {
      socket.emit("error", { message: "Too many join requests" });
      return;
    }

    let occRetries = 10;
    let finalRoomState: RoomState | null = null;
    let reconnected = false;
    let expiredParticipant = false;
    let ownerRolesChanged = false;

    while (occRetries > 0) {
      if (disconnected) return;
      let room: RoomState | null = await getRedisRoom(roomId);
      const roomWasCached = Boolean(room);

      if (!room) {
        room = await loadRoomFromDB(roomId, supabase);
        if (!room) {
          room = createEmptyRoom(roomId, `Room ${roomId}`);
        }
      }
      if (disconnected) return;

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
        if (!roomWasCached) {
          for (const p of Object.values(nextRoom.participants)) {
            if (p.connection !== "connected")
              scheduleGraceCleanup(roomId, p.id);
          }
        }
        persistRoomState(nextRoom, supabase);
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
    // A disconnect can happen while hydration, CAS, or departure publication
    // is pending, before this join has installed the socket's room context.
    if (disconnected) {
      await disconnectParticipant(roomId, pId);
      if (ownerRolesChanged) {
        const latestRoom: RoomState | null = await getRedisRoom(roomId);
        if (latestRoom) finalRoomState = latestRoom;
      }
    }

    const sanitizedRoom = sanitizeRoom(finalRoomState);
    if (!disconnected) {
      socket.join(roomId);
      context.currentRoomId = roomId;
      context.currentParticipantId = pId;
      socket.emit("room_state", {
        room: sanitizedRoom,
        serverTime: Date.now(),
        snapshotRequestId:
          typeof snapshotRequestId === "string" &&
          snapshotRequestId.length <= 64
            ? snapshotRequestId
            : undefined,
      });
    }

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

    if (disconnected) return;
    const joinedInfo = sanitizedRoom.participants[pId];
    await eventBus
      .publish(roomId, {
        type: reconnected ? "participant_reconnected" : "participant_joined",
        participant: joinedInfo,
      })
      .catch((error) => console.error("Failed publishing join", error));
  }

  socket.on("join_room", (payload: unknown) => {
    const parsed = joinRoomSchema.safeParse(payload);
    if (!parsed.success) {
      socket.emit("error", { message: "Invalid room join request." });
      return Promise.resolve();
    }
    const { roomId } = parsed.data;
    if (context.sessionUpgradeInFlight) {
      socket.emit("error", {
        message: "Session upgrade in progress. Try joining again.",
      });
      return Promise.resolve();
    }
    if (
      (context.currentRoomId && context.currentRoomId !== roomId) ||
      (joiningRoomId && joiningRoomId !== roomId)
    ) {
      socket.emit("error", {
        message: "This connection has already joined another room.",
      });
      return Promise.resolve();
    }

    // Reserve before the first await. Same-room requests run in order so a
    // slower hydration cannot replace a newer snapshot or clear its reservation.
    joiningRoomId = roomId;
    const operation = joinOperations
      .then(() => {
        if (!disconnected) return joinRoom(parsed.data);
      })
      .catch((error) => {
        console.error("Failed joining room", error);
        if (!disconnected) {
          socket.emit("error", {
            message: "Could not load room. Try again later.",
          });
        }
      });
    joinOperations = operation;
    return operation.finally(() => {
      if (joinOperations === operation) joiningRoomId = null;
    });
  });

  socket.on(
    "request_room_state",
    handleAsync("room snapshot request", async (payload: unknown) => {
      const parsed = roomRequestSchema.safeParse(payload);
      if (!parsed.success) return;
      const { roomId, snapshotRequestId } = parsed.data;
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
        snapshotRequestId:
          typeof snapshotRequestId === "string" &&
          snapshotRequestId.length <= 64
            ? snapshotRequestId
            : undefined,
      });
    }),
  );

  socket.on("reaction", (payload: unknown) => {
    try {
      if (!context.currentRoomId || !context.currentParticipantId) return;
      const reaction = parseReaction(payload);
      if (!reaction) return;
      socket.to(context.currentRoomId).emit("reaction", reaction);
    } catch (e) {
      console.error("Error processing reaction:", e);
    }
  });

  socket.on("disconnect", () => {
    disconnected = true;
    if (!context.currentRoomId || !context.currentParticipantId) return;
    const roomId = context.currentRoomId;
    const participantId = context.currentParticipantId;

    void disconnectParticipant(roomId, participantId).catch((error) =>
      console.error("Failed disconnecting participant", error),
    );
  });
}
