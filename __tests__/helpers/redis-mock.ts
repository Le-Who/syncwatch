/**
 * redis-mock.ts — Zero-dependency in-process Redis mock for CI environments.
 *
 * Patches `globalThis.redisClient` with a minimal mock that supports:
 *   get, set, del, keys, expire, eval (basic Lua-like dispatch), multi, zcard, zadd, zrangebyscore, zrem, zremrangebyscore
 *
 * The `eval` method handles the CAS and Fast-Mutation Lua scripts by
 * re-implementing their logic in JavaScript (since Lua can't run in-process).
 *
 * Usage in tests:
 *   import { installRedisMock, uninstallRedisMock } from "../__tests__/helpers/redis-mock";
 *   beforeAll(() => installRedisMock());
 *   afterAll(() => uninstallRedisMock());
 */

const store = new Map<string, string>();
const expiries = new Map<string, NodeJS.Timeout>();
const sortedSets = new Map<string, Map<string, number>>();

function clearAll() {
  store.clear();
  for (const t of expiries.values()) clearTimeout(t);
  expiries.clear();
  sortedSets.clear();
}

const mockRedis = {
  get: async (key: string) => store.get(key) ?? null,

  set: async (key: string, value: string, ...args: any[]) => {
    // Handle SET key value PX ttl NX
    if (args.includes("NX") && store.has(key)) return null;
    store.set(key, value);
    const pxIdx = args.indexOf("PX");
    if (pxIdx !== -1 && typeof args[pxIdx + 1] === "number") {
      if (expiries.has(key)) clearTimeout(expiries.get(key)!);
      expiries.set(
        key,
        setTimeout(() => store.delete(key), args[pxIdx + 1]),
      );
    }
    return "OK";
  },

  del: async (...keys: string[]) => {
    let count = 0;
    for (const k of keys) {
      if (store.delete(k)) count++;
      if (expiries.has(k)) {
        clearTimeout(expiries.get(k)!);
        expiries.delete(k);
      }
    }
    return count;
  },

  keys: async (pattern: string) => {
    const prefix = pattern.replace(/\*/g, "");
    return Array.from(store.keys()).filter((k) => k.includes(prefix));
  },

  expire: async (key: string, seconds: number) => {
    if (!store.has(key)) return 0;
    if (expiries.has(key)) clearTimeout(expiries.get(key)!);
    expiries.set(
      key,
      setTimeout(() => store.delete(key), seconds * 1000),
    );
    return 1;
  },

  // Sorted sets (minimal for db-sync queue)
  zadd: async (key: string, score: number, member: string) => {
    if (!sortedSets.has(key)) sortedSets.set(key, new Map());
    sortedSets.get(key)!.set(member, score);
    return 1;
  },
  zcard: async (key: string) => sortedSets.get(key)?.size ?? 0,
  zrem: async (key: string, member: string) => {
    return sortedSets.get(key)?.delete(member) ? 1 : 0;
  },
  zrangebyscore: async (
    key: string,
    min: string,
    max: string,
    ...args: any[]
  ) => {
    const ss = sortedSets.get(key);
    if (!ss) return [];
    const minVal = min === "-inf" ? -Infinity : Number(min);
    const maxVal = max === "+inf" ? Infinity : Number(max);
    let entries = Array.from(ss.entries())
      .filter(([, score]) => score >= minVal && score <= maxVal)
      .sort(([, a], [, b]) => a - b)
      .map(([member]) => member);
    const limitIdx = args.indexOf("LIMIT");
    if (limitIdx !== -1) {
      const offset = Number(args[limitIdx + 1]) || 0;
      const count = Number(args[limitIdx + 2]) || entries.length;
      entries = entries.slice(offset, offset + count);
    }
    return entries;
  },
  zremrangebyscore: async (key: string, min: number, max: number) => {
    const ss = sortedSets.get(key);
    if (!ss) return 0;
    let count = 0;
    for (const [member, score] of ss.entries()) {
      if (score >= min && score <= max) {
        ss.delete(member);
        count++;
      }
    }
    return count;
  },

  // Multi (returns results in ioredis format: [error, result])
  multi: () => {
    const queue: Array<() => Promise<any>> = [];
    const chain = {
      zremrangebyscore: (key: string, min: number, max: number) => {
        queue.push(() => mockRedis.zremrangebyscore(key, min, max));
        return chain;
      },
      zcard: (key: string) => {
        queue.push(() => mockRedis.zcard(key));
        return chain;
      },
      zadd: (key: string, score: number, member: string) => {
        queue.push(() => mockRedis.zadd(key, score, member));
        return chain;
      },
      expire: (key: string, seconds: number) => {
        queue.push(() => mockRedis.expire(key, seconds));
        return chain;
      },
      exec: async () => {
        const results: Array<[null, any]> = [];
        for (const fn of queue) {
          const result = await fn();
          results.push([null, result]);
        }
        return results;
      },
    };
    return chain;
  },

  duplicate: () => mockRedis,
  publish: async () => 0,

  /**
   * eval — Re-implements Lua scripts in JavaScript.
   * Detects the script type by checking for key patterns in the Lua source.
   */
  eval: async (script: string, numKeys: number, ...args: any[]) => {
    const key = args[0] as string;

    // CAS script (setRedisRoomCAS)
    if (
      script.includes("decoded.version") &&
      script.includes("tonumber(ARGV[2])")
    ) {
      const newState = args[1] as string;
      const expectedVersion = Number(args[2]);
      const existing = store.get(key);
      if (!existing) {
        store.set(key, newState);
        return 1;
      }
      const decoded = JSON.parse(existing);
      if (decoded.version === expectedVersion) {
        store.set(key, newState);
        return 1;
      }
      return 0;
    }

    // Lock release script (withLock)
    if (
      script.includes('redis.call("get"') &&
      script.includes('redis.call("del"')
    ) {
      const lockVal = args[1] as string;
      if (store.get(key) === lockVal) {
        store.delete(key);
        return 1;
      }
      return 0;
    }

    // Fast-path mutation script (executeFastMutation)
    if (script.includes("mutation_type") && script.includes("cjson.decode")) {
      const expectedVersion = Number(args[1]);
      const mutationType = args[2] as string;
      const payload = JSON.parse(args[3] as string);
      const participantId = args[4] as string;
      const participantNickname = args[5] as string;
      const now = Number(args[6]);

      const val = store.get(key);
      if (!val) return "ROOM_NOT_FOUND";

      const room = JSON.parse(val);

      if (expectedVersion !== -1 && room.sequence !== expectedVersion) {
        return "VERSION_CONFLICT";
      }

      const participant = room.participants?.[participantId];
      if (!participant) return "UNAUTHORIZED";

      const isOwnerOrMod =
        participant.role === "owner" || participant.role === "moderator";
      let canControl = room.settings.controlMode === "open" || isOwnerOrMod;

      if (
        room.settings.controlMode === "hybrid" &&
        ["play", "pause", "seek", "buffering", "next", "previous"].includes(
          mutationType,
        )
      ) {
        canControl = true;
      }
      if (
        room.settings.controlMode === "controlled" &&
        mutationType === "sync_correction"
      ) {
        if (participant.role !== "owner") return "UNAUTHORIZED";
        canControl = true;
      }
      if (!canControl) return "UNAUTHORIZED";

      let changed = false;

      if (["play", "seek", "buffering"].includes(mutationType)) {
        if (typeof payload.position === "number" && payload.position >= 0) {
          if (
            mutationType === "play" &&
            room.playback.status === "playing" &&
            !payload.forceSeek
          ) {
            // strictly ignore
          } else {
            if (mutationType === "play") room.playback.status = "playing";
            else if (mutationType === "buffering")
              room.playback.status = "buffering";
            room.playback.basePosition = payload.position;
            room.playback.baseTimestamp = now;
            room.playback.updatedBy = participantNickname;
            if (payload.nonce) room.playback.lastActionNonce = payload.nonce;
            changed = true;
          }
        }
      } else if (mutationType === "pause") {
        if (typeof payload.position === "number" && payload.position >= 0) {
          if (room.playback.status !== "paused") {
            room.playback.status = "paused";
            room.playback.basePosition = payload.position;
            room.playback.baseTimestamp = now;
            room.playback.updatedBy = participantNickname;
            if (payload.nonce) room.playback.lastActionNonce = payload.nonce;
            changed = true;
          }
        }
      } else if (mutationType === "update_rate") {
        const newRate = payload.rate;
        if (typeof newRate === "number" && newRate >= 0.25 && newRate <= 4.0) {
          if (room.playback.status === "playing") {
            const elapsed = (now - room.playback.baseTimestamp) / 1000;
            room.playback.basePosition += elapsed * room.playback.rate;
            room.playback.baseTimestamp = now;
          }
          room.playback.rate = newRate;
          room.playback.updatedBy = participantNickname;
          if (payload.nonce) room.playback.lastActionNonce = payload.nonce;
          changed = true;
        }
      } else if (mutationType === "sync_correction") {
        if (typeof payload.position === "number" && payload.position >= 0) {
          room.playback.basePosition = payload.position;
          room.playback.baseTimestamp = now;
          if (payload.nonce) room.playback.lastActionNonce = payload.nonce;
          changed = true;
        }
      }

      if (changed) {
        room.version = (room.version || 0) + 1;
        room.sequence = (room.sequence || 0) + 1;
        room.lastActivity = now;
        const newVal = JSON.stringify(room);
        store.set(key, newVal);
        return newVal;
      }

      return "NO_CHANGE";
    }

    return null;
  },
};

const globalForRedis = globalThis as unknown as {
  redisClient: any;
};

export function installRedisMock() {
  clearAll();
  globalForRedis.redisClient = mockRedis;
}

export function uninstallRedisMock() {
  clearAll();
  globalForRedis.redisClient = undefined;
}
