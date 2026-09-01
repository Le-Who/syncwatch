import { describe, expect, it } from "vitest";
import { commandNonceSchema } from "../command-nonce";

describe("command nonce scalar contract", () => {
  it.each([
    "01890f3e-4c4d-7cc2-8d8c-123456789301",
    "01890f3e-4c4d-8cc2-8d8c-123456789301",
    "00000000-0000-0000-0000-000000000000",
  ])("accepts authoritative UUID form %s", (nonce) => {
    expect(commandNonceSchema.safeParse(nonce)).toMatchObject({
      success: true,
      data: nonce,
    });
  });

  it.each(["", "not-a-uuid", 42, null])("rejects invalid nonce %j", (nonce) => {
    expect(commandNonceSchema.safeParse(nonce).success).toBe(false);
  });
});
