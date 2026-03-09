import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { processQueueForRoom } from "../lib/redis-queue-worker";
import * as redisRateLimit from "../lib/redis-rate-limit";
import * as redisActor from "../lib/redis-actor";

// Mock the Redis setup closely
vi.mock("../lib/redis-rate-limit", () => ({
  getRedisClient: vi.fn(),
}));

vi.mock("../lib/redis-actor", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/redis-actor")>();
  return {
    ...actual,
    getRedisRoom: vi.fn(),
    setRedisRoom: vi.fn(),
    publishRoomEvent: vi.fn(),
    withLock: vi.fn(async (lockId, ttl, cb) => {
      return await cb();
    }),
  };
});

describe("worker_resilience (TC-304)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should preserve queue data if the database/persistence layer throws an error", async () => {
    // 1. Arrange
    const mockRoom = {
      id: "room-db-drop",
      version: 1,
      sequence: 1,
      participants: {
        "user-1": { role: "owner", id: "user-1", nickname: "Host" },
      },
      playlist: [],
      settings: { controlMode: "open" },
      playback: { status: "paused" },
    };

    const mockEvents = [
      JSON.stringify({
        type: "add_item",
        payload: { url: "http://example.com/vid", title: "DB test" },
        participantId: "user-1",
        participantNickname: "Host",
        sequence: 2,
        timestamp: Date.now(),
      }),
    ];

    let lpopCallCount = 0;
    const mockRedisClient = {
      lpop: vi.fn().mockImplementation(async () => {
        if (lpopCallCount < mockEvents.length) {
          return mockEvents[lpopCallCount++];
        }
        return null;
      }),
      // We need lrange and ltrim if we expect the fixed version to use them
      lrange: vi.fn().mockResolvedValue(mockEvents),
      ltrim: vi.fn().mockResolvedValue("OK"),
    };

    (redisRateLimit.getRedisClient as any).mockReturnValue(mockRedisClient);
    (redisActor.getRedisRoom as any).mockResolvedValue(mockRoom);

    // Simulate Database/Redis failure on write
    const writeError = new Error("HTTP 500 Internal Server Error (MockDB)");
    (redisActor.setRedisRoom as any).mockRejectedValueOnce(writeError);

    // 2. Act
    // Process the queue. It will pop the item, attempt to save, and throw.
    await expect(processQueueForRoom("room-db-drop")).rejects.toThrow(
      "HTTP 500 Internal Server Error (MockDB)",
    );

    // 3. Assert
    // If the data was simply `lpop`-ed, it will be gone from the queue but not in the DB.
    // The fixed implementation should *not* mutate the queue destructively until after setRedisRoom succeeds.
    // So we assert that `lpop` was NOT used, but `lrange` was, and `ltrim` was NOT called due to the error.
    expect(mockRedisClient.lpop).not.toHaveBeenCalled();
    expect(mockRedisClient.lrange).toHaveBeenCalledWith(
      "room_queue:room-db-drop",
      0,
      -1,
    );
    expect(mockRedisClient.ltrim).not.toHaveBeenCalled();
  });
});
