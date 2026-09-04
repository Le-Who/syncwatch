import { randomUUID } from "node:crypto";
import type { Server, Socket } from "socket.io";
import type { SupabaseClient } from "@supabase/supabase-js";
import { jwtVerify } from "jose";
import { isSystemDegraded } from "../db-sync";
import { checkRedisRateLimit } from "../redis-rate-limit";
import { getJwtSecret } from "../jwt-config";
import {
  COMMAND_REJECTION_MESSAGES,
  RoomCommandService,
} from "../room-command-service";
import type {
  CommandAcknowledgement,
  CommandRejectionCode,
  RoomCommandEnvelope,
} from "../room-command-contract";
import { roomCommandEnvelopeSchema } from "../room-command-contract";
import { commandNonceSchema } from "../command-nonce";
import { upgradeParticipantIdentity } from "../participant-lifecycle";
import { getRedisRoom, setRedisRoomCAS } from "../redis-actor";
import { sanitizeRoom } from "../room-handler";
import type { SocketContext } from "./context";
import type { RoomEventBus } from "../room-event-bus";

const JWT_SECRET = getJwtSecret();
const MAX_COMMAND_BYTES = 50_000;
const MAX_UPGRADE_RETRIES = 10;

type AcknowledgementCallback = (ack: CommandAcknowledgement) => void;

function emitAcknowledgement(
  socket: Socket,
  ack: CommandAcknowledgement,
  callback?: AcknowledgementCallback,
) {
  socket.emit("command_ack", ack);
  callback?.(ack);

  // Transitional compatibility for surfaces still subscribed to `error`.
  // The correlated acknowledgement is the authoritative response.
  if (ack.status === "rejected") {
    socket.emit("error", {
      message:
        ack.message ??
        COMMAND_REJECTION_MESSAGES[ack.code ?? "INVALID_COMMAND"],
    });
  }
}

function rejected(
  nonce: string,
  code: CommandRejectionCode,
): CommandAcknowledgement {
  return {
    nonce,
    status: "rejected",
    code,
    message: COMMAND_REJECTION_MESSAGES[code],
  };
}

function extractRequestNonce(raw: unknown): string {
  if (!raw || typeof raw !== "object") return "invalid";
  const nonce = (raw as { nonce?: unknown }).nonce;
  const parsed = commandNonceSchema.safeParse(nonce);
  return parsed.success ? parsed.data : "invalid";
}

/** Converts the pre-envelope Socket.IO API into the shared contract. */
export function adaptLegacyCommandEnvelope(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  if ("command" in raw) return raw;

  const legacy = raw as {
    roomId?: unknown;
    type?: unknown;
    payload?: unknown;
    sequence?: unknown;
    nonce?: unknown;
  };
  if (typeof legacy.type !== "string") return raw;
  return {
    roomId: legacy.roomId,
    nonce: commandNonceSchema.safeParse(legacy.nonce).success
      ? legacy.nonce
      : randomUUID(),
    clientSequence:
      typeof legacy.sequence === "number" &&
      Number.isInteger(legacy.sequence) &&
      legacy.sequence >= 0
        ? legacy.sequence
        : 0,
    command: { type: legacy.type, payload: legacy.payload },
  };
}

async function handleSessionUpgrade(
  io: Server,
  socket: Socket,
  context: SocketContext,
  envelope: RoomCommandEnvelope,
  eventBus?: RoomEventBus,
): Promise<CommandAcknowledgement> {
  if (!context.currentRoomId || !context.currentParticipantId) {
    return rejected(envelope.nonce, "NOT_JOINED");
  }
  if (context.currentRoomId !== envelope.roomId) {
    return rejected(envelope.nonce, "ROOM_MISMATCH");
  }
  if (envelope.command.type !== "upgrade_session") {
    return rejected(envelope.nonce, "INVALID_COMMAND");
  }

  let verifiedParticipantId: string;
  let verifiedNickname: string | undefined;
  try {
    const { payload } = await jwtVerify(
      envelope.command.payload.token,
      JWT_SECRET,
    );
    if (typeof payload.participantId !== "string") {
      return rejected(envelope.nonce, "INVALID_COMMAND");
    }
    verifiedParticipantId = payload.participantId;
    verifiedNickname =
      typeof payload.nickname === "string" ? payload.nickname : undefined;
  } catch {
    return rejected(envelope.nonce, "INVALID_COMMAND");
  }

  const sourceParticipantId = context.currentParticipantId;
  for (let attempt = 0; attempt < MAX_UPGRADE_RETRIES; attempt++) {
    const room = await getRedisRoom(envelope.roomId);
    if (!room || !room.participants[sourceParticipantId]) {
      return rejected(envelope.nonce, "NOT_PARTICIPANT");
    }
    const next = upgradeParticipantIdentity(
      room,
      sourceParticipantId,
      {
        id: verifiedParticipantId,
        nickname:
          verifiedNickname ??
          room.participants[sourceParticipantId]?.nickname ??
          "User",
      },
      Date.now(),
      socket.id,
    );
    if (!(await setRedisRoomCAS(envelope.roomId, next, room.version))) {
      await new Promise((resolve) =>
        setTimeout(resolve, 10 + Math.random() * 20),
      );
      continue;
    }

    socket.data.participantId = verifiedParticipantId;
    context.currentParticipantId = verifiedParticipantId;
    socket.emit("session_upgraded", { participantId: verifiedParticipantId });
    const serverTime = Date.now();
    const sanitizedRoom = sanitizeRoom(next);
    if (eventBus) {
      try {
        await eventBus.publish(envelope.roomId, {
          type: "room_state",
          room: sanitizedRoom,
          serverTime,
        });
      } catch (error) {
        console.error("Session upgrade publication failed after commit", error);
      }
    } else {
      io.to(envelope.roomId).emit("room_state", {
        room: sanitizedRoom,
        serverTime,
      });
    }
    return {
      nonce: envelope.nonce,
      status: "applied",
      roomSequence: next.sequence,
    };
  }

  const ack = rejected(envelope.nonce, "CONTENTION");
  ack.message = "System busy acquiring room lock. Try again.";
  return ack;
}

export function handleCommandEvents(
  io: Server,
  socket: Socket,
  _supabase: SupabaseClient | null,
  context: SocketContext,
  commandService: RoomCommandService,
  eventBus?: RoomEventBus,
) {
  socket.on(
    "command",
    async (rawCommand: unknown, callback?: AcknowledgementCallback) => {
      let fallbackNonce = "invalid";
      try {
        fallbackNonce = extractRequestNonce(rawCommand);
        const authenticatedParticipantId = socket.data.participantId;
        if (typeof authenticatedParticipantId !== "string") {
          emitAcknowledgement(
            socket,
            rejected(fallbackNonce, "NOT_JOINED"),
            callback,
          );
          return;
        }
        if (
          !(await checkRedisRateLimit(
            `ws:command:${authenticatedParticipantId}`,
            60,
            10_000,
          ))
        ) {
          emitAcknowledgement(
            socket,
            rejected(fallbackNonce, "RATE_LIMITED"),
            callback,
          );
          return;
        }
        if (await isSystemDegraded()) {
          const ack = rejected(fallbackNonce, "INVALID_COMMAND");
          ack.message = "System is degraded, try again later.";
          emitAcknowledgement(socket, ack, callback);
          return;
        }

        if (!rawCommand || typeof rawCommand !== "object") {
          emitAcknowledgement(
            socket,
            rejected(fallbackNonce, "INVALID_COMMAND"),
            callback,
          );
          return;
        }

        const serializedCommand = JSON.stringify(rawCommand);
        if (
          typeof serializedCommand !== "string" ||
          Buffer.byteLength(serializedCommand, "utf8") > MAX_COMMAND_BYTES
        ) {
          const ack = rejected(fallbackNonce, "INVALID_COMMAND");
          ack.message = "Payload too large. Request rejected.";
          emitAcknowledgement(socket, ack, callback);
          return;
        }

        const adapted = adaptLegacyCommandEnvelope(rawCommand);
        fallbackNonce = extractRequestNonce(adapted);
        const parsed = roomCommandEnvelopeSchema.safeParse(adapted);
        if (!parsed.success) {
          emitAcknowledgement(
            socket,
            rejected(fallbackNonce, "INVALID_COMMAND"),
            callback,
          );
          return;
        }

        const envelope = parsed.data as RoomCommandEnvelope;
        const ack =
          envelope.command.type === "upgrade_session"
            ? await handleSessionUpgrade(
                io,
                socket,
                context,
                envelope,
                eventBus,
              )
            : await commandService.execute(context, envelope);
        emitAcknowledgement(socket, ack, callback);
      } catch (error) {
        console.error("Command handling error", error);
        emitAcknowledgement(
          socket,
          rejected(fallbackNonce, "INVALID_COMMAND"),
          callback,
        );
      }
    },
  );
}
