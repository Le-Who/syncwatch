import type { Participant, RoomState } from "./types";
import type {
  CommandRejectionCode,
  RoomCommand,
} from "./room-command-contract";
import type { CanonicalPlayback } from "./room-events";
import { applyFastCommand } from "./room-logic";
import { expireRedisRoom, getRedisRoom, setRedisRoomCAS } from "./redis-actor";
import { executeFastMutation } from "./redis-lua";
import { getRedisClient } from "./redis-rate-limit";

export type PlaybackCommand = Extract<
  RoomCommand,
  {
    type:
      | "play"
      | "pause"
      | "seek"
      | "buffering"
      | "update_rate"
      | "sync_correction";
  }
>;

export type PlaybackMutationResult =
  | { status: "applied"; room: RoomState; playback: CanonicalPlayback }
  | { status: "ignored"; code: "DUPLICATE" }
  | { status: "rejected"; code: CommandRejectionCode };

export interface RoomRepository {
  get(roomId: string): Promise<RoomState | null>;
  compareAndSet(
    roomId: string,
    expectedVersion: number,
    next: RoomState,
  ): Promise<boolean>;
  mutatePlayback(
    roomId: string,
    command: PlaybackCommand,
    actor: Participant,
  ): Promise<PlaybackMutationResult>;
  expire(roomId: string, ttlSeconds: number): Promise<void>;
}

type Clock = () => number;

const MAX_PROCESSED_NONCES = 256;
const MAX_PLAYBACK_CAS_ATTEMPTS = 10;

function cloneRoom(room: RoomState): RoomState {
  return structuredClone(room);
}

function canonicalPlayback(room: RoomState): CanonicalPlayback {
  return {
    mediaItemId: room.currentMediaId,
    status: room.playback.status,
    basePosition: room.playback.basePosition,
    baseTimestamp: room.playback.baseTimestamp,
    rate: room.playback.rate,
    sequence: room.sequence,
    updatedBy: room.playback.updatedBy,
    ...(room.playback.lastActionNonce
      ? { lastActionNonce: room.playback.lastActionNonce }
      : {}),
  };
}

function hasProcessedNonce(room: RoomState, nonce: string | undefined) {
  return Boolean(nonce && room.processedCommandNonces?.includes(nonce));
}

function rememberNonce(room: RoomState, nonce: string | undefined) {
  if (!nonce) return;
  room.processedCommandNonces = [
    ...(room.processedCommandNonces ?? []).filter((value) => value !== nonce),
    nonce,
  ].slice(-MAX_PROCESSED_NONCES);
}

abstract class SerializedRoomRepository implements RoomRepository {
  private readonly roomOperations = new Map<string, Promise<unknown>>();

  constructor(protected readonly now: Clock = Date.now) {}

  abstract get(roomId: string): Promise<RoomState | null>;
  abstract compareAndSet(
    roomId: string,
    expectedVersion: number,
    next: RoomState,
  ): Promise<boolean>;
  abstract expire(roomId: string, ttlSeconds: number): Promise<void>;

  protected serialize<T>(roomId: string, operation: () => Promise<T>) {
    const prior = this.roomOperations.get(roomId) ?? Promise.resolve();
    const current = prior.then(operation, operation);
    const settled = current.finally(() => {
      if (this.roomOperations.get(roomId) === settled) {
        this.roomOperations.delete(roomId);
      }
    });
    this.roomOperations.set(roomId, settled);
    return current;
  }

  async mutatePlayback(
    roomId: string,
    command: PlaybackCommand,
    actor: Participant,
  ): Promise<PlaybackMutationResult> {
    return this.serialize(roomId, async () => {
      for (let attempt = 0; attempt < MAX_PLAYBACK_CAS_ATTEMPTS; attempt++) {
        const room = await this.get(roomId);
        if (!room) return { status: "rejected", code: "NOT_JOINED" };
        const authoritativeActor = room.participants[actor.id];
        if (!authoritativeActor) {
          return { status: "rejected", code: "NOT_PARTICIPANT" };
        }

        const nonce = command.payload?.nonce;
        if (hasProcessedNonce(room, nonce)) {
          return { status: "ignored", code: "DUPLICATE" };
        }

        const baseVersion = room.version;
        const serverTime = this.now();
        const result = applyFastCommand(
          room,
          command.type,
          command.payload,
          authoritativeActor.id,
          authoritativeActor.id,
          serverTime,
        );
        if (result === "unauthorized") {
          return { status: "rejected", code: "NOT_PERMITTED" };
        }
        if (result === "invalid" || result === "unchanged") {
          return { status: "rejected", code: "INVALID_COMMAND" };
        }

        room.version = baseVersion + 1;
        room.sequence += 1;
        room.lastActivity = serverTime;
        rememberNonce(room, nonce);
        if (!(await this.compareAndSet(roomId, baseVersion, room))) {
          continue;
        }
        return {
          status: "applied",
          room,
          playback: canonicalPlayback(room),
        };
      }
      return { status: "rejected", code: "INVALID_COMMAND" };
    });
  }
}

export class InMemoryRoomRepository extends SerializedRoomRepository {
  private readonly rooms = new Map<string, RoomState>();
  private readonly expiryTimers = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();

  constructor(initialRooms: RoomState[] = [], now: Clock = Date.now) {
    super(now);
    for (const room of initialRooms) this.rooms.set(room.id, cloneRoom(room));
  }

  async get(roomId: string) {
    const room = this.rooms.get(roomId);
    return room ? cloneRoom(room) : null;
  }

  async compareAndSet(
    roomId: string,
    expectedVersion: number,
    next: RoomState,
  ) {
    const existing = this.rooms.get(roomId);
    if (existing && existing.version !== expectedVersion) return false;
    if (!existing && expectedVersion !== 0) return false;
    this.rooms.set(roomId, cloneRoom(next));
    return true;
  }

  async expire(roomId: string, ttlSeconds: number) {
    const existingTimer = this.expiryTimers.get(roomId);
    if (existingTimer) clearTimeout(existingTimer);
    const timer = setTimeout(() => {
      this.rooms.delete(roomId);
      this.expiryTimers.delete(roomId);
    }, ttlSeconds * 1_000);
    timer.unref?.();
    this.expiryTimers.set(roomId, timer);
  }
}

export class RedisRoomRepository extends SerializedRoomRepository {
  async get(roomId: string) {
    return (await getRedisRoom(roomId)) as RoomState | null;
  }

  async compareAndSet(
    roomId: string,
    expectedVersion: number,
    next: RoomState,
  ) {
    return setRedisRoomCAS(roomId, next, expectedVersion);
  }

  async mutatePlayback(
    roomId: string,
    command: PlaybackCommand,
    actor: Participant,
  ): Promise<PlaybackMutationResult> {
    if (!getRedisClient()) {
      return super.mutatePlayback(roomId, command, actor);
    }

    const result = await executeFastMutation(
      roomId,
      command.type,
      command.payload,
      actor.id,
    );
    if (!result.success) {
      if (result.error === "DUPLICATE") {
        return { status: "ignored", code: "DUPLICATE" };
      }
      if (result.error === "UNAUTHORIZED") {
        return { status: "rejected", code: "NOT_PERMITTED" };
      }
      return { status: "rejected", code: "INVALID_COMMAND" };
    }
    const room = result.state as RoomState;
    return {
      status: "applied",
      room,
      playback: canonicalPlayback(room),
    };
  }

  async expire(roomId: string, ttlSeconds: number) {
    await expireRedisRoom(roomId, ttlSeconds);
  }
}

export const roomRepository: RoomRepository = new RedisRoomRepository();
