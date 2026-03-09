import { createServer, Server as NetServer } from "http";
import next from "next";
import { Server as SocketIOServer } from "socket.io";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { jwtVerify } from "jose";
import * as cookie from "cookie";
import { getRedisClient } from "./lib/redis-rate-limit";
import { subClient } from "./lib/redis-actor";
import { processQueueForRoom } from "./lib/redis-queue-worker";
import { sanitizeRoom, registerRoomHandlers } from "./lib/room-handler";
import { startDbSyncWorker, flushDbSyncQueue } from "./lib/db-sync";

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

// Types extracted to lib/types.ts and lib/room-handler.ts

// Start Background DB Worker
const workerInterval = startDbSyncWorker(supabase);

// Graceful Shutdown Sequence
let isShuttingDown = false;
async function gracefulShutdown() {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log("Shutting down... flushing write-behind queue...");

  if (workerInterval) clearInterval(workerInterval);
  await flushDbSyncQueue(supabase);

  console.log("Queue flushed. Exiting process.");
  process.exit(0);
}

process.on("SIGTERM", gracefulShutdown);
process.on("SIGINT", gracefulShutdown);

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
      const token = cookies.syncwatch_session || socket.handshake.auth?.token;

      const redisClient = getRedisClient();

      if (token) {
        try {
          const { payload } = await jwtVerify(token, JWT_SECRET);
          if (payload.participantId) {
            socket.data.participantId = payload.participantId;
            return next();
          }
        } catch (jwtErr) {
          console.error(
            "JWT VERIFY FAILED in io.use! Token:",
            token,
            "Error:",
            jwtErr,
          );
        }
      } else {
        console.warn(
          "NO TOKEN PROVIDED! Fallback to guest. cookies:",
          cookies,
          "auth:",
          socket.handshake.auth,
        );
      }

      socket.data.participantId = `guest_${socket.id}`;
      next();
    } catch (err) {
      console.error("UNKNOWN ERROR IN IO.USE FAILED!", err);
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
              // SECURITY FIX: Must sanitize data from PubSub before broadcasting to clients
              io.to(roomId).emit("room_state", {
                room: sanitizeRoom(data.payload),
                serverTime: Date.now(),
              });
            }
          } else if (data.type === "participant_joined") {
            // Re-broadcast to all clients connected to this Node instance in the room
            if (io.sockets.adapter.rooms.has(roomId)) {
              io.to(roomId).emit("participant_joined", data.payload);
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
    registerRoomHandlers(io, socket, supabase);
  });

  const port = process.env.PORT || 3000;
  server.listen(port, () => {
    console.log(`> Ready on http://localhost:${port}`);
  });
});
