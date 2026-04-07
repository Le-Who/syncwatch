import { describe, it, expect } from "vitest";
import { commandSchema } from "../lib/zod-schemas";

describe("Websocket Zod Security Boundary", () => {
  it("TC-01: Should parse valid fast-path play command", () => {
    // Arrange
    const validPlay = {
      type: "play",
      payload: { position: 120, nonce: "random-uuid-here" },
    };

    // Act
    const result = commandSchema.safeParse(validPlay);

    // Assert
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe("play");
      expect((result.data as any).payload.position).toBe(120);
    }
  });

  it("TC-02: Should reject missing or invalid payload", () => {
    // Arrange
    const invalidPlay = {
      type: "play",
      payload: { pos: 120 }, // Missing 'position'
    };

    // Act
    const result = commandSchema.safeParse(invalidPlay);

    // Assert
    expect(result.success).toBe(false);
  });

  it("TC-03: Should validate update_rate boundary limits", () => {
    // Arrange & Act & Assert
    const validRate = { type: "update_rate", payload: { rate: 2.0 } };
    expect(commandSchema.safeParse(validRate).success).toBe(true);

    const extremelyFastRate = { type: "update_rate", payload: { rate: 10.0 } }; // Max is 4.0
    expect(commandSchema.safeParse(extremelyFastRate).success).toBe(false);

    const negativeRate = { type: "update_rate", payload: { rate: -1.0 } }; // Min is 0.25
    expect(commandSchema.safeParse(negativeRate).success).toBe(false);
  });

  it("TC-04: Should strip unexpected attributes via strict typing on fast-path", () => {
    // Arrange
    const playWithGarbage = {
      type: "play",
      payload: { position: 120, malicious: "DROP TABLE rooms", nonce: "uuid" },
    };

    // Act
    const result = commandSchema.safeParse(playWithGarbage);

    // Assert
    expect(result.success).toBe(true);
    if (result.success) {
      // Because we didn't use `passthrough()` on 'play', the `malicious` key should be stripped
      expect((result.data as any).payload).not.toHaveProperty("malicious");
      expect((result.data as any).payload.position).toBe(120);
    }
  });

  it("TC-05: Should allow passthrough for add_item to cover unknown providers", () => {
    // Arrange
    const addItemCommand = {
      type: "add_item",
      payload: {
        url: "http://example.com/video.mp4",
        customField: "customData",
      },
    };

    const result = commandSchema.safeParse(addItemCommand);
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data as any).payload).toHaveProperty("customField");
    }
  });

  it("TC-06: Should validate legacy events with proper schemas", () => {
    // update_duration requires mediaId (uuid) and duration (number >= 0)
    const updateDuration = {
      type: "update_duration",
      payload: {
        mediaId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
        duration: 15.0,
      },
    };
    expect(commandSchema.safeParse(updateDuration).success).toBe(true);

    // Should reject update_duration without mediaId
    const badDuration = {
      type: "update_duration",
      payload: { duration: 15.0 },
    };
    expect(commandSchema.safeParse(badDuration).success).toBe(false);

    // update_room_name requires name string (1-100 chars)
    const updateName = {
      type: "update_room_name",
      payload: { name: "New Room" },
    };
    expect(commandSchema.safeParse(updateName).success).toBe(true);

    // update_nickname requires nickname string (1-50 chars)
    const updateNick = {
      type: "update_nickname",
      payload: { nickname: "NewNick" },
    };
    expect(commandSchema.safeParse(updateNick).success).toBe(true);

    // update_role requires targetParticipantId and role enum
    const updateRole = {
      type: "update_role",
      payload: { targetParticipantId: "user-123", role: "moderator" },
    };
    expect(commandSchema.safeParse(updateRole).success).toBe(true);

    // Should reject invalid role values
    const badRole = {
      type: "update_role",
      payload: { targetParticipantId: "user-123", role: "admin" },
    };
    expect(commandSchema.safeParse(badRole).success).toBe(false);

    // claim_host can have empty/optional payload
    const claimHost = { type: "claim_host", payload: {} };
    expect(commandSchema.safeParse(claimHost).success).toBe(true);

    // kick_participant requires targetParticipantId
    const kick = {
      type: "kick_participant",
      payload: { targetParticipantId: "user-456" },
    };
    expect(commandSchema.safeParse(kick).success).toBe(true);
  });
});
