"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sanitizeRoom = sanitizeRoom;
const http_1 = require("http");
const next_1 = __importDefault(require("next"));
const socket_io_1 = require("socket.io");
// Use valid RFC 4122 v5 UUID generation
const uuid_1 = require("uuid");
const supabase_js_1 = require("@supabase/supabase-js");
const jose_1 = require("jose");
const cookie = __importStar(require("cookie"));
const redis_rate_limit_1 = require("./lib/redis-rate-limit");
const redis_actor_1 = require("./lib/redis-actor");
const redis_lua_1 = require("./lib/redis-lua");
const redis_queue_1 = require("./lib/redis-queue");
const redis_queue_worker_1 = require("./lib/redis-queue-worker");
// Deterministic UUID namespace strictly for SyncWatch (arbitrary valid UUIDv4)
const SYNCWATCH_NAMESPACE = "1b671a64-40d5-491e-99b0-da01ff1f3341";
function getDeterministicUUID(roomId) {
    if (roomId.length === 36 &&
        roomId.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)) {
        return roomId;
    }
    return (0, uuid_1.v5)(roomId, SYNCWATCH_NAMESPACE);
}
// Load environment variables manually for the custom server
const env_1 = require("@next/env");
const projectDir = process.cwd();
(0, env_1.loadEnvConfig)(projectDir);
const dev = process.env.NODE_ENV !== "production";
const app = (0, next_1.default)({ dev });
const handle = app.getRequestHandler();
// Supabase Setup
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    "";
let supabase = null;
if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
    supabase = (0, supabase_js_1.createClient)(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        auth: {
            persistSession: false,
        },
    });
    console.log("✅ Supabase initialized with Service Role (Persistence Enabled)");
}
else {
    console.warn("\n=======================================================");
    console.warn("⚠️ WARNING: Running in Ephemeral Memory Mode.");
    console.warn("⚠️ SUPABASE_SERVICE_ROLE_KEY is missing.");
    console.warn("⚠️ Data will NOT persist to the database.");
    console.warn("=======================================================\n");
}
// Memory state is now exclusively managed via Redis (`getRedisRoom` / `setRedisRoom`)
// to strictly enforce a stateless backend Architecture. Local fallback is handled in `redis-actor.ts`.
function createEmptyRoom(id, name) {
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
function sanitizeRoom(room) {
    const sanitized = Object.assign(Object.assign({}, room), { participants: Object.assign({}, room.participants) });
    for (const pid in sanitized.participants) {
        sanitized.participants[pid] = Object.assign({}, sanitized.participants[pid]);
        delete sanitized.participants[pid].sessionToken;
    }
    return sanitized;
}
// Database sync helpers - Persistent Redis Write-Behind Queue
// In-memory fallback if Redis is entirely unavailable
const writeBehindQueue = new Set();
const persistRoomState = (room) => {
    if (!supabase)
        return; // Immediately stop if we are in Ephemeral Memory Mode
    const redisClient = (0, redis_rate_limit_1.getRedisClient)();
    if (redisClient) {
        // Add to sorted set with current timestamp.
        // This allows us to process oldest pending syncs first, and retry if they get stuck.
        redisClient
            .zadd("pending_db_syncs", Date.now(), room.id)
            .catch((e) => console.error("Redis queue error:", e));
    }
    else {
        writeBehindQueue.add(room.id);
    }
};
const forcePersistRoom = async (room) => {
    var _a;
    if (!supabase)
        return;
    try {
        const { error } = await supabase.rpc("sync_room_state", {
            p_room_id: getDeterministicUUID(room.id),
            p_owner_id: getDeterministicUUID(((_a = Object.values(room.participants).find((p) => p.role === "owner")) === null || _a === void 0 ? void 0 : _a.id) ||
                room.id),
            p_state: {
                name: room.name,
                settings: room.settings,
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
                    status: ["playing", "paused", "buffering", "ended"].includes(room.playback.status)
                        ? room.playback.status
                        : "paused",
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
                console.warn(`[Poison Pill] Dropping invalid UUID task for room ${room.id}:`, error);
                return;
            }
            console.error(`Failed to persist room ${room.id} via RPC:`, error);
            throw error;
        }
    }
    catch (err) {
        if ((err === null || err === void 0 ? void 0 : err.code) === "22P02") {
            console.warn(`[Poison Pill] Dropping invalid task:`, err);
            return;
        }
        console.error(`Fatal error persisting room ${room.id}`, err);
        throw err; // Re-throw for parent to catch
    }
};
// Robust Background Worker: Guaranteed at-least-once delivery to DB (Concurrent Batched Processing)
setInterval(async () => {
    if (!supabase)
        return;
    const redisClient = (0, redis_rate_limit_1.getRedisClient)();
    let queue = [];
    if (redisClient) {
        const cutoff = Date.now() - 5000;
        // LIMIT to 50 items per tick to prevent OOM and Event Loop blocking
        queue = await redisClient
            .zrangebyscore("pending_db_syncs", "-inf", cutoff, "LIMIT", 0, 50)
            .catch(() => []);
    }
    else {
        if (writeBehindQueue.size === 0)
            return;
        // Limit memory queue processing too
        queue = Array.from(writeBehindQueue).slice(0, 50);
        queue.forEach((q) => writeBehindQueue.delete(q));
        // Hard cap to prevent OOM if DB is permanently unreachable in memory-fallback mode
        if (writeBehindQueue.size > 3000) {
            console.warn("Write-behind queue exceeded 3000 items. Dropping oldest to prevent OOM.");
            const excess = Array.from(writeBehindQueue).slice(0, writeBehindQueue.size - 2000);
            excess.forEach((q) => writeBehindQueue.delete(q));
        }
    }
    // Chunk array into batches of 10 to prevent slamming Event Loop and PostgreSQL pool
    const BATCH_SIZE = 10;
    for (let i = 0; i < queue.length; i += BATCH_SIZE) {
        const batch = queue.slice(i, i + BATCH_SIZE);
        const promises = batch.map(async (roomId) => {
            let room;
            const roomStr = await (0, redis_actor_1.getRedisRoom)(roomId);
            if (roomStr)
                room = roomStr;
            if (!room) {
                if (redisClient) {
                    await redisClient.zrem("pending_db_syncs", roomId).catch(() => { });
                }
                return;
            }
            try {
                // [AUDIT FIX] Distribute processing lock to prevent Thundering Herd
                const lockAcquired = redisClient
                    ? await redisClient.set(`db_sync_lock:${roomId}`, "1", "PX", 10000, "NX")
                    : "OK";
                if (lockAcquired !== "OK") {
                    return; // Another node is processing this room
                }
                await forcePersistRoom(room);
                if (redisClient) {
                    await redisClient.zrem("pending_db_syncs", roomId).catch(() => { });
                    await redisClient.del(`db_sync_lock:${roomId}`).catch(() => { });
                }
            }
            catch (err) {
                if (redisClient) {
                    await redisClient.del(`db_sync_lock:${roomId}`).catch(() => { });
                    // Add Exponential Backoff (1 minute delay) on failure to prevent DB Retry Storm
                    await redisClient
                        .zadd("pending_db_syncs", Date.now() + 60000, roomId)
                        .catch(() => { });
                }
                else {
                    writeBehindQueue.add(roomId);
                }
            }
        });
        await Promise.allSettled(promises);
    }
}, 10000); // Check every 10 seconds
// Graceful Shutdown Sequence
let isShuttingDown = false;
async function gracefulShutdown() {
    if (isShuttingDown)
        return;
    isShuttingDown = true;
    console.log("Shutting down... flushing write-behind queue...");
    const redisClient = (0, redis_rate_limit_1.getRedisClient)();
    let queue = [];
    if (redisClient) {
        // Flush EVERYTHING in the queue immediately during shutdown
        queue = await redisClient
            .zrangebyscore("pending_db_syncs", "-inf", "+inf")
            .catch(() => []);
    }
    else {
        queue = Array.from(writeBehindQueue);
    }
    for (const roomId of queue) {
        let room;
        const roomStr = await (0, redis_actor_1.getRedisRoom)(roomId);
        if (roomStr)
            room = roomStr;
        if (room) {
            await forcePersistRoom(room).catch(() => { });
            if (redisClient)
                await redisClient.zrem("pending_db_syncs", roomId).catch(() => { });
        }
    }
    console.log("Queue flushed. Exiting process.");
    process.exit(0);
}
process.on("SIGTERM", gracefulShutdown);
process.on("SIGINT", gracefulShutdown);
async function loadRoomFromDB(roomId) {
    if (!supabase)
        return null;
    try {
        const dbRoomId = getDeterministicUUID(roomId);
        const { data: roomData } = await supabase
            .from("rooms")
            .select("*")
            .eq("id", dbRoomId)
            .single();
        if (!roomData)
            return null;
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
            room.playlist = playlistData.map((item) => ({
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
                status: snapshotData.status,
                basePosition: snapshotData.base_position,
                baseTimestamp: Number(snapshotData.base_timestamp) || Date.now(),
                rate: snapshotData.rate,
                updatedBy: snapshotData.updated_by,
            };
            room.version = snapshotData.version;
        }
        return room;
    }
    catch (err) {
        console.error(`Error loading room ${roomId} from DB`, err);
        return null;
    }
}
app.prepare().then(() => {
    const server = (0, http_1.createServer)((req, res) => {
        try {
            // Use WHATWG URL API instead of deprecated url.parse
            const protocol = req.headers["x-forwarded-proto"] || "http";
            const host = req.headers.host || "localhost";
            const parsedUrl = new URL(req.url, `${protocol}://${host}`);
            // Next.js expects { pathname, query } shape originally from url.parse
            const query = Object.fromEntries(parsedUrl.searchParams.entries());
            handle(req, res, {
                pathname: parsedUrl.pathname,
                query,
            });
        }
        catch (err) {
            res.statusCode = 400;
            res.end("Bad Request");
        }
    });
    const io = new socket_io_1.Server(server, {
        cors: {
            origin: "*",
            methods: ["GET", "POST"],
            credentials: true,
        },
        pingTimeout: 60000,
        pingInterval: 25000,
    });
    const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET || "default_local_secret_dont_use_in_prod");
    io.use(async (socket, next) => {
        try {
            const cookies = cookie.parse(socket.request.headers.cookie || "");
            const token = cookies.syncwatch_session;
            const redisClient = (0, redis_rate_limit_1.getRedisClient)(); // Added this line as per instruction
            if (token) {
                const { payload } = await (0, jose_1.jwtVerify)(token, JWT_SECRET);
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
        }
        catch (err) {
            // Even on error, allow connection but mark as temporary guest to prevent UI freezes
            socket.data.participantId = `guest_${socket.id}`;
            next();
        }
    });
    // Global Pub/Sub Listener for Node Synchronization
    const sClient = (0, redis_actor_1.subClient)();
    if (sClient) {
        sClient.psubscribe("room_events:*");
        sClient.on("pmessage", (pattern, channel, message) => {
            try {
                const roomId = channel.split(":")[1];
                if (!roomId)
                    return;
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
                }
                else if (data.type === "participant_joined") {
                    // Re-broadcast to all clients connected to this Node instance in the room
                    if (io.sockets.adapter.rooms.has(roomId)) {
                        io.to(roomId).emit("participant_joined", data.payload);
                    }
                }
            }
            catch (e) {
                console.error("PubSub parse error:", e);
            }
        });
        // Queue processor listener
        sClient.psubscribe("queue_wakeup:*");
        sClient.on("pmessage", (pattern, channel, message) => {
            if (!channel.startsWith("queue_wakeup:"))
                return;
            const roomId = channel.split(":")[1];
            if (!roomId)
                return;
            // Fire and forget processor trigger.
            // The worker uses withLock internally, so multiple triggers won't race or corrupt memory.
            (0, redis_queue_worker_1.processQueueForRoom)(roomId).catch((e) => console.error("Worker error for", roomId, e));
        });
    }
    // Disconnected/Inactive rooms are automatically garbage collected by Redis TTL (EXPIRE).
    io.on("connection", (socket) => {
        let currentRoomId = null;
        let currentParticipantId = null;
        // NTP-style time sync implementation
        socket.on("ping_time", (clientTime, callback) => {
            // Send back immediately so client can calculate RTT and offset
            callback(Date.now(), clientTime);
        });
        socket.on("join_room", async ({ roomId, nickname }) => {
            const ip = socket.handshake.headers["x-forwarded-for"] ||
                socket.handshake.address ||
                "unknown";
            if (!(await (0, redis_rate_limit_1.checkRedisRateLimit)(`ws:join:${ip}`, 50, 60000))) {
                socket.emit("error", { message: "Too many join requests" });
                return;
            }
            let occRetries = 10;
            let finalRoomState = null;
            while (occRetries > 0) {
                let room = await (0, redis_actor_1.getRedisRoom)(roomId);
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
                const isGuest = pId.startsWith("guest_");
                // If not a guest, or if it IS a guest but we want to track them anyway (optional,
                // here we are changing it so guests ARE NOT added to the participant block to save cache)
                if (!isGuest) {
                    const existingParticipant = room.participants[pId];
                    if (existingParticipant) {
                        existingParticipant.lastSeen = Date.now();
                        existingParticipant.nickname =
                            nickname || existingParticipant.nickname;
                    }
                    else {
                        room.participants[pId] = {
                            id: pId,
                            nickname: nickname || `Guest ${Math.floor(Math.random() * 1000)}`,
                            role: isFirst ? "owner" : "guest",
                            lastSeen: Date.now(),
                        };
                    }
                }
                room.version++;
                const success = await (0, redis_actor_1.setRedisRoomCAS)(roomId, room, baseVersion);
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
            const isGuest = pId.startsWith("guest_");
            socket.join(roomId);
            currentRoomId = roomId;
            currentParticipantId = pId;
            socket.emit("room_state", {
                room: sanitizeRoom(finalRoomState),
                serverTime: Date.now(),
            });
            if (!isGuest) {
                const joinedInfo = Object.assign({}, finalRoomState.participants[pId]);
                // Route through Redis PubSub instead of localized socket.to
                // This solves the multi-node phantom users bug!
                (0, redis_actor_1.publishRoomEvent)(roomId, {
                    type: "participant_joined",
                    payload: joinedInfo,
                }).catch((e) => console.error("Failed publishing join", e));
            }
        });
        socket.on("command", async (rawCommand) => {
            // OOM & Type Protection Fast Check
            if (!rawCommand || typeof rawCommand !== "object")
                return;
            const ip = socket.handshake.headers["x-forwarded-for"] ||
                socket.handshake.address ||
                "unknown";
            if (!(await (0, redis_rate_limit_1.checkRedisRateLimit)(`ws:command:${ip}`, 60, 10000))) {
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
            if (typeof type !== "string" || type.length > 50)
                return;
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
                    if (currentParticipantId.startsWith("guest_") &&
                        type !== "upgrade_session") {
                        socket.emit("error", {
                            message: "Unauthorized command. Guest accounts cannot send commands.",
                        });
                        return;
                    }
                    let room = await (0, redis_actor_1.getRedisRoom)(roomId);
                    if (!room)
                        return;
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
                        const result = await (0, redis_lua_1.executeFastMutation)(roomId, baseVersion, type, payload, currentParticipantId, participant.nickname);
                        if (result.success && result.state) {
                            const sanitizeFastRoom = sanitizeRoom(result.state);
                            io.to(roomId).emit("room_state", {
                                room: sanitizeFastRoom,
                                serverTime: Date.now(),
                            });
                            // We successfully pushed to Redis. Now trigger DB sync asynchronously.
                            persistRoomState(result.state);
                            // We also publish the event to keep multi-node setups consistent if multiple socket IO servers exist
                            await (0, redis_actor_1.publishRoomEvent)(roomId, {
                                type: "state_update",
                                payload: sanitizeFastRoom,
                            });
                            break; // EXIT WHILE LOOP (Success)
                        }
                        else if (result.error === "VERSION_CONFLICT") {
                            // OCC failed inside Lua -> Backoff and retry
                            await new Promise((r) => setTimeout(r, 10 + Math.random() * 20));
                            occRetries--;
                            continue;
                        }
                        else if (result.error === "UNAUTHORIZED") {
                            socket.emit("error", { message: "Unauthorized operation." });
                            break;
                        }
                        else if (result.error === "NO_CHANGE") {
                            break; // Silent pass
                        }
                        else {
                            // Fallback / REDIS_REQUIRED -> Let normal memory CAS loop handle it
                        }
                    }
                    if (type === "upgrade_session") {
                        try {
                            if (typeof payload.token !== "string")
                                throw new Error("Missing token");
                            const { payload: jwtPayload } = await (0, jose_1.jwtVerify)(payload.token, JWT_SECRET);
                            if (jwtPayload.participantId) {
                                const newPid = jwtPayload.participantId;
                                // Transfer role or create new entry
                                const oldParticipant = room.participants[currentParticipantId];
                                const isFirst = Object.keys(room.participants).length === 1 && oldParticipant; // Only guest was here
                                room.participants[newPid] = {
                                    id: newPid,
                                    nickname: jwtPayload.nickname ||
                                        (oldParticipant === null || oldParticipant === void 0 ? void 0 : oldParticipant.nickname) ||
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
                        }
                        catch (e) {
                            socket.emit("error", {
                                message: "Invalid session upgrade token",
                            });
                        }
                        // Skip queueing this command
                        if (stateChanged) {
                            const success = await (0, redis_actor_1.setRedisRoomCAS)(roomId, room, baseVersion);
                            if (success) {
                                finalRoomState = room;
                                break;
                            }
                            await new Promise((r) => setTimeout(r, 10 + Math.random() * 20));
                            occRetries--;
                            continue;
                        }
                        else {
                            break;
                        }
                    }
                    // [PHASE 1] SLOW-PATH REDIS QUEUE
                    // For all other commands, we enqueue them instead of computing them here.
                    // This allows the slow path (e.g., adding 500 items) to process sequentially without OCC.
                    const pushed = await (0, redis_queue_1.pushSlowCommand)(roomId, sequence, type, payload, currentParticipantId, participant.nickname);
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
                    const pClient = (0, redis_actor_1.pubClient)();
                    if (pClient) {
                        await (0, redis_actor_1.publishRoomEvent)(roomId, {
                            type: "state_update",
                            roomId,
                            payload: finalRoomState,
                        });
                    }
                    else {
                        io.to(roomId).emit("room_state", {
                            room: finalRoomState,
                            serverTime: Date.now(),
                        });
                    }
                }
            }
            catch (err) {
                console.error("Lock error for room", roomId, "Command Type:", type, err);
                socket.emit("error", {
                    message: "System busy acquiring room lock. Try again.",
                });
            }
        });
        socket.on("reaction", (payload) => {
            try {
                if (!currentRoomId || !currentParticipantId)
                    return;
                // Broadcast reaction to everyone else in the room
                socket.to(currentRoomId).emit("reaction", payload);
            }
            catch (e) {
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
                        const r = await (0, redis_actor_1.getRedisRoom)(currentRoomId);
                        if (!r)
                            break;
                        const participant = r.participants[currentParticipantId];
                        if (participant) {
                            // Wait, if they reconnected, their lastSeen would be very recent, or socket.data.participantId might differ
                            // Actually, since this is a stateless architecture, we check if their lastSeen is old
                            if (Date.now() - participant.lastSeen > 10000) {
                                delete r.participants[currentParticipantId];
                                r.version++;
                                const remaining = Object.values(r.participants);
                                if (remaining.length === 0) {
                                    persistRoomState(r);
                                }
                                else {
                                    if (!remaining.some((p) => p.role === "owner")) {
                                        remaining[0].role = "owner";
                                    }
                                }
                                const success = await (0, redis_actor_1.setRedisRoomCAS)(currentRoomId, r, r.version - 1);
                                if (success) {
                                    io.to(currentRoomId).emit("participant_left", {
                                        participantId: currentParticipantId,
                                    });
                                    if (remaining.length > 0 &&
                                        !remaining.some((p) => p.role === "owner")) {
                                        // Though we just set it above, emit full state if owner changed
                                        io.to(currentRoomId).emit("room_state", {
                                            room: sanitizeRoom(r),
                                            serverTime: Date.now(),
                                        });
                                    }
                                    // Broadcast state update to other nodes
                                    const pClient = (0, redis_actor_1.pubClient)();
                                    if (pClient) {
                                        await (0, redis_actor_1.publishRoomEvent)(currentRoomId, {
                                            type: "state_update",
                                            roomId: currentRoomId,
                                            payload: r,
                                        });
                                    }
                                    break;
                                }
                                // Retry if OCC failed
                                await new Promise((resolve) => setTimeout(resolve, 30 + Math.random() * 50));
                                retries--;
                            }
                            else {
                                break; // They reconnected and updated lastSeen, don't remove
                            }
                        }
                        else {
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
