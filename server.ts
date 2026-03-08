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
import { executeFastMutation } from "./lib/redis-lua";
import { pushSlowCommand } from "./lib/redis-queue";
import { processQueueForRoom } from "./lib/redis-queue-worker";

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

// Memory state is now exclusively managed via Redis (`getRedisRoom` / `setRedisRoom`)
// to strictly enforce a stateless backend Architecture. Local fallback is handled in `redis-actor.ts`.

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
export function sanitizeRoom(room: RoomState): RoomState {
  const sanitized = { ...room, participants: { ...room.participants } };
  for (const pid in sanitized.participants) {
    sanitized.participants[pid] = { ...sanitized.participants[pid] };
    delete (sanitized.participants[pid] as any).sessionToken;
  }
  return sanitized;
}

// Database sync helpers - Persistent Redis Write-Behind Queue
// In-memory fallback if Redis is entirely unavailable
const writeBehindQueue = new Set<string>();

const persistRoomState = (room: RoomState) => {
  if (!supabase) return; // Immediately stop if we are in Ephemeral Memory Mode
  const redisClient = getRedisClient();
  if (redisClient) {
    // Add to sorted set with current timestamp.
    // This allows us to process oldest pending syncs first, and retry if they get stuck.
    redisClient
      .zadd("pending_db_syncs", Date.now(), room.id)
      .catch((e) => console.error("Redis queue error:", e));
  } else {
    writeBehindQueue.add(room.id);
  }
};

const forcePersistRoom = async (room: RoomState) => {
  if (!supabase) return;
  try {
    const { error } = await supabase.rpc("sync_room_state", {
      room_data: {
        id: getDeterministicUUID(room.id),
        name: room.name,
        settings: room.settings,
        owner_id: getDeterministicUUID(
          Object.values(room.participants).find((p) => p.role === "owner")
            ?.id || room.id,
        ),
        playlist: room.playlist.map((item, index) => ({
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
        playback: {
          mediaItemId: room.currentMediaId,
          status: room.playback.status,
          basePosition: room.playback.basePosition,
          baseTimestamp: room.playback.baseTimestamp,
          rate: room.playback.rate,
          updatedBy: room.playback.updatedBy,
        },
        version: room.version,
      },
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

// Robust Background Worker: Guaranteed at-least-once delivery to DB
setInterval(async () => {
  if (!supabase) return;

  const redisClient = getRedisClient();
  let queue: string[] = [];

  if (redisClient) {
    // Fetch all pending syncs older than 5 seconds to provide debouncing,
    // or those that have been stuck for a while.
    const cutoff = Date.now() - 5000;
    // zrangebyscore fetches the room IDs
    queue = await redisClient
      .zrangebyscore("pending_db_syncs", "-inf", cutoff)
      .catch(() => []);
  } else {
    if (writeBehindQueue.size === 0) return;
    queue = Array.from(writeBehindQueue);
    writeBehindQueue.clear();
  }

  for (const roomId of queue) {
    let room;
    const roomStr = await getRedisRoom(roomId);
    if (roomStr) room = roomStr;

    if (!room) {
      // If room no longer exists in cache, assume we don't need to sync its active state anymore.
      if (redisClient)
        await redisClient.zrem("pending_db_syncs", roomId).catch(() => {});
      continue;
    }

    try {
      await forcePersistRoom(room);
      // ONLY remove from pending syncs if forcePersistRoom succeeds.
      // If it fails, it remains in the ZSET and will be retried next tick.
      if (redisClient) {
        await redisClient.zrem("pending_db_syncs", roomId).catch(() => {});
      }
    } catch (err) {
      // Re-queue on transient failure for local mode
      // Redis mode implicitly keeps it in the ZSET because we haven't ZREM'd it yet
      // However, we update its score to push it back in the line
      if (redisClient) {
        await redisClient
          .zadd("pending_db_syncs", Date.now(), roomId)
          .catch(() => {});
      } else {
        writeBehindQueue.add(roomId);
      }
    }
  }
}, 10000); // Check every 10 seconds

// Graceful Shutdown Sequence
let isShuttingDown = false;
async function gracefulShutdown() {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log("Shutting down... flushing write-behind queue...");

  const redisClient = getRedisClient();
  let queue: string[] = [];

  if (redisClient) {
    // Flush EVERYTHING in the queue immediately during shutdown
    queue = await redisClient
      .zrangebyscore("pending_db_syncs", "-inf", "+inf")
      .catch(() => []);
  } else {
    queue = Array.from(writeBehindQueue);
  }

  for (const roomId of queue) {
    let room;
    const roomStr = await getRedisRoom(roomId);
    if (roomStr) room = roomStr;

    if (room) {
      await forcePersistRoom(room).catch(() => {});
      if (redisClient)
        await redisClient.zrem("pending_db_syncs", roomId).catch(() => {});
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
            // If we have local clients connected to this room, emit
            // Using io.sockets.adapter.rooms.has is an efficient way to check local presence
            if (io.sockets.adapter.rooms.has(roomId)) {
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

    // Queue processor listener
    sClient.psubscribe("queue_wakeup:*");
    sClient.on(
      "pmessage",
      (pattern: string, channel: string, message: string) => {
        if (!channel.startsWith("queue_wakeup:")) return;
        const roomId = channel.split(":")[1];
        if (!roomId) return;

        // Fire and forget processor trigger.
        // The worker uses withLock internally, so multiple triggers won't race or corrupt memory.
        processQueueForRoom(roomId).catch((e) =>
          console.error("Worker error for", roomId, e),
        );
      },
    );
  }

  // Disconnected/Inactive rooms are automatically garbage collected by Redis TTL (EXPIRE).

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

      let occRetries = 10;
      let finalRoomState = null;

      while (occRetries > 0) {
        let room: RoomState | null = await getRedisRoom(roomId);

        if (!room) {
          room = await loadRoomFromDB(roomId);
          if (!room) {
            room = createEmptyRoom(roomId, `Room ${roomId}`);
          }
        }

        const baseVersion = room.version;
        room.lastActivity = Date.now();

        const pId = socket.data.participantId;
        const isFirst = Object.keys(room.participants).length === 0;

        const existingParticipant = room.participants[pId];
        if (existingParticipant) {
          existingParticipant.lastSeen = Date.now();
          existingParticipant.nickname =
            nickname || existingParticipant.nickname;
        } else {
          room.participants[pId] = {
            id: pId,
            nickname: nickname || `Guest ${Math.floor(Math.random() * 1000)}`,
            role: isFirst ? "owner" : "guest",
            lastSeen: Date.now(),
          };
        }

        room.version++;

        const success = await setRedisRoomCAS(roomId, room, baseVersion);
        if (success) {
          finalRoomState = room;
          break;
        }

        // OCC backoff
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
      currentRoomId = roomId;
      currentParticipantId = pId;

      socket.emit("room_state", {
        room: sanitizeRoom(finalRoomState),
        serverTime: Date.now(),
      });

      const joinedInfo = { ...finalRoomState.participants[pId] };
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

          // We must explicitly reject "guest_" accounts from sending mutations.
          // They are allowed to connect to receive state, but cannot mutate state.
          // NOTE: "upgrade_session" is the ONLY exception allowed for guests.
          if (
            currentParticipantId.startsWith("guest_") &&
            type !== "upgrade_session"
          ) {
            socket.emit("error", {
              message:
                "Unauthorized command. Guest accounts cannot send commands.",
            });
            return;
          }

          let room = await getRedisRoom(roomId);
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

          // [PHASE 1] IF FAST-PATH MUTATION, ROUTE TO LUA IMMEDIATELY
          const isFastPath = [
            "play",
            "pause",
            "seek",
            "update_rate",
            "buffering",
          ].includes(type);
          if (isFastPath) {
            const result = await executeFastMutation(
              roomId,
              baseVersion,
              type,
              payload,
              currentParticipantId,
              participant.nickname,
            );

            if (result.success && result.state) {
              const sanitizeFastRoom = sanitizeRoom(result.state);
              io.to(roomId).emit("room_state", {
                room: sanitizeFastRoom,
                serverTime: Date.now(),
              });
              // We successfully pushed to Redis. Now trigger DB sync asynchronously.
              persistRoomState(result.state);

              // We also publish the event to keep multi-node setups consistent if multiple socket IO servers exist
              await publishRoomEvent(roomId, {
                type: "state_update",
                payload: sanitizeFastRoom,
              });

              break; // EXIT WHILE LOOP (Success)
            } else if (result.error === "VERSION_CONFLICT") {
              // OCC failed inside Lua -> Backoff and retry
              await new Promise((r) => setTimeout(r, 10 + Math.random() * 20));
              occRetries--;
              continue;
            } else if (result.error === "UNAUTHORIZED") {
              socket.emit("error", { message: "Unauthorized operation." });
              break;
            } else if (result.error === "NO_CHANGE") {
              break; // Silent pass
            } else {
              // Fallback / REDIS_REQUIRED -> Let normal memory CAS loop handle it
            }
          }

          if (type === "upgrade_session") {
            try {
              if (typeof payload.token !== "string")
                throw new Error("Missing token");
              const { payload: jwtPayload } = await jwtVerify(
                payload.token,
                JWT_SECRET,
              );
              if (jwtPayload.participantId) {
                const newPid = jwtPayload.participantId as string;

                // Transfer role or create new entry
                const oldParticipant = room.participants[currentParticipantId];
                const isFirst =
                  Object.keys(room.participants).length === 1 && oldParticipant; // Only guest was here

                room.participants[newPid] = {
                  id: newPid,
                  nickname:
                    (jwtPayload.nickname as string) ||
                    oldParticipant?.nickname ||
                    `User`,
                  role: isFirst ? "owner" : "guest",
                  lastSeen: Date.now(),
                };

                if (oldParticipant) {
                  // Carry over owner role just in case they were the room creator but unauthenticated
                  if (oldParticipant.role === "owner")
                    room.participants[newPid].role = "owner";
                  delete room.participants[currentParticipantId];
                }

                socket.data.participantId = newPid;
                currentParticipantId = newPid;
                stateChanged = true;

                socket.emit("session_upgraded", { participantId: newPid });
              }
            } catch (e) {
              socket.emit("error", {
                message: "Invalid session upgrade token",
              });
            }
            // Skip queueing this command
            if (stateChanged) {
              const success = await setRedisRoomCAS(roomId, room, baseVersion);
              if (success) {
                finalRoomState = room;
                break;
              }
              await new Promise((r) => setTimeout(r, 10 + Math.random() * 20));
              occRetries--;
              continue;
            } else {
              break;
            }
          }

          // [PHASE 1] SLOW-PATH REDIS QUEUE
          // For all other commands, we enqueue them instead of computing them here.
          // This allows the slow path (e.g., adding 500 items) to process sequentially without OCC.
          const pushed = await pushSlowCommand(
            roomId,
            sequence,
            type,
            payload,
            currentParticipantId,
            participant.nickname,
          );

          if (!pushed) {
            socket.emit("error", { message: "Failed to queue command" });
          }

          break; // Stop spinning OCC loops for slow commands
        }

        if (stateChanged && !finalRoomState) {
          socket.emit("error", {
            message: "System busy acquiring room lock. Try again.",
          });
          return;
        }

        if (finalRoomState) {
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
        // Since we are stateless, we can't synchronously flag lastSeen without an OCC write.
        // Instead of writing to DB just for a transient disconnected state, we'll run the timeout
        // and if they haven't re-joined (which would update lastSeen), we remove them.
        setTimeout(async () => {
          let retries = 5;
          while (retries > 0) {
            const r = await getRedisRoom(currentRoomId!);
            if (!r) break;

            const participant = r.participants[currentParticipantId!];
            if (participant) {
              // Wait, if they reconnected, their lastSeen would be very recent, or socket.data.participantId might differ
              // Actually, since this is a stateless architecture, we check if their lastSeen is old
              if (Date.now() - participant.lastSeen > 10000) {
                delete r.participants[currentParticipantId!];
                r.version++;

                const remaining = Object.values(r.participants);
                if (remaining.length === 0) {
                  persistRoomState(r);
                } else {
                  if (!remaining.some((p: any) => p.role === "owner")) {
                    (remaining[0] as any).role = "owner";
                  }
                }

                const success = await setRedisRoomCAS(
                  currentRoomId!,
                  r,
                  r.version - 1,
                );
                if (success) {
                  io.to(currentRoomId!).emit("participant_left", {
                    participantId: currentParticipantId,
                  });
                  if (
                    remaining.length > 0 &&
                    !remaining.some((p: any) => p.role === "owner")
                  ) {
                    // Though we just set it above, emit full state if owner changed
                    io.to(currentRoomId!).emit("room_state", {
                      room: sanitizeRoom(r),
                      serverTime: Date.now(),
                    });
                  }

                  // Broadcast state update to other nodes
                  const pClient = pubClient();
                  if (pClient) {
                    await publishRoomEvent(currentRoomId!, {
                      type: "state_update",
                      roomId: currentRoomId,
                      payload: r,
                    });
                  }
                  break;
                }
                // Retry if OCC failed
                await new Promise((resolve) =>
                  setTimeout(resolve, 30 + Math.random() * 50),
                );
                retries--;
              } else {
                break; // They reconnected and updated lastSeen, don't remove
              }
            } else {
              break; // Already removed
            }
          }
        }, 15000);
      }
    });
  });

  const port = process.env.PORT || 3000;
  server.listen(port, () => {
    console.log(`> Ready on http://localhost:${port}`);
  });
});
