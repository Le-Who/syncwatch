import { describe, expect, it } from "vitest";
import { roomCommandEnvelopeSchema } from "../lib/room-command-contract";

describe("room command envelope", () => {
  it("accepts a bounded command bound to one room", () => {
    expect(
      roomCommandEnvelopeSchema.parse({
        roomId: crypto.randomUUID(),
        nonce: crypto.randomUUID(),
        clientSequence: 7,
        command: { type: "play", payload: { position: 12.5 } },
      }).command.type,
    ).toBe("play");
  });

  it("rejects an oversized room id", () => {
    expect(() =>
      roomCommandEnvelopeSchema.parse({
        roomId: "x".repeat(129),
        nonce: crypto.randomUUID(),
        clientSequence: 1,
        command: { type: "pause", payload: { position: 0 } },
      }),
    ).toThrow();
  });
});
