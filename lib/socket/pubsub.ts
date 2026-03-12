import { Server } from "socket.io";
import { subClient } from "../redis-actor";
import { sanitizeRoom } from "../room-handler";
import { processQueueForRoom } from "../redis-queue-worker";

export function setupPubSubListeners(io: Server) {
  const sClient = subClient();
  if (sClient) {
    sClient.psubscribe("room_events:*");
    sClient.psubscribe("queue_wakeup:*");

    // Single unified handler — prevents cross-fire between channel patterns
    sClient.on(
      "pmessage",
      (pattern: string, channel: string, message: string) => {
        if (channel.startsWith("room_events:")) {
          try {
            const roomId = channel.split(":")[1];
            if (!roomId) return;
            const data = JSON.parse(message);
            if (data.type === "state_update") {
              if (io.sockets.adapter.rooms.has(roomId)) {
                io.to(roomId).emit("room_state", {
                  room: sanitizeRoom(data.payload),
                  serverTime: Date.now(),
                });
              }
            } else if (data.type === "participant_joined") {
              if (io.sockets.adapter.rooms.has(roomId)) {
                io.to(roomId).emit("participant_joined", data.payload);
              }
            }
          } catch (e) {
            console.error("PubSub parse error:", e);
          }
        } else if (channel.startsWith("queue_wakeup:")) {
          const roomId = channel.split(":")[1];
          if (!roomId) return;
          processQueueForRoom(roomId).catch((e) =>
            console.error("Worker error for", roomId, e),
          );
        }
      },
    );
  }
}
