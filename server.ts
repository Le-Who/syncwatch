import { createServer } from "http";
import { parse } from "url";
import next from "next";
import { Server as SocketIOServer } from "socket.io";
import { randomUUID } from "crypto";

const dev = process.env.NODE_ENV !== "production";
const app = next({ dev });
const handle = app.getRequestHandler();

// Types
type PlaybackStatus = "playing" | "paused" | "buffering" | "ended";

interface PlaybackState {
  status: PlaybackStatus;
  basePosition: number;
  baseTimestamp: number;
  rate: number;
  updatedBy: string;
}

interface PlaylistItem {
  id: string;
  url: string;
  provider: string;
  title: string;
  duration: number;
  addedBy: string;
}

interface Participant {
  id: string;
  nickname: string;
  role: "owner" | "moderator" | "guest";
  lastSeen: number;
}

interface RoomSettings {
  controlMode: "open" | "controlled" | "hybrid";
  autoplayNext: boolean;
  looping: boolean;
}

interface RoomState {
  id: string;
  name: string;
  settings: RoomSettings;
  participants: Record<string, Participant>;
  playlist: PlaylistItem[];
  currentMediaId: string | null;
  playback: PlaybackState;
  version: number;
}

// In-memory state
const rooms = new Map<string, RoomState>();

function createEmptyRoom(id: string, name: string): RoomState {
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
  };
}

app.prepare().then(() => {
  const server = createServer((req, res) => {
    const parsedUrl = parse(req.url!, true);
    handle(req, res, parsedUrl);
  });

  const io = new SocketIOServer(server, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
    },
  });

  io.on("connection", (socket) => {
    console.log("Client connected:", socket.id);
    let currentRoomId: string | null = null;
    let currentParticipantId: string | null = null;

    socket.on("join_room", ({ roomId, nickname, participantId }) => {
      if (!rooms.has(roomId)) {
        rooms.set(roomId, createEmptyRoom(roomId, `Room ${roomId}`));
      }
      const room = rooms.get(roomId)!;

      const pId = participantId || socket.id;
      const isFirst = Object.keys(room.participants).length === 0;

      room.participants[pId] = {
        id: pId,
        nickname: nickname || `Guest ${Math.floor(Math.random() * 1000)}`,
        role: isFirst ? "owner" : "guest",
        lastSeen: Date.now(),
      };
      room.version++;

      socket.join(roomId);
      currentRoomId = roomId;
      currentParticipantId = pId;

      // Send full state to the joining client
      socket.emit("room_state", { room, serverTime: Date.now() });

      // Broadcast to others
      socket.to(roomId).emit("participant_joined", room.participants[pId]);
    });

    socket.on("command", ({ roomId, type, payload }) => {
      const room = rooms.get(roomId);
      if (!room || !currentParticipantId) return;

      const participant = room.participants[currentParticipantId];
      if (!participant) return;

      // Basic permission check
      const canControl =
        room.settings.controlMode === "open" ||
        participant.role === "owner" ||
        participant.role === "moderator" ||
        (room.settings.controlMode === "hybrid" &&
          ["play", "pause", "seek", "buffering", "next"].includes(type));

      if (!canControl && !["update_nickname"].includes(type)) {
        socket.emit("error", { message: "Permission denied" });
        return;
      }

      let stateChanged = false;

      switch (type) {
        case "play":
          if (room.playback.status !== "playing") {
            room.playback.status = "playing";
            room.playback.basePosition = payload.position;
            room.playback.baseTimestamp = Date.now();
            room.playback.updatedBy = participant.nickname;
            stateChanged = true;
          }
          break;
        case "pause":
          if (room.playback.status !== "paused") {
            room.playback.status = "paused";
            room.playback.basePosition = payload.position;
            room.playback.baseTimestamp = Date.now();
            room.playback.updatedBy = participant.nickname;
            stateChanged = true;
          }
          break;
        case "seek":
          room.playback.basePosition = payload.position;
          room.playback.baseTimestamp = Date.now();
          room.playback.updatedBy = participant.nickname;
          // Keep status as is, just update position
          stateChanged = true;
          break;
        case "buffering":
          if (room.playback.status === "playing") {
            room.playback.status = "buffering";
            room.playback.basePosition = payload.position;
            room.playback.baseTimestamp = Date.now();
            room.playback.updatedBy = participant.nickname;
            stateChanged = true;
          }
          break;
        case "add_item":
          const newItem: PlaylistItem = {
            id: randomUUID(),
            url: payload.url,
            provider: payload.provider || "unknown",
            title: payload.title || "Unknown Video",
            duration: payload.duration || 0,
            addedBy: participant.nickname,
          };
          room.playlist.push(newItem);
          if (!room.currentMediaId) {
            room.currentMediaId = newItem.id;
            room.playback.basePosition = 0;
            room.playback.baseTimestamp = Date.now();
            room.playback.status = "paused";
          }
          stateChanged = true;
          break;
        case "remove_item":
          room.playlist = room.playlist.filter(
            (item) => item.id !== payload.itemId,
          );
          if (room.currentMediaId === payload.itemId) {
            room.currentMediaId =
              room.playlist.length > 0 ? room.playlist[0].id : null;
            room.playback.status = "paused";
            room.playback.basePosition = 0;
          }
          stateChanged = true;
          break;
        case "reorder_playlist":
          if (payload.playlist && Array.isArray(payload.playlist)) {
            // Validate that it contains the same items
            const oldIds = new Set(room.playlist.map((i) => i.id));
            const newIds = new Set(payload.playlist.map((i: any) => i.id));
            if (oldIds.size === newIds.size && [...oldIds].every((id) => newIds.has(id))) {
              room.playlist = payload.playlist;
              stateChanged = true;
            }
          }
          break;
        case "set_media":
          room.currentMediaId = payload.itemId;
          room.playback.status = "paused";
          room.playback.basePosition = 0;
          room.playback.baseTimestamp = Date.now();
          room.playback.updatedBy = participant.nickname;
          stateChanged = true;
          break;
        case "next":
          if (payload.currentMediaId !== room.currentMediaId) {
            break;
          }
          const currentIndex = room.playlist.findIndex(
            (i) => i.id === room.currentMediaId,
          );
          if (currentIndex !== -1 && currentIndex < room.playlist.length - 1) {
            room.currentMediaId = room.playlist[currentIndex + 1].id;
            room.playback.status = "playing";
            room.playback.basePosition = 0;
            room.playback.baseTimestamp = Date.now();
            room.playback.updatedBy = participant.nickname;
            stateChanged = true;
          }
          break;
        case "update_settings":
          if (
            participant.role === "owner" ||
            participant.role === "moderator"
          ) {
            room.settings = { ...room.settings, ...payload.settings };
            stateChanged = true;
          }
          break;
        case "update_nickname":
          if (room.participants[currentParticipantId]) {
            room.participants[currentParticipantId].nickname = payload.nickname;
            stateChanged = true;
          }
          break;
      }

      if (stateChanged) {
        room.version++;
        io.to(roomId).emit("room_state", { room, serverTime: Date.now() });
      }
    });

    socket.on("disconnect", () => {
      if (currentRoomId && currentParticipantId) {
        const room = rooms.get(currentRoomId);
        if (room && room.participants[currentParticipantId]) {
          delete room.participants[currentParticipantId];
          room.version++;
          io.to(currentRoomId).emit("participant_left", {
            participantId: currentParticipantId,
          });

          // If room is empty, we could clean it up after a delay
          if (Object.keys(room.participants).length === 0) {
            setTimeout(
              () => {
                const r = rooms.get(currentRoomId!);
                if (r && Object.keys(r.participants).length === 0) {
                  rooms.delete(currentRoomId!);
                }
              },
              1000 * 60 * 5,
            ); // 5 minutes
          } else {
            // Reassign owner if owner left
            const remaining = Object.values(room.participants);
            if (!remaining.some((p) => p.role === "owner")) {
              remaining[0].role = "owner";
              io.to(currentRoomId).emit("room_state", { room, serverTime: Date.now() });
            }
          }
        }
      }
    });
  });

  const port = process.env.PORT || 3000;
  server.listen(port, () => {
    console.log(`> Ready on http://localhost:${port}`);
  });
});
