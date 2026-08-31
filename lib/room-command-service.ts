import type { RoomEventBus } from "./room-event-bus";
import {
  roomCommandEnvelopeSchema,
  type CommandAcknowledgement,
  type CommandRejectionCode,
  type RoomCommand,
  type RoomCommandEnvelope,
} from "./room-command-contract";
import { getParticipantPermissions } from "./permissions";
import { applySlowCommand, isFastCommand } from "./room-logic";
import type { RoomRepository, PlaybackCommand } from "./room-repository";
import type { RoomState } from "./types";

export interface RoomCommandContext {
  currentRoomId: string | null;
  currentParticipantId: string | null;
}

export const COMMAND_REJECTION_MESSAGES: Record<CommandRejectionCode, string> =
  {
    INVALID_COMMAND: "Invalid command payload format or unavailable action.",
    ROOM_MISMATCH: "This command targets a room you did not join.",
    NOT_JOINED: "Join the room before sending commands.",
    NOT_PARTICIPANT: "Your participant session is not active in this room.",
    NOT_PERMITTED: "You do not have permission to perform this action.",
    STALE_MEDIA: "The room has already moved to another video.",
    DUPLICATE: "This action was already received.",
    NO_CHANGE: "The room is already in that playback state.",
    CONTENTION: "The room is busy. Please retry this action.",
    QUEUE_FULL: "The queue already contains 500 items.",
  };

type Dependencies = {
  repository: RoomRepository;
  eventBus: RoomEventBus;
  now?: () => number;
  schedulePersistence?: (room: RoomState) => void | Promise<void>;
  onPostCommitError?: (
    error: unknown,
    phase: "persistence" | "publication",
  ) => void;
};

const MAX_PROCESSED_NONCES = 256;

function acknowledgement(
  nonce: string,
  status: CommandAcknowledgement["status"],
  code?: CommandRejectionCode,
  roomSequence?: number,
): CommandAcknowledgement {
  return {
    nonce,
    status,
    ...(code ? { code, message: COMMAND_REJECTION_MESSAGES[code] } : {}),
    ...(typeof roomSequence === "number" ? { roomSequence } : {}),
  };
}

function commandAllowed(
  room: RoomState,
  participantId: string,
  command: RoomCommand,
) {
  const permissions = getParticipantPermissions(room, participantId);
  switch (command.type) {
    case "play":
    case "pause":
    case "seek":
    case "buffering":
    case "update_rate":
    case "sync_correction":
    case "next":
    case "video_ended":
    case "rewind":
    case "flashback":
    case "update_duration":
      return permissions.canControlPlayback;
    case "add_item":
    case "add_items":
    case "send_chat":
    case "media_ready":
    case "update_nickname":
      return Boolean(room.participants[participantId]);
    case "remove_item":
    case "reorder_playlist":
    case "set_media":
    case "clear_playlist":
    case "set_next_item":
    case "toggle_item_temporary":
    case "shuffle_playlist":
      return permissions.canEditPlaylist;
    case "update_settings":
    case "update_room_name":
      return permissions.canManageRoom;
    case "update_role":
    case "transfer_owner":
    case "kick_participant":
      return permissions.isOwner;
    case "request_leader":
    case "claim_host":
      return Boolean(room.participants[participantId]);
    case "release_leader":
      return permissions.isLeader || permissions.isOwnerOrMod;
    case "upgrade_session":
      return false;
  }
}

function commandValidationCode(
  room: RoomState,
  command: RoomCommand,
): CommandRejectionCode | null {
  if (command.type === "next" || command.type === "video_ended") {
    if (command.payload?.currentMediaId !== room.currentMediaId) {
      return "STALE_MEDIA";
    }
  }

  if (
    command.type === "set_media" &&
    !room.playlist.some((item) => item.id === command.payload.itemId)
  ) {
    return "STALE_MEDIA";
  }

  if (command.type === "add_item") {
    if (room.playlist.length >= 500) return "QUEUE_FULL";
    if (room.playlist.some((item) => item.url === command.payload.url)) {
      return "INVALID_COMMAND";
    }
  }

  if (command.type === "add_items") {
    const existingUrls = new Set(room.playlist.map((item) => item.url));
    const submittedUrls = command.payload.items.map((item) => item.url);
    const uniqueNewUrls = new Set(
      submittedUrls.filter((url) => !existingUrls.has(url)),
    );
    if (uniqueNewUrls.size !== submittedUrls.length) return "INVALID_COMMAND";
    if (room.playlist.length + uniqueNewUrls.size > 500) return "QUEUE_FULL";
  }

  return null;
}

function sanitizeRoom(room: RoomState): RoomState {
  const sanitized = structuredClone(room);
  delete sanitized.processedCommandNonces;
  for (const participant of Object.values(sanitized.participants)) {
    delete participant.connectionIds;
    delete participant.sessionToken;
  }
  return sanitized;
}

function rememberNonce(room: RoomState, nonce: string) {
  room.processedCommandNonces = [
    ...(room.processedCommandNonces ?? []).filter((value) => value !== nonce),
    nonce,
  ].slice(-MAX_PROCESSED_NONCES);
}

export class RoomCommandService {
  private readonly repository: RoomRepository;
  private readonly eventBus: RoomEventBus;
  private readonly now: () => number;
  private readonly schedulePersistence: (
    room: RoomState,
  ) => void | Promise<void>;
  private readonly onPostCommitError: NonNullable<
    Dependencies["onPostCommitError"]
  >;

  constructor(dependencies: Dependencies) {
    this.repository = dependencies.repository;
    this.eventBus = dependencies.eventBus;
    this.now = dependencies.now ?? Date.now;
    this.schedulePersistence = dependencies.schedulePersistence ?? (() => {});
    this.onPostCommitError =
      dependencies.onPostCommitError ??
      ((error, phase) =>
        console.error(`Room command ${phase} failed after commit`, error));
  }

  private async persistCommittedRoom(room: RoomState) {
    try {
      await this.schedulePersistence(room);
    } catch (error) {
      this.onPostCommitError(error, "persistence");
    }
  }

  private async publishCommittedEvent(
    roomId: string,
    event: Parameters<RoomEventBus["publish"]>[1],
  ) {
    try {
      await this.eventBus.publish(roomId, event);
    } catch (error) {
      this.onPostCommitError(error, "publication");
    }
  }

  async execute(
    context: RoomCommandContext,
    rawEnvelope: unknown,
  ): Promise<CommandAcknowledgement> {
    const parsed = roomCommandEnvelopeSchema.safeParse(rawEnvelope);
    const fallbackNonce =
      rawEnvelope && typeof rawEnvelope === "object" && "nonce" in rawEnvelope
        ? String(rawEnvelope.nonce)
        : "invalid";
    if (!parsed.success) {
      return acknowledgement(fallbackNonce, "rejected", "INVALID_COMMAND");
    }
    const envelope = parsed.data as RoomCommandEnvelope;

    if (!context.currentRoomId || !context.currentParticipantId) {
      return acknowledgement(envelope.nonce, "rejected", "NOT_JOINED");
    }
    if (context.currentRoomId !== envelope.roomId) {
      return acknowledgement(envelope.nonce, "rejected", "ROOM_MISMATCH");
    }

    const initialRoom = await this.repository.get(envelope.roomId);
    if (!initialRoom) {
      return acknowledgement(envelope.nonce, "rejected", "NOT_JOINED");
    }
    const actor = initialRoom.participants[context.currentParticipantId];
    if (!actor) {
      return acknowledgement(envelope.nonce, "rejected", "NOT_PARTICIPANT");
    }
    if (initialRoom.processedCommandNonces?.includes(envelope.nonce)) {
      return acknowledgement(envelope.nonce, "ignored", "DUPLICATE");
    }
    if (!commandAllowed(initialRoom, actor.id, envelope.command)) {
      return acknowledgement(envelope.nonce, "rejected", "NOT_PERMITTED");
    }
    const initialValidationCode = commandValidationCode(
      initialRoom,
      envelope.command,
    );
    if (initialValidationCode) {
      const status =
        initialValidationCode === "STALE_MEDIA" ? "ignored" : "rejected";
      return acknowledgement(envelope.nonce, status, initialValidationCode);
    }

    if (isFastCommand(envelope.command.type)) {
      const command: PlaybackCommand = {
        ...envelope.command,
        payload: { ...envelope.command.payload, nonce: envelope.nonce },
      } as PlaybackCommand;
      const result = await this.repository.mutatePlayback(
        envelope.roomId,
        command,
        actor,
      );
      if (result.status !== "applied") {
        return acknowledgement(
          envelope.nonce,
          result.status === "ignored" ? "ignored" : "rejected",
          result.code,
        );
      }
      await this.persistCommittedRoom(result.room);
      await this.publishCommittedEvent(envelope.roomId, {
        type: "playback_updated",
        playback: result.playback,
        serverTime: result.room.lastActivity,
      });
      return acknowledgement(
        envelope.nonce,
        "applied",
        undefined,
        result.room.sequence,
      );
    }

    type SlowMutationValue =
      | { kind: "acknowledgement"; ack: CommandAcknowledgement }
      | { kind: "commit"; serverTime: number };
    const mutation = await this.repository.mutateRoom<SlowMutationValue>(
      envelope.roomId,
      async (room) => {
        if (!room) {
          return {
            status: "return" as const,
            value: {
              kind: "acknowledgement" as const,
              ack: acknowledgement(envelope.nonce, "rejected", "NOT_JOINED"),
            },
          };
        }
        const currentActor = room.participants[context.currentParticipantId!];
        if (!currentActor) {
          return {
            status: "return" as const,
            value: {
              kind: "acknowledgement" as const,
              ack: acknowledgement(
                envelope.nonce,
                "rejected",
                "NOT_PARTICIPANT",
              ),
            },
          };
        }
        if (room.processedCommandNonces?.includes(envelope.nonce)) {
          return {
            status: "return" as const,
            value: {
              kind: "acknowledgement" as const,
              ack: acknowledgement(envelope.nonce, "ignored", "DUPLICATE"),
            },
          };
        }
        if (!commandAllowed(room, currentActor.id, envelope.command)) {
          return {
            status: "return" as const,
            value: {
              kind: "acknowledgement" as const,
              ack: acknowledgement(envelope.nonce, "rejected", "NOT_PERMITTED"),
            },
          };
        }
        const validationCode = commandValidationCode(room, envelope.command);
        if (validationCode) {
          const status =
            validationCode === "STALE_MEDIA" ? "ignored" : "rejected";
          return {
            status: "return" as const,
            value: {
              kind: "acknowledgement" as const,
              ack: acknowledgement(envelope.nonce, status, validationCode),
            },
          };
        }

        const next = structuredClone(room);
        const serverTime = this.now();
        const changed = applySlowCommand(
          next,
          envelope.command.type,
          envelope.command.payload,
          currentActor.id,
          currentActor.nickname,
          serverTime,
        );
        if (!changed) {
          return {
            status: "return" as const,
            value: {
              kind: "acknowledgement" as const,
              ack: acknowledgement(
                envelope.nonce,
                "rejected",
                "INVALID_COMMAND",
              ),
            },
          };
        }
        if (
          next.currentMediaId !== room.currentMediaId ||
          next.playback.status !== room.playback.status ||
          next.playback.basePosition !== room.playback.basePosition ||
          next.playback.baseTimestamp !== room.playback.baseTimestamp ||
          next.playback.rate !== room.playback.rate
        ) {
          next.playback.updatedBy = currentActor.id;
        }
        next.version = room.version + 1;
        next.sequence = room.sequence + 1;
        next.lastActivity = serverTime;
        rememberNonce(next, envelope.nonce);
        return {
          status: "commit" as const,
          next,
          value: { kind: "commit" as const, serverTime },
        };
      },
    );

    if (mutation.status === "returned") {
      return mutation.value.kind === "acknowledgement"
        ? mutation.value.ack
        : acknowledgement(envelope.nonce, "rejected", "INVALID_COMMAND");
    }
    if (mutation.status === "contended") {
      return acknowledgement(envelope.nonce, "rejected", "CONTENTION");
    }

    await this.persistCommittedRoom(mutation.room);
    await this.publishCommittedEvent(envelope.roomId, {
      type: "room_state",
      room: sanitizeRoom(mutation.room),
      serverTime:
        mutation.value.kind === "commit"
          ? mutation.value.serverTime
          : mutation.room.lastActivity,
    });
    return acknowledgement(
      envelope.nonce,
      "applied",
      undefined,
      mutation.room.sequence,
    );
  }
}
