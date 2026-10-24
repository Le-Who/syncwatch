import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  getDeterministicUUID,
  writeBehindQueue,
  isSystemDegraded,
  markRoomForSync,
  startDbSyncWorker,
  flushDbSyncQueue,
} from "../lib/db-sync";
import { getRedisClient } from "../lib/redis-rate-limit";
import { getRedisRoom } from "../lib/redis-actor";

vi.mock("../lib/redis-rate-limit", () => ({
  getRedisClient: vi.fn(),
}));

vi.mock("../lib/redis-actor", () => ({
  getRedisRoom: vi.fn(),
}));

describe("db-sync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    writeBehindQueue.clear();
    (getRedisClient as any).mockReturnValue(null);
  });

  describe("getDeterministicUUID", () => {
    it("should return the same UUID if input is already a valid UUID", () => {
      const uuid = "1b671a64-40d5-491e-99b0-da01ff1f3341";
      expect(getDeterministicUUID(uuid)).toBe(uuid);
    });

    it("should return a deterministic v5 UUID for non-UUID strings", () => {
      const room1 = "room1";
      const uuid1 = getDeterministicUUID(room1);
      const uuid2 = getDeterministicUUID(room1);
      expect(uuid1).toBe(uuid2);
      expect(uuid1).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
    });
  });

  describe("writeBehindQueue fallback logic", () => {
    it("markRoomForSync should add to writeBehindQueue when Redis is null", () => {
      markRoomForSync("room1");
      expect(writeBehindQueue.has("room1")).toBe(true);
    });

    it("isSystemDegraded should reflect writeBehindQueue size", async () => {
      for (let i = 0; i < 2000; i++) writeBehindQueue.add(`room${i}`);
      expect(await isSystemDegraded()).toBe(false);
      writeBehindQueue.add("room2000");
      expect(await isSystemDegraded()).toBe(true);
    });
  });

  describe("startDbSyncWorker local path", () => {
    it("should process items from writeBehindQueue", async () => {
      vi.useFakeTimers();
      const mockSupabase = {
        rpc: vi.fn().mockResolvedValue({ error: null }),
      } as any;

      const roomData = {
        id: "room1",
        participants: {},
        playlist: [],
        playback: { status: "paused" },
        version: 1,
      };
      (getRedisRoom as any).mockResolvedValue(roomData);

      writeBehindQueue.add("room1");

      startDbSyncWorker(mockSupabase);

      await vi.advanceTimersByTimeAsync(10000);

      expect(writeBehindQueue.has("room1")).toBe(false);
      expect(mockSupabase.rpc).toHaveBeenCalled();
      vi.useRealTimers();
    });

    it("should handle OOM prevention logic", async () => {
      vi.useFakeTimers();
      // Fill queue with 3051 items
      for (let i = 0; i < 3051; i++) writeBehindQueue.add(`room${i}`);

      const mockSupabase = {
        rpc: vi.fn().mockResolvedValue({ error: null }),
      } as any;
      (getRedisRoom as any).mockResolvedValue({
        id: "any",
        participants: {},
        playlist: [],
        playback: { status: "paused" },
        version: 1,
      });

      startDbSyncWorker(mockSupabase);

      await vi.advanceTimersByTimeAsync(10000);

      // After taking 50 items, size is 3001. 3001 > 3000, so it drops oldest to keep 2000.
      expect(writeBehindQueue.size).toBe(2000);
      vi.useRealTimers();
    });

    it("should add back to writeBehindQueue if forcePersistRoom throws", async () => {
      vi.useFakeTimers();
      const mockSupabase = {
        rpc: vi.fn().mockRejectedValue(new Error("RPC Error")),
      } as any;

      const roomData = {
        id: "room1",
        participants: {},
        playlist: [],
        playback: { status: "paused" },
        version: 1,
      };
      (getRedisRoom as any).mockResolvedValue(roomData);

      writeBehindQueue.add("room1");

      startDbSyncWorker(mockSupabase);

      await vi.advanceTimersByTimeAsync(10000);

      // It should be added back because it failed
      expect(writeBehindQueue.has("room1")).toBe(true);
      vi.useRealTimers();
    });
  });

  describe("flushDbSyncQueue local path", () => {
    it("should process all items in writeBehindQueue", async () => {
      const mockSupabase = {
        rpc: vi.fn().mockResolvedValue({ error: null }),
      } as any;

      (getRedisRoom as any).mockImplementation((id: string) =>
        Promise.resolve({
          id,
          participants: {},
          playlist: [],
          playback: { status: "paused" },
          version: 1,
        }),
      );

      writeBehindQueue.add("room1");
      writeBehindQueue.add("room2");

      await flushDbSyncQueue(mockSupabase);

      expect(mockSupabase.rpc).toHaveBeenCalledTimes(2);
    });
  });
});
