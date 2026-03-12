import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { processQueueForRoom } from "../lib/redis-queue-worker";
import * as redisActor from "../lib/redis-actor";
import * as redisRateLimit from "../lib/redis-rate-limit";
import { RoomState } from "../lib/types";
import { randomUUID } from "crypto";

vi.mock("../lib/redis-actor", () => ({
  getRedisRoom: vi.fn(),
  setRedisRoomCAS: vi.fn(),
  setRedisRoom: vi.fn(),
  publishRoomEvent: vi.fn().mockResolvedValue(true),
  withLock: vi.fn().mockImplementation((key, ttl, cb) => cb()),
}));

vi.mock("../lib/redis-rate-limit", () => ({
  getRedisClient: vi.fn(),
}));

// Mock the MediaApiService to avoid live network calls during test
vi.mock("../lib/media", () => ({
  MediaApiService: {
    fetchMediaInfo: vi.fn(),
    resolveRedirect: vi.fn(),
  },
}));

vi.mock("../lib/db-sync", () => ({
  markRoomForSync: vi.fn(),
}));

describe("Queue Worker: video_ended command", () => {
  let mockRoom: RoomState;
  let mockRedisClient: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockRedisClient = {
      lrange: vi.fn().mockResolvedValue([]),
      ltrim: vi.fn().mockResolvedValue(true),
    };
    (redisRateLimit.getRedisClient as any).mockReturnValue(mockRedisClient);

    mockRoom = {
      id: "test-room",
      name: "Auto-Switch Room",
      lastActivity: Date.now(),
      version: 1,
      sequence: 1,
      settings: {
        controlMode: "open",
        looping: false,
        autoplayNext: true, // Key setting for these tests
      },
      participants: {
        "user-1": { id: "user-1", nickname: "Owner", role: "owner", lastSeen: Date.now() },
        "viewer-1": { id: "viewer-1", nickname: "Viewer", role: "viewer", lastSeen: Date.now() }
      },
      playlist: [
        { id: "item-1", url: "http://vid1.com", title: "Vid1", provider: "youtube", duration: 100, lastPosition: 0, addedBy: "user-1" },
        { id: "item-2", url: "http://vid2.com", title: "Vid2", provider: "twitch", duration: 200, lastPosition: 0, addedBy: "user-1" },
        { id: "item-3", url: "http://vid3.com", title: "Vid3", provider: "vimeo", duration: 300, lastPosition: 0, addedBy: "user-1" }
      ],
      currentMediaId: "item-1",
      playback: {
        status: "playing",
        basePosition: 99,
        rate: 1,
        baseTimestamp: Date.now(),
        updatedBy: "user-1"
      }
    };

    (redisActor.getRedisRoom as any).mockResolvedValue(mockRoom);
    (redisActor.setRedisRoom as any).mockResolvedValue(true);
  });

  const runWorkerWithJob = async (job: any) => {
    job.timestamp = Date.now();
    job.sequence = 1;
    mockRedisClient.lrange.mockResolvedValue([JSON.stringify(job)]);
    await processQueueForRoom("test-room");
  };

  it("advances to the next item when autoplayNext is true", async () => {
    const job = {
      type: "video_ended",
      payload: { currentMediaId: "item-1" },
      participantId: "viewer-1", // Any viewer can report end
    };

    await runWorkerWithJob(job);

    expect(redisActor.setRedisRoom).toHaveBeenCalled();
    const updatedRoom: RoomState = (redisActor.setRedisRoom as any).mock.calls[0][1];

    expect(updatedRoom.currentMediaId).toBe("item-2");
    expect(updatedRoom.playback.status).toBe("playing");
    expect(updatedRoom.playback.basePosition).toBe(0);
    // Verifies saving the previous position
    expect(updatedRoom.playlist[0].lastPosition).toBeCloseTo(99, 1); 
  });

  it("pauses and does not advance when autoplayNext is false", async () => {
    mockRoom.settings.autoplayNext = false;
    const job = {
      type: "video_ended",
      payload: { currentMediaId: "item-1" },
      participantId: "viewer-1",
    };

    await runWorkerWithJob(job);

    expect(redisActor.setRedisRoom).toHaveBeenCalled();
    const updatedRoom: RoomState = (redisActor.setRedisRoom as any).mock.calls[0][1];

    expect(updatedRoom.currentMediaId).toBe("item-1"); // Shouldn't change
    expect(updatedRoom.playback.status).toBe("paused");
  });

  it("loops to the first item if at end of playlist and looping is true", async () => {
    mockRoom.currentMediaId = "item-3";
    mockRoom.settings.looping = true;
    const job = {
      type: "video_ended",
      payload: { currentMediaId: "item-3" },
      participantId: "user-1",
    };

    await runWorkerWithJob(job);

    expect(redisActor.setRedisRoom).toHaveBeenCalled();
    const updatedRoom: RoomState = (redisActor.setRedisRoom as any).mock.calls[0][1];

    expect(updatedRoom.currentMediaId).toBe("item-1"); // Looped back to start
    expect(updatedRoom.playback.status).toBe("playing");
  });

  it("stops and pauses on the last item if looping is false", async () => {
    mockRoom.currentMediaId = "item-3";
    mockRoom.settings.looping = false; // Note: autoplayNext is still true
    const job = {
      type: "video_ended",
      payload: { currentMediaId: "item-3" },
      participantId: "user-1",
    };

    await runWorkerWithJob(job);

    expect(redisActor.setRedisRoom).toHaveBeenCalled();
    const updatedRoom: RoomState = (redisActor.setRedisRoom as any).mock.calls[0][1];

    expect(updatedRoom.currentMediaId).toBe("item-3"); // Stayed on last
    expect(updatedRoom.playback.status).toBe("paused");
  });

  it("ignores video_ended if the mediaId doesn't match the current active media", async () => {
    // This simulates a delayed video_ended event arriving after the user already clicked "Next"
    const job = {
      type: "video_ended",
      payload: { currentMediaId: "item-1" },
      participantId: "user-1",
    };
    mockRoom.currentMediaId = "item-2"; // Room already advanced!

    await runWorkerWithJob(job);

    // It should exit early without mutating
    expect(redisActor.setRedisRoom).not.toHaveBeenCalled();
  });
});
