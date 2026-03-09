import { Server, Socket } from "socket.io";
import { SupabaseClient } from "@supabase/supabase-js";
import { RoomState } from "./types";
import { SocketContext } from "./socket/context";
import { handleConnectionEvents } from "./socket/connection";
import { handleCommandEvents } from "./socket/commands";

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
  const context: SocketContext = {
    currentRoomId: null,
    currentParticipantId: null,
  };

  handleConnectionEvents(io, socket, supabase, context);
  handleCommandEvents(io, socket, supabase, context);
}
