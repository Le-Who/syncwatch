import { describe, expect, it } from "vitest";
import { createEmptyRoom } from "../lib/room-handler";
import { applyFastCommand, applySlowCommand } from "../lib/room-logic";
import { PlaylistItem, RoomState } from "../lib/types";

const ids = {
  one: "00000000-0000-4000-8000-000000000001",
  two: "00000000-0000-4000-8000-000000000002",
  three: "00000000-0000-4000-8000-000000000003",
  four: "00000000-0000-4000-8000-000000000004",
};

function item(id: string, title: string): PlaylistItem {
  return {
    id,
    title,
    url: `https://example.com/${id}.mp4`,
    provider: "direct",
    duration: 120,
    addedBy: "Owner",
  };
}

function roomFixture(): RoomState {
  const room = createEmptyRoom("parity-room", "Parity Room");
  room.participants = {
    owner: { id: "owner", nickname: "Owner", role: "owner", lastSeen: 1 },
    mod: { id: "mod", nickname: "Mod", role: "moderator", lastSeen: 1 },
    viewer: { id: "viewer", nickname: "Viewer", role: "viewer", lastSeen: 1 },
    other: { id: "other", nickname: "Other", role: "viewer", lastSeen: 1 },
  };
  room.playlist = [item(ids.one, "One"), item(ids.two, "Two"), item(ids.three, "Three")];
  room.currentMediaId = ids.one;
  room.playback = {
    status: "playing",
    basePosition: 60,
    baseTimestamp: Date.now(),
    rate: 1,
    updatedBy: "Owner",
  };
  return room;
}

describe("SyncTube parity room mutations", () => {
  it("lets viewers add multiple items, but appends them instead of managing queue order", () => {
    const room = roomFixture();
    room.settings.controlMode = "controlled";

    const changed = applySlowCommand(
      room,
      "add_items",
      {
        insertMode: "next",
        items: [
          { url: "https://example.com/new-a.mp4", title: "New A", provider: "direct" },
          { url: "https://example.com/new-b.mp4", title: "New B", provider: "direct" },
        ],
      },
      "viewer",
      "Viewer",
    );

    expect(changed).toBe(true);
    expect(room.playlist.map((i) => i.title)).toEqual([
      "One",
      "Two",
      "Three",
      "New A",
      "New B",
    ]);
    expect(room.playlist[3].requesterId).toBe("viewer");
  });

  it("lets viewers append media regardless of legacy room mode but prevents queue reordering", () => {
    const room = roomFixture();
    room.settings.controlMode = "controlled";
    room.settings.playlistMode = "append_only";

    expect(
      applySlowCommand(
        room,
        "add_item",
        {
          url: "https://example.com/append-only.mp4",
          title: "Append Only",
          provider: "direct",
          insertMode: "next",
        },
        "viewer",
        "Viewer",
      ),
    ).toBe(true);

    expect(room.playlist.map((i) => i.title)).toEqual([
      "One",
      "Two",
      "Three",
      "Append Only",
    ]);
    expect(
      applySlowCommand(
        room,
        "set_next_item",
        { itemId: ids.three },
        "viewer",
        "Viewer",
      ),
    ).toBe(false);
  });

  it("moves an existing item to play next without changing the current item", () => {
    const room = roomFixture();

    const changed = applySlowCommand(
      room,
      "set_next_item",
      { itemId: ids.three },
      "owner",
      "Owner",
    );

    expect(changed).toBe(true);
    expect(room.currentMediaId).toBe(ids.one);
    expect(room.playlist.map((i) => i.id)).toEqual([ids.one, ids.three, ids.two]);
  });

  it("toggles temporary queue state", () => {
    const room = roomFixture();

    expect(
      applySlowCommand(
        room,
        "toggle_item_temporary",
        { itemId: ids.two },
        "owner",
        "Owner",
      ),
    ).toBe(true);

    expect(room.playlist[1].isTemporary).toBe(true);
  });

  it("requests and releases a leader without changing roles", () => {
    const room = roomFixture();

    expect(
      applySlowCommand(room, "request_leader", {}, "viewer", "Viewer"),
    ).toBe(true);
    expect(room.leaderId).toBe("viewer");
    expect(room.participants.viewer.role).toBe("viewer");

    expect(
      applySlowCommand(room, "release_leader", {}, "viewer", "Viewer"),
    ).toBe(true);
    expect(room.leaderId).toBeNull();
  });

  it("does not let a second participant overwrite an active leader", () => {
    const room = roomFixture();

    expect(
      applySlowCommand(room, "request_leader", {}, "viewer", "Viewer"),
    ).toBe(true);
    expect(room.leaderId).toBe("viewer");

    expect(
      applySlowCommand(room, "request_leader", {}, "other", "Other"),
    ).toBe(false);
    expect(room.leaderId).toBe("viewer");
  });

  it("lets everyone control playback when no leader is active", () => {
    const room = roomFixture();
    room.playback.status = "paused";
    room.playback.basePosition = 90;

    expect(
      applySlowCommand(
        room,
        "rewind",
        { seconds: -30 },
        "viewer",
        "Viewer",
      ),
    ).toBe(true);
    expect(room.playback.basePosition).toBe(60);
    expect(room.playback.updatedBy).toBe("Viewer");
  });

  it("applies fast playback commands only for allowed controllers", () => {
    const room = roomFixture();
    room.playback.status = "paused";
    room.playback.basePosition = 90;

    expect(
      applyFastCommand(room, "play", { position: 12 }, "viewer", "Viewer"),
    ).toBe("changed");
    expect(room.playback.status).toBe("playing");
    expect(room.playback.basePosition).toBe(12);
    expect(room.playback.updatedBy).toBe("Viewer");

    room.leaderId = "viewer";
    expect(
      applyFastCommand(room, "play", { position: 44, forceSeek: true }, "other", "Other"),
    ).toBe("unauthorized");
    expect(room.playback.basePosition).toBe(12);

    expect(
      applyFastCommand(room, "pause", { position: 20 }, "viewer", "Viewer"),
    ).toBe("changed");
    expect(room.playback.status).toBe("paused");
    expect(room.playback.basePosition).toBe(20);

    expect(
      applyFastCommand(room, "seek", { position: 33 }, "mod", "Mod"),
    ).toBe("changed");
    expect(room.playback.status).toBe("paused");
    expect(room.playback.basePosition).toBe(33);
    expect(room.playback.updatedBy).toBe("Mod");
  });

  it("limits playback control to the active leader and admins while a leader is set", () => {
    const room = roomFixture();
    room.leaderId = "viewer";
    room.playback.status = "paused";
    room.playback.basePosition = 90;

    expect(
      applySlowCommand(
        room,
        "rewind",
        { seconds: -30 },
        "other",
        "Other",
      ),
    ).toBe(false);
    expect(room.playback.basePosition).toBe(90);

    expect(
      applySlowCommand(
        room,
        "rewind",
        { seconds: -30 },
        "viewer",
        "Viewer",
      ),
    ).toBe(true);
    expect(room.playback.basePosition).toBe(60);

    expect(
      applySlowCommand(
        room,
        "rewind",
        { seconds: 10 },
        "mod",
        "Mod",
      ),
    ).toBe(true);
    expect(room.playback.basePosition).toBe(70);
  });

  it("transfers ownership and demotes the previous owner to moderator", () => {
    const room = roomFixture();

    expect(
      applySlowCommand(
        room,
        "transfer_owner",
        { targetParticipantId: "viewer" },
        "owner",
        "Owner",
      ),
    ).toBe(true);

    expect(room.participants.viewer.role).toBe("owner");
    expect(room.participants.owner.role).toBe("moderator");
  });

  it("marks media readiness per participant and current item", () => {
    const room = roomFixture();

    expect(
      applySlowCommand(
        room,
        "media_ready",
        { mediaId: ids.one, ready: true },
        "viewer",
        "Viewer",
      ),
    ).toBe(true);

    expect(room.participants.viewer.ready).toBe(true);
    expect(room.playlist[0].readyParticipants?.viewer).toBe(true);
  });

  it("stores sanitized chat messages with participant identity", () => {
    const room = roomFixture();

    expect(
      applySlowCommand(
        room,
        "send_chat",
        { message: "  hello room  " },
        "viewer",
        "Viewer",
      ),
    ).toBe(true);

    expect(room.chat).toHaveLength(1);
    expect(room.chat[0]).toMatchObject({
      participantId: "viewer",
      nickname: "Viewer",
      message: "hello room",
    });
    expect(room.chat[0].id).toEqual(expect.any(String));
    expect(room.chat[0].sentAt).toEqual(expect.any(Number));
  });

  it("rewinds relatively and flashbacks to the prior playback position", () => {
    const room = roomFixture();
    room.playback.status = "paused";
    room.playback.basePosition = 90;

    expect(
      applySlowCommand(
        room,
        "rewind",
        { seconds: -30 },
        "viewer",
        "Viewer",
      ),
    ).toBe(true);
    expect(room.playback.basePosition).toBe(60);

    room.playback.basePosition = 90;

    expect(
      applySlowCommand(
        room,
        "rewind",
        { seconds: -30 },
        "mod",
        "Mod",
      ),
    ).toBe(true);
    expect(room.playback.basePosition).toBe(60);

    expect(
      applySlowCommand(room, "flashback", {}, "viewer", "Viewer"),
    ).toBe(true);
    expect(room.playback.basePosition).toBe(90);

    expect(
      applySlowCommand(room, "flashback", {}, "mod", "Mod"),
    ).toBe(true);
    expect(room.playback.basePosition).toBe(60);
  });

  it("allows viewer playback selection when no leader is active", () => {
    const room = roomFixture();

    expect(
      applySlowCommand(
        room,
        "set_media",
        { itemId: ids.two },
        "viewer",
        "Viewer",
      ),
    ).toBe(true);
    expect(room.currentMediaId).toBe(ids.two);

    expect(
      applySlowCommand(
        room,
        "set_media",
        { itemId: ids.three },
        "mod",
        "Mod",
      ),
    ).toBe(true);
    expect(room.currentMediaId).toBe(ids.three);
  });
});
