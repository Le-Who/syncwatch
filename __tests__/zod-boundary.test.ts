import { describe, it, expect } from "vitest";
import { commandSchema } from "../lib/zod-schemas";

describe("Websocket Zod Security Boundary", () => {
  it("TC-03: Should parse valid fast-path play command", () => {
    const validPlay = {
      type: "play",
      payload: { position: 120, nonce: "random-uuid-here" },
    };

    const result = commandSchema.safeParse(validPlay);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe("play");
      expect((result.data as any).payload.position).toBe(120);
    }
  });

  it("TC-03: Should reject missing or invalid payload", () => {
    const invalidPlay = {
      type: "play",
      payload: { pos: 120 }, // Missing 'position'
    };

    const result = commandSchema.safeParse(invalidPlay);
    expect(result.success).toBe(false);
  });

  it("TC-04: Should validate update_rate boundary limits", () => {
    const validRate = { type: "update_rate", payload: { rate: 2.0 } };
    expect(commandSchema.safeParse(validRate).success).toBe(true);

    const extremelyFastRate = { type: "update_rate", payload: { rate: 10.0 } }; // Max is 4.0
    expect(commandSchema.safeParse(extremelyFastRate).success).toBe(false);

    const negativeRate = { type: "update_rate", payload: { rate: -1.0 } }; // Min is 0.25
    expect(commandSchema.safeParse(negativeRate).success).toBe(false);
  });

  it("TC-03: Should strip unexpected attributes via strict typing on fast-path", () => {
    const playWithGarbage = {
      type: "play",
      payload: { position: 120, malicious: "DROP TABLE rooms", nonce: "uuid" },
    };

    const result = commandSchema.safeParse(playWithGarbage);
    expect(result.success).toBe(true);
    if (result.success) {
      // Because we didn't use `passthrough()` on 'play', the `malicious` key should be stripped
      expect((result.data as any).payload).not.toHaveProperty("malicious");
      expect((result.data as any).payload.position).toBe(120);
    }
  });

  it("TC-03: Should allow passthrough for add_item to cover unknown providers", () => {
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

  it("TC-04: Should validate legacy events gracefully", () => {
    const updateDuration = {
      type: "update_duration",
      payload: { duration: 15.0 },
    };
    const result = commandSchema.safeParse(updateDuration);
    expect(result.success).toBe(true);
  });
});
