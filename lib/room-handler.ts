import { Server, Socket } from "socket.io";
import { SupabaseClient } from "@supabase/supabase-js";
import { normalizeRoomState, RoomState } from "./types";
export { normalizeRoomState } from "./types";
import { SocketContext } from "./socket/context";
import { handleConnectionEvents } from "./socket/connection";
import { handleCommandEvents } from "./socket/commands";
import { RoomEventBus } from "./room-event-bus";
import { emitRoomEventToSocketIo } from "./room-events";
import { pubClient } from "./redis-actor";
import { RoomCommandService } from "./room-command-service";
import { roomRepository } from "./room-repository";
import { persistRoomState } from "./db-sync";

export function createEmptyRoom(id: string, name: string): RoomState {
  return normalizeRoomState({
    id,
    generation: crypto.randomUUID(),
    name,
    settings: {
      autoplayNext: true,
      looping: false,
      shuffle: false,
    },
    participants: {},
    playlist: [],
    chat: [],
    currentMediaId: null,
    leaderId: null,
    playback: {
      status: "paused",
      basePosition: 0,
      baseTimestamp: Date.now(),
      rate: 1,
      updatedBy: "system",
    },
    flashbacks: {},
    version: 1,
    sequence: 1,
    lastActivity: Date.now(),
  });
}

export function sanitizeRoom(room: RoomState): RoomState {
  const normalized = normalizeRoomState(room);
  const sanitized = {
    ...normalized,
    participants: { ...normalized.participants },
  };
  delete sanitized.processedCommandNonces;
  for (const pid in sanitized.participants) {
    sanitized.participants[pid] = { ...sanitized.participants[pid] };
    delete (sanitized.participants[pid] as any).sessionToken;
    delete (sanitized.participants[pid] as any).connectionIds;
  }
  return sanitized;
}

export function registerRoomHandlers(
  io: Server,
  socket: Socket,
  supabase: SupabaseClient | null,
  suppliedEventBus?: RoomEventBus,
) {
  const context: SocketContext = {
    currentRoomId: null,
    currentParticipantId: null,
  };

  const eventBus =
    suppliedEventBus ??
    new RoomEventBus(
      (roomId, event) => emitRoomEventToSocketIo(io, roomId, event),
      pubClient(),
    );

  handleConnectionEvents(io, socket, supabase, context, eventBus);
  const commandService = new RoomCommandService({
    repository: roomRepository,
    eventBus,
    schedulePersistence: (room) => persistRoomState(room, supabase),
  });
  handleCommandEvents(io, socket, supabase, context, commandService, eventBus);
}
