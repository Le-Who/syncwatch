import { getRedisClient } from "./redis-rate-limit";
import * as permissions from "./permissions";
import { normalizeRoomState } from "./types";

const MAX_AUTH_SNAPSHOT_RETRIES = 32;

function waitForAuthorizationRetry(attempt: number) {
  const delayMs = Math.min(1 + Math.floor(attempt / 4), 20);
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

// Centralized Lua scripts for atomic fast-path mutations
const LUA_FAST_MUTATION = `
  local room_key = KEYS[1]
  local mutation_type = ARGV[1]
  local mutation_payload = cjson.decode(ARGV[2])
  local participant_id = ARGV[3]
  local now = tonumber(ARGV[4])
  local authorized_leader_id = ARGV[5]
  local authorized_role = ARGV[6]

  local val = redis.call("get", room_key)
  if not val then return "ROOM_NOT_FOUND" end
  
  local room = cjson.decode(val)
  
  local participant = room.participants[participant_id]
  if not participant then return "UNAUTHORIZED" end

  if type(mutation_payload.nonce) == "string" then
    if room.playback.lastActionNonce == mutation_payload.nonce then
      return "DUPLICATE"
    end
    if type(room.processedCommandNonces) == "table" then
      for _, processed_nonce in ipairs(room.processedCommandNonces) do
        if processed_nonce == mutation_payload.nonce then
          return "DUPLICATE"
        end
      end
    end
  end

  -- The shared TypeScript permission policy authorizes the mutation before
  -- this script runs. These snapshots make that authorization atomic without
  -- maintaining a second role/leader policy in Lua.
  local active_leader_id = ""
  if type(room.leaderId) == "string" and room.participants[room.leaderId] ~= nil then
    active_leader_id = room.leaderId
  end
  local participant_role = participant.role
  if participant_role ~= "owner" and participant_role ~= "moderator" and participant_role ~= "viewer" then
    participant_role = "viewer"
  end
  if active_leader_id ~= authorized_leader_id or participant_role ~= authorized_role then
    return "VERSION_CONFLICT"
  end

  local changed = false

  if mutation_type == "play" or mutation_type == "seek" or mutation_type == "buffering" then
     if type(mutation_payload.position) == "number" and mutation_payload.position >= 0 then
        -- If already playing and just hitting play again, do nothing to prevent timestamp shift
        if mutation_type == "play" and room.playback.status == "playing" and not mutation_payload.forceSeek then
           -- strictly ignore
        else
           if mutation_type == "play" then
              room.playback.status = "playing"
           elseif mutation_type == "buffering" then
              room.playback.status = "buffering"
           end
           room.playback.basePosition = mutation_payload.position
           room.playback.baseTimestamp = now
           room.playback.updatedBy = participant_id
           if mutation_payload.nonce then room.playback.lastActionNonce = mutation_payload.nonce end
           changed = true
        end
     end
  elseif mutation_type == "pause" then
     if type(mutation_payload.position) == "number" and mutation_payload.position >= 0 then
        if room.playback.status ~= "paused" then
           room.playback.status = "paused"
           room.playback.basePosition = mutation_payload.position
           room.playback.baseTimestamp = now
           room.playback.updatedBy = participant_id
           if mutation_payload.nonce then room.playback.lastActionNonce = mutation_payload.nonce end
           changed = true
        end
     end
  elseif mutation_type == "update_rate" then
     local new_rate = mutation_payload.rate
     if type(new_rate) == "number" and new_rate >= 0.25 and new_rate <= 4.0 then
        if room.playback.status == "playing" then
           local elapsed_seconds = (now - room.playback.baseTimestamp) / 1000
           room.playback.basePosition = room.playback.basePosition + (elapsed_seconds * room.playback.rate)
           room.playback.baseTimestamp = now
        end
        room.playback.rate = new_rate
        room.playback.updatedBy = participant_id
        if mutation_payload.nonce then room.playback.lastActionNonce = mutation_payload.nonce end
        changed = true
     end
  elseif mutation_type == "sync_correction" then
     if type(mutation_payload.position) == "number" and mutation_payload.position >= 0 then
        room.playback.basePosition = mutation_payload.position
        room.playback.baseTimestamp = now
        room.playback.updatedBy = participant_id
        -- Update the nonce but do not change the underlying playing/paused status
        if mutation_payload.nonce then room.playback.lastActionNonce = mutation_payload.nonce end
        changed = true
     end
  end

  if changed then
     room.version = room.version + 1
     room.sequence = room.sequence + 1
     room.lastActivity = now
     if type(mutation_payload.nonce) == "string" then
       if type(room.processedCommandNonces) ~= "table" then
         room.processedCommandNonces = {}
       end
       table.insert(room.processedCommandNonces, mutation_payload.nonce)
       while #room.processedCommandNonces > 256 do
         table.remove(room.processedCommandNonces, 1)
       end
     end
     
     local new_val = cjson.encode(room)
     redis.call("set", room_key, new_val)
     redis.call("expire", room_key, 86400)
     
     return new_val
  end

  return "NO_CHANGE"
`;

export async function executeFastMutation(
  roomId: string,
  mutationType: string,
  payload: any,
  participantId: string,
): Promise<{ success: boolean; state?: any; error?: string }> {
  const redisClient = getRedisClient();
  if (!redisClient) {
    return { success: false, error: "REDIS_REQUIRED" };
  }

  try {
    for (let attempt = 0; attempt < MAX_AUTH_SNAPSHOT_RETRIES; attempt++) {
      const serializedRoom = await redisClient.get(`room_state:${roomId}`);
      if (!serializedRoom) return { success: false, error: "ROOM_NOT_FOUND" };

      const room = normalizeRoomState(JSON.parse(serializedRoom));
      const participant = room.participants[participantId];
      if (!participant) return { success: false, error: "UNAUTHORIZED" };
      if (
        !permissions.getParticipantPermissions(room, participantId)
          .canControlPlayback
      ) {
        return { success: false, error: "UNAUTHORIZED" };
      }

      const result = (await (redisClient as any).eval(
        LUA_FAST_MUTATION,
        1,
        "room_state:" + roomId,
        mutationType,
        JSON.stringify(payload),
        participantId,
        Date.now().toString(),
        room.leaderId ?? "",
        participant.role,
      )) as string;

      if (typeof result === "string") {
        if (result.startsWith("{")) {
          return { success: true, state: JSON.parse(result) };
        }
        if (result === "VERSION_CONFLICT") {
          await waitForAuthorizationRetry(attempt);
          continue;
        }
        return { success: false, error: result };
      }
      return { success: false, error: "UNKNOWN_ERROR" };
    }
    return { success: false, error: "VERSION_CONFLICT" };
  } catch (e: any) {
    console.error("Fast Mutation Lua Error:", e);
    return { success: false, error: "LUA_ERROR" };
  }
}
