import { createServer, Server as NetServer } from "http";
import next from "next";
import { Server as SocketIOServer } from "socket.io";
import { randomUUID } from "crypto";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { jwtVerify } from "jose";
import * as cookie from "cookie";
import { checkRedisRateLimit, getRedisClient } from "./lib/redis-rate-limit";
import { createHash } from "crypto";
import {
  withLock,
  getRedisRoom,
  setRedisRoom,
  setRedisRoomCAS,
  publishRoomEvent,
  subClient,
  pubClient,
} from "./lib/redis-actor";

function getDeterministicUUID(roomId: string): string {
  if (
    roomId.length === 36 &&
    roomId.match(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    )
  ) {
    return roomId;
  }
  const hash = createHash("md5")
    .update("room_" + roomId)
    .digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

// Load environment variables manually for the custom server
import { loadEnvConfig } from "@next/env";
const projectDir = process.cwd();
loadEnvConfig(projectDir);

const dev = process.env.NODE_ENV !== "production";
const app = next({ dev });
const handle = app.getRequestHandler();

// Supabase Setup
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  "";

let supabase: SupabaseClient | null = null;

if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
  supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      persistSession: false,
    },
  });
  console.log(
    "✅ Supabase initialized with Service Role (Persistence Enabled)",
  );
} else {
  console.warn("\n=======================================================");
  console.warn("⚠️ WARNING: Running in Ephemeral Memory Mode.");
  console.warn("⚠️ SUPABASE_SERVICE_ROLE_KEY is missing.");
  console.warn("⚠️ Data will NOT persist to the database.");
  console.warn("=======================================================\n");
}

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
  startPosition?: number;
  lastPosition?: number;
  thumbnail?: string;
}

interface Participant {
  id: string;
  nickname: string;
  role: "owner" | "moderator" | "guest";
  lastSeen: number;
  sessionToken?: string;
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
  sequence: number; // For command ordering and stale event rejection
  lastActivity: number;
}

// In-memory state
const rooms = new Map<string, RoomState>();

// Garbage Collection: Check every 5 minutes and delete rooms empty for >15 minutes
setInterval(
  () => {
    const now = Date.now();
    for (const [roomId, room] of rooms.entries()) {
      const participantsCount = Object.keys(room.participants).length;
      if (participantsCount === 0) {
        if (now - room.lastActivity > 15 * 60 * 1000) {
          // Force a final persist just in case, then delete
          // Force a final persist just in case, then delete
          persistRoomState(room);
          rooms.delete(roomId);
        }
      }
    }
  },
  5 * 60 * 1000,
);

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
    sequence: 1,
    lastActivity: Date.now(),
  };
}

// Security: Prevent sending sensitive tokens to other clients
function sanitizeRoom(room: RoomState): RoomState {
  const sanitized = { ...room, participants: { ...room.participants } };
  for (const pid in sanitized.participants) {
    sanitized.participants[pid] = { ...sanitized.participants[pid] };
    delete (sanitized.participants[pid] as any).sessionToken;
  }
  return sanitized;
}

// Database sync helpers - Write-Behind Queue
const writeBehindQueue = new Set<string>();

const persistRoomState = (room: RoomState) => {
  if (!supabase) return; // Immediately stop if we are in Ephemeral Memory Mode
  writeBehindQueue.add(room.id);
};

const forcePersistRoom = async (room: RoomState) => {
  if (!supabase) return;
  try {
    const { error } = await supabase.rpc("sync_room_state", {
      p_room_id: getDeterministicUUID(room.id),
      p_name: room.name,
      p_settings: room.settings,
      p_owner_id:
        Object.values(room.participants).find((p) => p.role === "owner")?.id ||
        room.id,
      p_playlist: room.playlist.map((item, index) => ({
        id: item.id,
        url: item.url,
        provider: item.provider,
        title: item.title,
        duration: item.duration,
        addedBy: item.addedBy,
        position: index,
        lastPosition: item.lastPosition || 0,
        thumbnail: item.thumbnail,
      })),
      p_playback: {
        currentMediaId: room.currentMediaId,
        status: room.playback.status,
        basePosition: room.playback.basePosition,
        baseTimestamp: room.playback.baseTimestamp,
        rate: room.playback.rate,
        updatedBy: room.playback.updatedBy,
      },
      p_version: room.version,
    });

    if (error) {
      if (error.code === "22P02") {
        console.warn(
          `[Poison Pill] Dropping invalid UUID task for room ${room.id}:`,
          error,
        );
        return;
      }
      console.error(`Failed to persist room ${room.id} via RPC:`, error);
      throw error;
    }
  } catch (err: any) {
    if (err?.code === "22P02") {
      console.warn(`[Poison Pill] Dropping invalid task:`, err);
      return;
    }
    console.error(`Fatal error persisting room ${room.id}`, err);
    throw err; // Re-throw for parent to catch
  }
};

// Background worker to flush queue every 30 seconds
setInterval(async () => {
  if (writeBehindQueue.size === 0 || !supabase) return;

  const queue = Array.from(writeBehindQueue);
  writeBehindQueue.clear();

  for (const roomId of queue) {
    const room = rooms.get(roomId);
    if (!room) continue;

    try {
      await forcePersistRoom(room);
    } catch (err) {
      // Re-queue on transient failure
      writeBehindQueue.add(roomId);
    }
  }
}, 30000);

// Graceful Shutdown Sequence
let isShuttingDown = false;
async function gracefulShutdown() {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log("Shutting down... flushing write-behind queue...");

  const queue = Array.from(writeBehindQueue);
  for (const roomId of queue) {
    const room = rooms.get(roomId);
    if (room) {
      await forcePersistRoom(room).catch(() => {});
    }
  }

  console.log("Queue flushed. Exiting process.");
  process.exit(0);
}

process.on("SIGTERM", gracefulShutdown);
process.on("SIGINT", gracefulShutdown);

async function loadRoomFromDB(roomId: string): Promise<RoomState | null> {
  if (!supabase) return null;
  try {
    const dbRoomId = getDeterministicUUID(roomId);
    const { data: roomData } = await supabase
      .from("rooms")
      .select("*")
      .eq("id", dbRoomId)
      .single();
    if (!roomData) return null;

    const { data: playlistData } = await supabase
      .from("playlist_items")
      .select("*")
      .eq("room_id", dbRoomId)
      .order("position");
    const { data: snapshotData } = await supabase
      .from("playback_snapshots")
      .select("*")
      .eq("room_id", dbRoomId)
      .single();

    const room = createEmptyRoom(roomId, roomData.name);
    room.settings =
      typeof roomData.settings === "string"
        ? JSON.parse(roomData.settings)
        : roomData.settings;

    if (playlistData) {
      room.playlist = playlistData.map((item: any) => ({
        id: item.id,
        url: item.url,
        provider: item.provider,
        title: item.title,
        duration: item.duration,
        addedBy: item.added_by,
        lastPosition: item.last_position || 0,
        thumbnail: item.thumbnail,
      }));
    }

    if (snapshotData) {
      room.currentMediaId = snapshotData.media_item_id;
      room.playback = {
        status: snapshotData.status as PlaybackStatus,
        basePosition: snapshotData.base_position,
        baseTimestamp: Number(snapshotData.base_timestamp) || Date.now(),
        rate: snapshotData.rate,
        updatedBy: snapshotData.updated_by,
      };
      room.version = snapshotData.version;
    }

    return room;
  } catch (err) {
    console.error(`Error loading room ${roomId} from DB`, err);
    return null;
  }
}

app.prepare().then(() => {
  const server = createServer((req, res) => {
    try {
      // Use WHATWG URL API instead of deprecated url.parse
      const protocol = req.headers["x-forwarded-proto"] || "http";
      const host = req.headers.host || "localhost";
      const parsedUrl = new URL(req.url!, `${protocol}://${host}`);

      // Next.js expects { pathname, query } shape originally from url.parse
      const query = Object.fromEntries(parsedUrl.searchParams.entries());
      handle(req, res, {
        pathname: parsedUrl.pathname,
        query,
      } as any);
    } catch (err) {
      res.statusCode = 400;
      res.end("Bad Request");
    }
  });

  const io = new SocketIOServer(server, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
      credentials: true,
    },
    pingTimeout: 60000,
    pingInterval: 25000,
  });

  const JWT_SECRET = new TextEncoder().encode(
    process.env.JWT_SECRET || "default_local_secret_dont_use_in_prod",
  );

  io.use(async (socket, next) => {
    try {
      const cookies = cookie.parse(socket.request.headers.cookie || "");
      const token = cookies.syncwatch_session;

      const redisClient = getRedisClient(); // Added this line as per instruction

      if (token) {
        const { payload } = await jwtVerify(token, JWT_SECRET);
        if (payload.participantId) {
          socket.data.participantId = payload.participantId;
          return next();
        }
      }

      // If no token exists (e.g. fresh secondary browser), don't reject the connection immediately.
      // Rejecting it completely breaks the UI sync loop because the frontend expects a connection.
      // Instead, we assign a temporary guest connection ID. The frontend must be smart enough
      // to request a real session if it needs to execute commands.
      socket.data.participantId = `guest_${socket.id}`;
      next();
    } catch (err) {
      // Even on error, allow connection but mark as temporary guest to prevent UI freezes
      socket.data.participantId = `guest_${socket.id}`;
      next();
    }
  });

  // Global Pub/Sub Listener for Node Synchronization
  const sClient = subClient();
  if (sClient) {
    sClient.psubscribe("room_events:*");
    sClient.on(
      "pmessage",
      (pattern: string, channel: string, message: string) => {
        try {
          const roomId = channel.split(":")[1];
          if (!roomId) return;
          const data = JSON.parse(message);
          if (data.type === "state_update") {
            // If we have local clients connected to this room, update local cache and emit
            // Using io.sockets.adapter.rooms.has is an efficient way to check local presence
            if (io.sockets.adapter.rooms.has(roomId)) {
              rooms.set(roomId, data.payload);
              io.to(roomId).emit("room_state", {
                room: data.payload,
                serverTime: Date.now(),
              });
            }
          }
        } catch (e) {
          console.error("PubSub parse error:", e);
        }
      },
    );
  }

  // Handle cleanup of zombies periodically if Redis exists
  setInterval(
    () => {
      rooms.forEach(async (room, roomId) => {
        if (Date.now() - room.lastActivity > 1000 * 60 * 15) {
          persistRoomState(room);
          rooms.delete(roomId);
          const redisClient = getRedisClient();
          if (redisClient) {
            await redisClient.del(`room_state:${roomId}`).catch(() => {});
          }
        }
      });
    },
    1000 * 60 * 15,
  );

  io.on("connection", (socket) => {
    let currentRoomId: string | null = null;
    let currentParticipantId: string | null = null;

    // NTP-style time sync implementation
    socket.on(
      "ping_time",
      (
        clientTime: number,
        callback: (serverTime: number, clientTime: number) => void,
      ) => {
        // Send back immediately so client can calculate RTT and offset
        callback(Date.now(), clientTime);
      },
    );

    socket.on("join_room", async ({ roomId, nickname }) => {
      const ip =
        socket.handshake.headers["x-forwarded-for"] ||
        socket.handshake.address ||
        "unknown";
      if (!(await checkRedisRateLimit(`ws:join:${ip}`, 50, 60000))) {
        socket.emit("error", { message: "Too many join requests" });
        return;
      }

      let room: RoomState | undefined | null = rooms.get(roomId);

      if (!room) {
        // Try to load from DB first
        room = await loadRoomFromDB(roomId);
        if (!room) {
          room = createEmptyRoom(roomId, `Room ${roomId}`);
        }
        rooms.set(roomId, room);
      }

      room.lastActivity = Date.now();

      const pId = socket.data.participantId;
      const isFirst = Object.keys(room.participants).length === 0;

      // Handle reconnect or new join
      const existingParticipant = room.participants[pId];
      if (existingParticipant) {
        existingParticipant.lastSeen = Date.now();
        existingParticipant.nickname = nickname || existingParticipant.nickname;
      } else {
        room.participants[pId] = {
          id: pId,
          nickname: nickname || `Guest ${Math.floor(Math.random() * 1000)}`,
          role: isFirst ? "owner" : "guest",
          lastSeen: Date.now(),
        };
      }

      room.version++;

      socket.join(roomId);
      currentRoomId = roomId;
      currentParticipantId = pId;

      socket.emit("room_state", {
        room: sanitizeRoom(room),
        serverTime: Date.now(),
      });

      // participant_joined only needs sanitized data
      const joinedInfo = { ...room.participants[pId] };
      socket.to(roomId).emit("participant_joined", joinedInfo);
    });

    socket.on("command", async (rawCommand) => {
      // OOM & Type Protection Fast Check
      if (!rawCommand || typeof rawCommand !== "object") return;

      const ip =
        socket.handshake.headers["x-forwarded-for"] ||
        socket.handshake.address ||
        "unknown";
      if (!(await checkRedisRateLimit(`ws:command:${ip}`, 60, 10000))) {
        socket.emit("error", { message: "Rate limit exceeded" });
        return;
      }

      const payloadString = JSON.stringify(rawCommand);
      if (payloadString.length > 50000) {
        socket.emit("error", {
          message: "Payload too large. Request rejected.",
        });
        return;
      }

      const { roomId, type, payload, sequence } = rawCommand;
      if (typeof type !== "string" || type.length > 50) return;

      try {
        let occRetries = 10;
        let finalRoomState = null;
        let stateChanged = false;

        while (occRetries > 0) {
          stateChanged = false;
          if (!currentParticipantId) {
            // This should ideally not happen if the socket.io middleware works correctly
            socket.emit("error", {
              message: "Unauthorized command. No participant ID.",
            });
            return;
          }

          // We must explicitly reject "guest_" accounts from sending commands.
          // They are allowed to connect to receive state, but cannot mutate state.
          if (currentParticipantId.startsWith("guest_")) {
            socket.emit("error", {
              message:
                "Unauthorized command. Guest accounts cannot send commands.",
            });
            return;
          }

          let room = await getRedisRoom(roomId);
          if (!room) {
            room = rooms.get(roomId); // Fallback local
            if (room) {
              room = JSON.parse(JSON.stringify(room)); // deep clone for OCC
            }
          }
          if (!room) return;

          const baseVersion = room.version;
          room.lastActivity = Date.now();
          const participant = room.participants[currentParticipantId];

          if (!participant) {
            socket.emit("error", {
              message: "Unauthorized command. Invalid session.",
            });
            return;
          }

          room.sequence++;

          // Permission checks
          const isOwnerOrMod =
            participant.role === "owner" || participant.role === "moderator";
          const canControlPlayback =
            room.settings.controlMode === "open" ||
            isOwnerOrMod ||
            (room.settings.controlMode === "hybrid" &&
              ["play", "pause", "seek", "buffering", "next"].includes(type));
          const canEditPlaylist =
            room.settings.controlMode === "open" || isOwnerOrMod;

          // Ensure commands are valid and authoritative
          switch (type) {
            case "play":
              if (!canControlPlayback) break;
              if (
                typeof payload.position !== "number" ||
                !Number.isFinite(payload.position) ||
                payload.position < 0
              )
                break;
              // Validations: verify position is reasonable
              if (
                room.playback.status !== "playing" ||
                Math.abs(room.playback.basePosition - payload.position) > 2.0
              ) {
                room.playback.status = "playing";
                room.playback.basePosition = payload.position;
                room.playback.baseTimestamp = Date.now();
                room.playback.updatedBy = participant.nickname;
                stateChanged = true;
              }
              break;

            case "pause":
              if (!canControlPlayback) break;
              if (
                typeof payload.position !== "number" ||
                !Number.isFinite(payload.position) ||
                payload.position < 0
              )
                break;
              // ALLOW escaping from stuck buffering state
              if (room.playback.status !== "paused") {
                room.playback.status = "paused";
                room.playback.basePosition = payload.position;
                room.playback.baseTimestamp = Date.now();
                room.playback.updatedBy = participant.nickname;
                stateChanged = true;
              }
              break;

            case "seek":
              if (!canControlPlayback) break;
              if (
                typeof payload.position !== "number" ||
                !Number.isFinite(payload.position) ||
                payload.position < 0
              )
                break;
              room.playback.basePosition = payload.position;
              room.playback.baseTimestamp = Date.now();
              room.playback.updatedBy = participant.nickname;
              stateChanged = true;
              break;

            case "update_rate":
              if (!canControlPlayback) break;
              if (
                typeof payload.rate !== "number" ||
                !Number.isFinite(payload.rate)
              )
                break;
              // Only allow reasonable playback rates (e.g. 0.25 to 4.0)
              if (payload.rate >= 0.25 && payload.rate <= 4.0) {
                // Need to update basePosition to current virtual position before changing rate
                // so we don't jump backward/forward unexpectedly
                if (room.playback.status === "playing") {
                  const now = Date.now();
                  const elapsedSeconds =
                    (now - room.playback.baseTimestamp) / 1000;
                  const currentVirtualPosition =
                    room.playback.basePosition +
                    elapsedSeconds * room.playback.rate;
                  room.playback.basePosition = currentVirtualPosition;
                  room.playback.baseTimestamp = now;
                }
                room.playback.rate = payload.rate;
                room.playback.updatedBy = participant.nickname;
                stateChanged = true;
                persistRoomState(room);
              }
              break;

            case "buffering":
              if (!canControlPlayback) break;
              if (
                typeof payload.position !== "number" ||
                !Number.isFinite(payload.position) ||
                payload.position < 0
              )
                break;
              if (room.playback.status === "playing") {
                room.playback.status = "buffering";
                room.playback.basePosition = payload.position;
                room.playback.baseTimestamp = Date.now();
                room.playback.updatedBy = participant.nickname;
                stateChanged = true;
              }
              break;

            case "add_item":
              if (!canEditPlaylist) break;
              // Guard against unbounded memory exhaustion (OOM attack vector)
              if (room.playlist.length >= 500) {
                socket.emit("error", {
                  message: "Playlist maximum limit reached (500 items)",
                });
                break;
              }
              const newItem: PlaylistItem = {
                id: randomUUID(),
                url: payload.url,
                provider: payload.provider || "unknown", // Client sets this validation
                title: payload.title || "Unknown Video",
                duration: payload.duration || 0,
                addedBy: participant.nickname,
                startPosition: payload.startPosition || 0,
                thumbnail: payload.thumbnail,
              };
              room.playlist.push(newItem);
              if (!room.currentMediaId) {
                room.currentMediaId = newItem.id;
                room.playback.basePosition = newItem.startPosition || 0;
                room.playback.baseTimestamp = Date.now();
                // Inherit momentum, otherwise paused
                room.playback.status =
                  room.playback.status === "playing" ? "playing" : "paused";
              }
              stateChanged = true;
              persistRoomState(room); // Debounced automatically
              break;

            case "add_items":
              if (!canEditPlaylist) break;
              if (!Array.isArray((payload as any).items)) break;

              const availableSlots = 500 - room.playlist.length;
              if (availableSlots <= 0) {
                socket.emit("error", {
                  message: "Playlist maximum limit reached (500 items)",
                });
                break;
              }

              // 1. Slice to available capacity explicitly to avoid iterating over 500+ items that will just fail
              const itemsToProcess = (payload as any).items.slice(
                0,
                availableSlots,
              );

              // 2. Deduplicate URLs within the payload
              const uniqueUrls = new Set<string>();
              const dedupedItemsToProcess = [];

              for (const item of itemsToProcess) {
                if (typeof item.url !== "string" || !item.url.trim()) continue;
                // Also dedupe against existing playlist quickly
                const alreadyExists = room.playlist.some(
                  (pi: any) => pi.url === item.url,
                );
                if (!uniqueUrls.has(item.url) && !alreadyExists) {
                  uniqueUrls.add(item.url);
                  dedupedItemsToProcess.push(item);
                }
              }

              if (dedupedItemsToProcess.length === 0) {
                if (itemsToProcess.length > 0) {
                  socket.emit("error", {
                    message: "All provided items are already in the playlist.",
                  });
                }
                break;
              }

              let addedCount = 0;
              let firstAddedId = null;

              for (const item of dedupedItemsToProcess) {
                const newBulkItem: PlaylistItem = {
                  id: randomUUID(),
                  url: item.url,
                  provider: item.provider || "youtube",
                  title: item.title || "Unknown Video",
                  duration: item.duration || 0,
                  addedBy: participant.nickname,
                  startPosition: item.startPosition || 0,
                  lastPosition: 0,
                  thumbnail: item.thumbnail,
                };

                room.playlist.push(newBulkItem);
                addedCount++;

                if (!firstAddedId) firstAddedId = newBulkItem.id;

                if (!room.currentMediaId) {
                  room.currentMediaId = newBulkItem.id;
                  room.playback.basePosition = newBulkItem.startPosition || 0;
                  room.playback.baseTimestamp = Date.now();
                  room.playback.status =
                    room.playback.status === "playing" ? "playing" : "paused";
                }
              }

              if (
                addedCount < itemsToProcess.length &&
                availableSlots < (payload as any).items.length
              ) {
                socket.emit("error", {
                  message: `Partial add: Added ${addedCount} items. Playlist limit reached (500 items).`,
                });
              }

              if (addedCount > 0) {
                stateChanged = true;
                persistRoomState(room);
              }
              break;

            case "remove_item":
              if (!canEditPlaylist) break;
              // Capture progress if removing current
              if (room.currentMediaId === payload.itemId) {
                const currentItem = room.playlist.find(
                  (i: any) => i.id === payload.itemId,
                );
                if (currentItem && room.playback.status === "playing") {
                  const elapsed =
                    (Date.now() - room.playback.baseTimestamp) / 1000;
                  currentItem.lastPosition =
                    room.playback.basePosition + elapsed * room.playback.rate;
                }
              }
              room.playlist = room.playlist.filter(
                (item: any) => item.id !== payload.itemId,
              );
              if (room.currentMediaId === payload.itemId) {
                room.currentMediaId =
                  room.playlist.length > 0 ? room.playlist[0].id : null;
                room.playback.status =
                  room.playback.status === "playing" ? "playing" : "paused";
                const newHead = room.currentMediaId
                  ? room.playlist.find((i: any) => i.id === room.currentMediaId)
                  : null;
                room.playback.basePosition = newHead
                  ? newHead.lastPosition || newHead.startPosition || 0
                  : 0;
                room.playback.baseTimestamp = Date.now();
              }
              stateChanged = true;
              persistRoomState(room);
              break;

            case "reorder_playlist":
              if (!canEditPlaylist) break;
              if (payload.playlist && Array.isArray(payload.playlist)) {
                const oldIds = new Set(room.playlist.map((i: any) => i.id));
                const newIds = new Set(payload.playlist.map((i: any) => i.id));
                if (
                  oldIds.size === newIds.size &&
                  [...oldIds].every((id) => newIds.has(id))
                ) {
                  room.playlist = payload.playlist;
                  stateChanged = true;
                  persistRoomState(room);
                }
              }
              break;

            case "set_media":
              if (!canControlPlayback && !canEditPlaylist) break;

              // Save current progress before switching
              const activeItemSet = room.playlist.find(
                (i: any) => i.id === room.currentMediaId,
              );
              if (activeItemSet) {
                const elapsed =
                  room.playback.status === "playing"
                    ? (Date.now() - room.playback.baseTimestamp) / 1000
                    : 0;
                activeItemSet.lastPosition =
                  room.playback.basePosition + elapsed * room.playback.rate;
              }

              room.currentMediaId = payload.itemId;
              const targetItemForSet = room.playlist.find(
                (i: any) => i.id === payload.itemId,
              );
              room.playback.status =
                room.playback.status === "playing" ? "playing" : "paused";
              room.playback.basePosition =
                targetItemForSet?.lastPosition ||
                targetItemForSet?.startPosition ||
                0;
              room.playback.baseTimestamp = Date.now();
              room.playback.updatedBy = participant.nickname;
              stateChanged = true;
              persistRoomState(room);
              break;

            case "next":
              if (!canControlPlayback) break;
              if (payload.currentMediaId !== room.currentMediaId) break;

              const activeItemNext = room.playlist.find(
                (i: any) => i.id === room.currentMediaId,
              );
              if (activeItemNext) {
                const elapsed =
                  room.playback.status === "playing"
                    ? (Date.now() - room.playback.baseTimestamp) / 1000
                    : 0;
                activeItemNext.lastPosition =
                  room.playback.basePosition + elapsed * room.playback.rate;
              }

              const currentIndex = room.playlist.findIndex(
                (i: any) => i.id === room.currentMediaId,
              );
              if (
                currentIndex !== -1 &&
                currentIndex < room.playlist.length - 1
              ) {
                const nextItem = room.playlist[currentIndex + 1];
                room.currentMediaId = nextItem.id;
                room.playback.status = "playing"; // Auto-play next
                room.playback.basePosition =
                  nextItem.lastPosition || nextItem.startPosition || 0;
                room.playback.baseTimestamp = Date.now();
                room.playback.updatedBy = participant.nickname;
                stateChanged = true;
                persistRoomState(room);
              } else if (room.settings.looping && room.playlist.length > 0) {
                const loopItem = room.playlist[0];
                room.currentMediaId = loopItem.id;
                room.playback.status = "playing";
                room.playback.basePosition =
                  loopItem.lastPosition || loopItem.startPosition || 0;
                room.playback.baseTimestamp = Date.now();
                room.playback.updatedBy = participant.nickname;
                stateChanged = true;
                persistRoomState(room);
              }
              break;

            case "video_ended":
              if (!canControlPlayback) break;
              if (payload.currentMediaId !== room.currentMediaId) break;

              const activeItemEnded = room.playlist.find(
                (i: any) => i.id === room.currentMediaId,
              );
              if (activeItemEnded) {
                activeItemEnded.lastPosition = 0; // Reset progress when naturally ended
              }

              const nextIndex = room.playlist.findIndex(
                (i: any) => i.id === room.currentMediaId,
              );
              if (
                nextIndex !== -1 &&
                nextIndex < room.playlist.length - 1 &&
                room.settings.autoplayNext
              ) {
                const nextItem = room.playlist[nextIndex + 1];
                room.currentMediaId = nextItem.id;
                room.playback.status = "playing"; // Auto-play next
                room.playback.basePosition =
                  nextItem.lastPosition || nextItem.startPosition || 0;
                room.playback.baseTimestamp = Date.now();
                room.playback.updatedBy = participant.nickname;
                stateChanged = true;
                persistRoomState(room);
              } else if (
                room.settings.looping &&
                room.playlist.length > 0 &&
                room.settings.autoplayNext
              ) {
                const loopItem = room.playlist[0];
                room.currentMediaId = loopItem.id;
                room.playback.status = "playing";
                room.playback.basePosition =
                  loopItem.lastPosition || loopItem.startPosition || 0;
                room.playback.baseTimestamp = Date.now();
                room.playback.updatedBy = participant.nickname;
                stateChanged = true;
                persistRoomState(room);
              } else {
                room.playback.status = "ended";
                room.playback.updatedBy = participant.nickname;
                stateChanged = true;
                persistRoomState(room);
              }
              break;

            case "update_duration":
              if (typeof payload.duration !== "number" || !payload.itemId)
                break;
              const targetItemDur = room.playlist.find(
                (i: any) => i.id === payload.itemId,
              );
              if (
                targetItemDur &&
                targetItemDur.duration !== payload.duration
              ) {
                targetItemDur.duration = payload.duration;
                stateChanged = true;
                persistRoomState(room);
              }
              break;

            case "update_settings":
              if (!isOwnerOrMod) break;
              room.settings = { ...room.settings, ...payload.settings };
              stateChanged = true;
              persistRoomState(room);
              break;

            case "update_room_name":
              if (!isOwnerOrMod) break;
              if (typeof payload.name === "string" && payload.name.trim()) {
                room.name = payload.name.substring(0, 50);
                stateChanged = true;
                persistRoomState(room);
              }
              break;

            case "update_nickname":
              if (room.participants[currentParticipantId]) {
                room.participants[currentParticipantId].nickname = String(
                  payload.nickname,
                ).substring(0, 30);
                stateChanged = true;
              }
              break;

            case "update_role": // New command for safe transfer
              if (participant.role !== "owner") break;
              const targetUser = room.participants[payload.participantId];
              if (
                targetUser &&
                ["guest", "moderator", "owner"].includes(payload.role)
              ) {
                // Safety guard: if transferring owner, downgrade self to moderator
                if (payload.role === "owner") {
                  participant.role = "moderator";
                }
                targetUser.role = payload.role;
                stateChanged = true;
              }
              break;

            case "claim_host":
              // Only allow claiming if literally NO ONE is an owner
              const hasOwner = Object.values(room.participants).some(
                (p: any) => p.role === "owner",
              );
              if (!hasOwner) {
                participant.role = "owner";
                stateChanged = true;
              }
              break;

            default:
              socket.emit("error", {
                message: "Unknown command or permission denied",
              });
              break;
          }

          if (stateChanged) {
            room.version = baseVersion + 1;
            const pClient = pubClient();

            if (pClient) {
              const redisSuccess = await setRedisRoomCAS(
                roomId,
                room,
                baseVersion,
              );
              if (redisSuccess) {
                finalRoomState = room;
                break;
              }
              // OCC conflict, backoff and retry
              await new Promise((r) => setTimeout(r, 10 + Math.random() * 20));
              occRetries--;
            } else {
              // Fallback no Redis
              finalRoomState = room;
              break;
            }
          } else {
            break;
          }
        } // End of OCC while block

        if (stateChanged && !finalRoomState) {
          socket.emit("error", {
            message: "System busy acquiring room lock. Try again.",
          });
          return;
        }

        if (finalRoomState) {
          rooms.set(roomId, finalRoomState); // L1 Cache Update
          const pClient = pubClient();
          if (pClient) {
            await publishRoomEvent(roomId, {
              type: "state_update",
              roomId,
              payload: finalRoomState,
            });
          } else {
            io.to(roomId).emit("room_state", {
              room: finalRoomState,
              serverTime: Date.now(),
            });
          }
        }
      } catch (err) {
        console.error(
          "Lock error for room",
          roomId,
          "Command Type:",
          type,
          err,
        );
        socket.emit("error", {
          message: "System busy acquiring room lock. Try again.",
        });
      }
    });

    socket.on("reaction", (payload) => {
      try {
        if (!currentRoomId || !currentParticipantId) return;
        // Broadcast reaction to everyone else in the room
        socket.to(currentRoomId).emit("reaction", payload);
      } catch (e) {
        console.error("Error processing reaction:", e);
      }
    });

    socket.on("disconnect", () => {
      if (currentRoomId && currentParticipantId) {
        const room = rooms.get(currentRoomId);
        if (room && room.participants[currentParticipantId]) {
          // Grace period for reconnects
          room.participants[currentParticipantId].lastSeen = Date.now();

          // Use a timeout to actually remove them
          setTimeout(() => {
            const r = rooms.get(currentRoomId!);
            if (
              r &&
              r.participants[currentParticipantId!] &&
              Date.now() - r.participants[currentParticipantId!].lastSeen >
                10000
            ) {
              delete r.participants[currentParticipantId!];
              r.version++;
              io.to(currentRoomId!).emit("participant_left", {
                participantId: currentParticipantId,
              });

              // Empty room cleanup
              const remaining = Object.values(r.participants);
              if (remaining.length === 0) {
                // Room is empty, it will be cleaned up by the global Garbage Collector
                // after 15 minutes of inactivity.
                persistRoomState(r);
              } else {
                // Owner transfer guard
                if (!remaining.some((p) => p.role === "owner")) {
                  remaining[0].role = "owner"; // Promote oldest user to owner
                  io.to(currentRoomId!).emit("room_state", {
                    room: r,
                    serverTime: Date.now(),
                  });
                }
              }
            }
          }, 15000); // Wait 15s to see if they reconnect
        }
      }
    });
  });

  const port = process.env.PORT || 3000;
  server.listen(port, () => {
    console.log(`> Ready on http://localhost:${port}`);
  });
});
