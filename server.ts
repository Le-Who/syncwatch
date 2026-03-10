import { createServer } from "http";
import next from "next";
import { Server as SocketIOServer } from "socket.io";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { registerRoomHandlers } from "./lib/room-handler";
import { startDbSyncWorker, flushDbSyncQueue } from "./lib/db-sync";
import { setupSocketAuth } from "./lib/socket/setup";
import { setupPubSubListeners } from "./lib/socket/pubsub";

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

  const isProduction = process.env.NODE_ENV === "production";
  const corsOrigin =
    isProduction && process.env.APP_URL
      ? `https://${process.env.APP_URL}`
      : "*";

  const io = new SocketIOServer(server, {
    cors: {
      origin: corsOrigin,
      methods: ["GET", "POST"],
      credentials: true,
    },
    pingTimeout: 60000,
    pingInterval: 25000,
  });

  setupSocketAuth(io);
  setupPubSubListeners(io);

  io.on("connection", (socket) => {
    registerRoomHandlers(io, socket, supabase);
  });

  const port = process.env.PORT || 3000;
  server.listen(port, () => {
    console.log(`> Ready on http://localhost:${port}`);
  });
});
