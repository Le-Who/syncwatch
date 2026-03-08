import { getRedisClient } from "./redis-rate-limit";
import { getRedisRoom, setRedisRoom } from "./redis-actor";

export async function pushSlowCommand(
  roomId: string,
  sequence: number,
  type: string,
  payload: any,
  participantId: string,
  participantNickname: string,
): Promise<boolean> {
  const redisClient = getRedisClient();
  if (!redisClient) return false;

  try {
    const commandDef = {
      type,
      payload,
      participantId,
      participantNickname,
      sequence,
      timestamp: Date.now(),
    };
    await redisClient.rpush(`room_queue:${roomId}`, JSON.stringify(commandDef));
    await redisClient.publish(`queue_wakeup:${roomId}`, "1");
    // Ensure queues don't live forever if unhandled
    await redisClient.expire(`room_queue:${roomId}`, 86400);
    return true;
  } catch (e) {
    console.error("Queue push error:", e);
    return false;
  }
}
