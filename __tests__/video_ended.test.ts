import { describe, it, expect, vi, beforeEach } from "vitest";
import { RoomState } from "../lib/types";
import { applyVideoEnded } from "../lib/room-logic";

describe("room-logic: video_ended command", () => {
  let room: RoomState;

  beforeEach(() => {
    room = {
      id: "test-room",
      name: "Auto-Switch Room",
      lastActivity: Date.now(),
      version: 1,
      sequence: 1,
      settings: {
        controlMode: "open",
        looping: false,
        autoplayNext: true,
      },
      participants: {
        "user-1": {
          id: "user-1",
          nickname: "Owner",
          role: "owner",
          lastSeen: Date.now(),
        },
        "viewer-1": {
          id: "viewer-1",
          nickname: "Viewer",
          role: "viewer",
          lastSeen: Date.now(),
        },
      },
      playlist: [
        {
          id: "item-1",
          url: "http://vid1.com",
          title: "Vid1",
          provider: "youtube",
          duration: 100,
          lastPosition: 0,
          addedBy: "user-1",
        },
        {
          id: "item-2",
          url: "http://vid2.com",
          title: "Vid2",
          provider: "twitch",
          duration: 200,
          lastPosition: 0,
          addedBy: "user-1",
        },
        {
          id: "item-3",
          url: "http://vid3.com",
          title: "Vid3",
          provider: "vimeo",
          duration: 300,
          lastPosition: 0,
          addedBy: "user-1",
        },
      ],
      currentMediaId: "item-1",
      playback: {
        status: "playing",
        basePosition: 99,
        rate: 1,
        baseTimestamp: Date.now(),
        updatedBy: "user-1",
      },
    };
  });

  it("advances to the next item when autoplayNext is true", () => {
    const changed = applyVideoEnded(
      room,
      { currentMediaId: "item-1" },
      "viewer-1",
      "Viewer",
    );

    expect(changed).toBe(true);
    expect(room.currentMediaId).toBe("item-2");
    expect(room.playback.status).toBe("playing");
    expect(room.playback.basePosition).toBe(0);
    // Verifies saving the previous position
    expect(room.playlist[0].lastPosition).toBeCloseTo(99, 1);
  });

  it("pauses and does not advance when autoplayNext is false", () => {
    room.settings.autoplayNext = false;

    const changed = applyVideoEnded(
      room,
      { currentMediaId: "item-1" },
      "viewer-1",
      "Viewer",
    );

    expect(changed).toBe(true);
    expect(room.currentMediaId).toBe("item-1");
    expect(room.playback.status).toBe("paused");
  });

  it("loops to the first item if at end of playlist and looping is true", () => {
    room.currentMediaId = "item-3";
    room.settings.looping = true;

    const changed = applyVideoEnded(
      room,
      { currentMediaId: "item-3" },
      "user-1",
      "Owner",
    );

    expect(changed).toBe(true);
    expect(room.currentMediaId).toBe("item-1");
    expect(room.playback.status).toBe("playing");
  });

  it("stops and pauses on the last item if looping is false", () => {
    room.currentMediaId = "item-3";
    room.settings.looping = false;

    const changed = applyVideoEnded(
      room,
      { currentMediaId: "item-3" },
      "user-1",
      "Owner",
    );

    expect(changed).toBe(true);
    expect(room.currentMediaId).toBe("item-3");
    expect(room.playback.status).toBe("paused");
  });

  it("ignores video_ended if the mediaId doesn't match the current active media", () => {
    room.currentMediaId = "item-2"; // Room already advanced!

    const changed = applyVideoEnded(
      room,
      { currentMediaId: "item-1" },
      "user-1",
      "Owner",
    );

    expect(changed).toBe(false);
    expect(room.currentMediaId).toBe("item-2"); // Unchanged
  });
});
