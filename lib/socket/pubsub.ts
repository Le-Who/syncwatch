import { Server } from "socket.io";
import { subClient } from "../redis-actor";
import { sanitizeRoom } from "../room-handler";
import { processQueueForRoom } from "../redis-queue-worker";

export function setupPubSubListeners(io: Server) {
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
}
