import { z } from "zod";
import { commandSchema } from "./zod-schemas";

/** Authoritative scalar contract used even before the full envelope is parsed. */
export const commandNonceSchema = z.string().uuid();

export const roomCommandEnvelopeSchema = z.object({
  roomId: z.string().min(1).max(128),
  nonce: commandNonceSchema,
  clientSequence: z.number().int().nonnegative(),
  command: commandSchema,
});

export type RoomCommand = z.infer<typeof commandSchema>;
export type RoomCommandEnvelope = z.infer<typeof roomCommandEnvelopeSchema>;
export type CommandRejectionCode =
  | "INVALID_COMMAND"
  | "ROOM_MISMATCH"
  | "NOT_JOINED"
  | "NOT_PARTICIPANT"
  | "NOT_PERMITTED"
  | "STALE_MEDIA"
  | "DUPLICATE"
  | "NO_CHANGE"
  | "CONTENTION"
  | "QUEUE_FULL";

export interface CommandAcknowledgement {
  nonce: string;
  status: "applied" | "ignored" | "rejected";
  code?: CommandRejectionCode;
  message?: string;
  roomSequence?: number;
}
