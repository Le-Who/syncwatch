"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const http_1 = require("http");
const next_1 = __importDefault(require("next"));
const socket_io_1 = require("socket.io");
const crypto_1 = require("crypto");
const supabase_js_1 = require("@supabase/supabase-js");
// Load environment variables manually for the custom server
const env_1 = require("@next/env");
const projectDir = process.cwd();
(0, env_1.loadEnvConfig)(projectDir);
const dev = process.env.NODE_ENV !== "production";
const app = (0, next_1.default)({ dev });
const handle = app.getRequestHandler();
// Supabase Setup
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "";
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    "";
const supabase = supabaseUrl && supabaseKey ? (0, supabase_js_1.createClient)(supabaseUrl, supabaseKey) : null;
if (!supabase) {
    console.warn("⚠️ Supabase credentials missing (NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY). Running in memory-only mode.");
}
// In-memory state
const rooms = new Map();
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
// Database sync helpers
// Debounce persistence globally per room to prevent database spam
const persistenceTimers = new Map();
async function persistRoomState(room) {
    if (!supabase)
        return;
    // Clear any existing timer to debounce
    const existingTimer = persistenceTimers.get(room.id);
    if (existingTimer) {
        clearTimeout(existingTimer);
    }
    // Schedule new persistence
    const timer = setTimeout(async () => {
        var _a;
        try {
            // Upsert Room
            await supabase.from("rooms").upsert({
                id: room.id,
                name: room.name,
                settings: room.settings,
                owner_id: ((_a = Object.values(room.participants).find((p) => p.role === "owner")) === null || _a === void 0 ? void 0 : _a.id) || room.id,
            });
            // Sync playlist
            const { data: existingItems } = await supabase
                .from("playlist_items")
                .select("id")
                .eq("room_id", room.id);
            const existingIds = (existingItems === null || existingItems === void 0 ? void 0 : existingItems.map((i) => i.id)) || [];
            const currentIds = room.playlist.map((i) => i.id);
            const toDelete = existingIds.filter((id) => !currentIds.includes(id));
            if (toDelete.length > 0) {
                await supabase.from("playlist_items").delete().in("id", toDelete);
            }
            if (room.playlist.length > 0) {
                const itemsToUpsert = room.playlist.map((item, index) => ({
                    id: item.id,
                    room_id: room.id,
                    url: item.url,
                    provider: item.provider,
                    title: item.title,
                    duration: item.duration,
                    added_by: item.addedBy,
                    position: index,
                }));
                await supabase.from("playlist_items").upsert(itemsToUpsert);
            }
            // Sync playback snapshot
            await supabase.from("playback_snapshots").upsert({
                room_id: room.id,
                media_item_id: room.currentMediaId,
                status: room.playback.status,
                base_position: room.playback.basePosition,
                base_timestamp: room.playback.baseTimestamp,
                rate: room.playback.rate,
                version: room.version,
                updated_by: room.playback.updatedBy,
                updated_at: new Date().toISOString(),
            });
        }
        catch (err) {
            console.error(`Failed to persist room ${room.id}`, err);
        }
        finally {
            persistenceTimers.delete(room.id);
        }
    }, 2000); // Debounce by 2 seconds
    persistenceTimers.set(room.id, timer);
}
async function loadRoomFromDB(roomId) {
    if (!supabase)
        return null;
    try {
        const { data: roomData } = await supabase
            .from("rooms")
            .select("*")
            .eq("id", roomId)
            .single();
        if (!roomData)
            return null;
        const { data: playlistData } = await supabase
            .from("playlist_items")
            .select("*")
            .eq("room_id", roomId)
            .order("position");
        const { data: snapshotData } = await supabase
            .from("playback_snapshots")
            .select("*")
            .eq("room_id", roomId)
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
        },
        pingInterval: 10000,
        pingTimeout: 5000,
    });
    io.on("connection", (socket) => {
        let currentRoomId = null;
        let currentParticipantId = null;
        // NTP-style time sync implementation
        socket.on("ping_time", (clientTime, callback) => {
            // Send back immediately so client can calculate RTT and offset
            callback(Date.now(), clientTime);
        });
        socket.on("join_room", async ({ roomId, nickname, participantId }) => {
            let room = rooms.get(roomId);
            if (!room) {
                // Try to load from DB first
                room = await loadRoomFromDB(roomId);
                if (!room) {
                    room = createEmptyRoom(roomId, `Room ${roomId}`);
                }
                rooms.set(roomId, room);
            }
            room.lastActivity = Date.now();
            const pId = participantId || socket.id;
            const isFirst = Object.keys(room.participants).length === 0;
            // Handle reconnect or new join
            const existingParticipant = room.participants[pId];
            if (existingParticipant) {
                existingParticipant.lastSeen = Date.now();
                existingParticipant.nickname = nickname || existingParticipant.nickname;
            }
            else {
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
            socket.emit("room_state", { room, serverTime: Date.now() });
            socket.to(roomId).emit("participant_joined", room.participants[pId]);
        });
        socket.on("command", ({ roomId, type, payload, sequence }) => {
            const room = rooms.get(roomId);
            if (!room || !currentParticipantId)
                return;
            room.lastActivity = Date.now();
            const participant = room.participants[currentParticipantId];
            if (!participant)
                return;
            room.sequence++;
            // Permission checks
            const isOwnerOrMod = participant.role === "owner" || participant.role === "moderator";
            const canControlPlayback = room.settings.controlMode === "open" ||
                isOwnerOrMod ||
                (room.settings.controlMode === "hybrid" &&
                    ["play", "pause", "seek", "buffering", "next"].includes(type));
            const canEditPlaylist = room.settings.controlMode === "open" || isOwnerOrMod;
            let stateChanged = false;
            // Ensure commands are valid and authoritative
            switch (type) {
                case "play":
                    if (!canControlPlayback)
                        break;
                    if (typeof payload.position !== "number")
                        break;
                    // Validations: verify position is reasonable
                    if (room.playback.status !== "playing" ||
                        Math.abs(room.playback.basePosition - payload.position) > 2.0) {
                        room.playback.status = "playing";
                        room.playback.basePosition = payload.position;
                        room.playback.baseTimestamp = Date.now();
                        room.playback.updatedBy = participant.nickname;
                        stateChanged = true;
                    }
                    break;
                case "pause":
                    if (!canControlPlayback)
                        break;
                    if (typeof payload.position !== "number")
                        break;
                    if (room.playback.status !== "paused") {
                        room.playback.status = "paused";
                        room.playback.basePosition = payload.position;
                        room.playback.baseTimestamp = Date.now();
                        room.playback.updatedBy = participant.nickname;
                        stateChanged = true;
                    }
                    break;
                case "seek":
                    if (!canControlPlayback)
                        break;
                    if (typeof payload.position !== "number")
                        break;
                    room.playback.basePosition = payload.position;
                    room.playback.baseTimestamp = Date.now();
                    room.playback.updatedBy = participant.nickname;
                    stateChanged = true;
                    break;
                case "buffering":
                    if (!canControlPlayback)
                        break;
                    if (typeof payload.position !== "number")
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
                    if (!canEditPlaylist)
                        break;
                    // Guard against unbounded memory exhaustion (OOM attack vector)
                    if (room.playlist.length >= 500) {
                        socket.emit("error", {
                            message: "Playlist maximum limit reached (500 items)",
                        });
                        break;
                    }
                    const newItem = {
                        id: (0, crypto_1.randomUUID)(),
                        url: payload.url,
                        provider: payload.provider || "unknown", // Client sets this validation
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
                    persistRoomState(room); // Debounced automatically
                    break;
                case "remove_item":
                    if (!canEditPlaylist)
                        break;
                    room.playlist = room.playlist.filter((item) => item.id !== payload.itemId);
                    if (room.currentMediaId === payload.itemId) {
                        room.currentMediaId =
                            room.playlist.length > 0 ? room.playlist[0].id : null;
                        room.playback.status = "paused";
                        room.playback.basePosition = 0;
                        room.playback.baseTimestamp = Date.now();
                    }
                    stateChanged = true;
                    persistRoomState(room);
                    break;
                case "reorder_playlist":
                    if (!canEditPlaylist)
                        break;
                    if (payload.playlist && Array.isArray(payload.playlist)) {
                        const oldIds = new Set(room.playlist.map((i) => i.id));
                        const newIds = new Set(payload.playlist.map((i) => i.id));
                        if (oldIds.size === newIds.size &&
                            [...oldIds].every((id) => newIds.has(id))) {
                            room.playlist = payload.playlist;
                            stateChanged = true;
                            persistRoomState(room);
                        }
                    }
                    break;
                case "set_media":
                    if (!canControlPlayback && !canEditPlaylist)
                        break;
                    room.currentMediaId = payload.itemId;
                    room.playback.status = "paused";
                    room.playback.basePosition = 0;
                    room.playback.baseTimestamp = Date.now();
                    room.playback.updatedBy = participant.nickname;
                    stateChanged = true;
                    persistRoomState(room);
                    break;
                case "next":
                    if (!canControlPlayback)
                        break;
                    if (payload.currentMediaId !== room.currentMediaId)
                        break;
                    const currentIndex = room.playlist.findIndex((i) => i.id === room.currentMediaId);
                    if (currentIndex !== -1 && currentIndex < room.playlist.length - 1) {
                        room.currentMediaId = room.playlist[currentIndex + 1].id;
                        room.playback.status = "playing"; // Auto-play next
                        room.playback.basePosition = 0;
                        room.playback.baseTimestamp = Date.now();
                        room.playback.updatedBy = participant.nickname;
                        stateChanged = true;
                        persistRoomState(room);
                    }
                    else if (room.settings.looping && room.playlist.length > 0) {
                        room.currentMediaId = room.playlist[0].id;
                        room.playback.status = "playing";
                        room.playback.basePosition = 0;
                        room.playback.baseTimestamp = Date.now();
                        room.playback.updatedBy = participant.nickname;
                        stateChanged = true;
                        persistRoomState(room);
                    }
                    break;
                case "update_settings":
                    if (!isOwnerOrMod)
                        break;
                    room.settings = Object.assign(Object.assign({}, room.settings), payload.settings);
                    stateChanged = true;
                    persistRoomState(room);
                    break;
                case "update_nickname":
                    if (room.participants[currentParticipantId]) {
                        room.participants[currentParticipantId].nickname = String(payload.nickname).substring(0, 30);
                        stateChanged = true;
                    }
                    break;
                case "update_role": // New command for safe transfer
                    if (participant.role !== "owner")
                        break;
                    const targetUser = room.participants[payload.participantId];
                    if (targetUser &&
                        ["guest", "moderator", "owner"].includes(payload.role)) {
                        // Safety guard: if transferring owner, downgrade self to moderator
                        if (payload.role === "owner") {
                            participant.role = "moderator";
                        }
                        targetUser.role = payload.role;
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
                room.version++;
                io.to(roomId).emit("room_state", { room, serverTime: Date.now() });
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
                        const r = rooms.get(currentRoomId);
                        if (r &&
                            r.participants[currentParticipantId] &&
                            Date.now() - r.participants[currentParticipantId].lastSeen >
                                10000) {
                            delete r.participants[currentParticipantId];
                            r.version++;
                            io.to(currentRoomId).emit("participant_left", {
                                participantId: currentParticipantId,
                            });
                            // Empty room cleanup
                            const remaining = Object.values(r.participants);
                            if (remaining.length === 0) {
                                // Perform final persistence before removing from memory
                                persistRoomState(r).then(() => {
                                    rooms.delete(currentRoomId);
                                });
                            }
                            else {
                                // Owner transfer guard
                                if (!remaining.some((p) => p.role === "owner")) {
                                    remaining[0].role = "owner"; // Promote oldest user to owner
                                    io.to(currentRoomId).emit("room_state", {
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
