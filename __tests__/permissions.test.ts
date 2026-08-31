import { describe, expect, it } from "vitest";
import { getParticipantPermissions } from "../lib/permissions";
import { roomWithParticipants } from "./helpers/room-fixtures";

describe("participant permissions", () => {
  for (const participantCount of [1, 3, 5, 25]) {
    it(`keeps leaderless playback open for ${participantCount} participants`, () => {
      const room = roomWithParticipants(participantCount, { leaderId: null });

      for (const id of Object.keys(room.participants)) {
        expect(getParticipantPermissions(room, id).canControlPlayback).toBe(
          true,
        );
      }
    });
  }

  it("restricts viewers only while an active leader exists", () => {
    const room = roomWithParticipants(5, {
      leaderId: "p2",
      ownerId: "p0",
      moderatorIds: ["p1"],
    });

    expect(getParticipantPermissions(room, "p0").canControlPlayback).toBe(true);
    expect(getParticipantPermissions(room, "p1").canControlPlayback).toBe(true);
    expect(getParticipantPermissions(room, "p2").canControlPlayback).toBe(true);
    expect(getParticipantPermissions(room, "p3").canControlPlayback).toBe(
      false,
    );
    expect(getParticipantPermissions(room, "p4").canControlPlayback).toBe(
      false,
    );
  });
});
