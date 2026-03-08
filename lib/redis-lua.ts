import { getRedisClient } from "./redis-rate-limit";

// Centralized Lua scripts for atomic fast-path mutations
const LUA_FAST_MUTATION = `
  local room_key = KEYS[1]
  local expected_version = tonumber(ARGV[1])
  local mutation_type = ARGV[2]
  local mutation_payload = cjson.decode(ARGV[3])
  local participant_id = ARGV[4]
  local participant_nickname = ARGV[5]
  local now = tonumber(ARGV[6])

  local val = redis.call("get", room_key)
  if not val then return "ROOM_NOT_FOUND" end
  
  local room = cjson.decode(val)
  
  -- If expected_version is passed explicitly, enforce OCC on the atomic level. 
  -- Otherwise, if -1, we bypass strictly for 'last-writer-wins' player synchronization
  if expected_version ~= -1 and room.version ~= expected_version then
    return "VERSION_CONFLICT"
  end

  local participant = room.participants[participant_id]
  if not participant then return "UNAUTHORIZED" end

  local is_owner_or_mod = participant.role == "owner" or participant.role == "moderator"
  local can_control = room.settings.controlMode == "open" or is_owner_or_mod

  if room.settings.controlMode == "hybrid" and (mutation_type == "play" or mutation_type == "pause" or mutation_type == "seek" or mutation_type == "buffering") then
     can_control = true
  end

  if not can_control then return "UNAUTHORIZED" end

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
           room.playback.updatedBy = participant_nickname
           changed = true
        end
     end
  elseif mutation_type == "pause" then
     if type(mutation_payload.position) == "number" and mutation_payload.position >= 0 then
        if room.playback.status ~= "paused" then
           room.playback.status = "paused"
           room.playback.basePosition = mutation_payload.position
           room.playback.baseTimestamp = now
           room.playback.updatedBy = participant_nickname
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
        room.playback.updatedBy = participant_nickname
        changed = true
     end
  end

  if changed then
     room.version = room.version + 1
     room.sequence = room.sequence + 1
     room.lastActivity = now
     
     local new_val = cjson.encode(room)
     redis.call("set", room_key, new_val)
     redis.call("expire", room_key, 86400)
     
     return new_val
  end

  return "NO_CHANGE"
`;

export async function executeFastMutation(
  roomId: string,
  expectedVersion: number,
  mutationType: string,
  payload: any,
  participantId: string,
  participantNickname: string,
): Promise<{ success: boolean; state?: any; error?: string }> {
  const redisClient = getRedisClient();
  if (!redisClient) {
    return { success: false, error: "REDIS_REQUIRED" };
  }

  try {
    const result = (await redisClient.eval(
      LUA_FAST_MUTATION,
      1,
      `room_state:${roomId}`,
      expectedVersion.toString(),
      mutationType,
      JSON.stringify(payload),
      participantId,
      participantNickname,
      Date.now().toString(),
    )) as string;

    if (typeof result === "string") {
      if (result.startsWith("{")) {
        return { success: true, state: JSON.parse(result) };
      }
      return { success: false, error: result };
    }
    return { success: false, error: "UNKNOWN_ERROR" };
  } catch (e: any) {
    console.error("Fast Mutation Lua Error:", e);
    return { success: false, error: "LUA_ERROR" };
  }
}
