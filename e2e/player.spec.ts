import { expect, test } from "@playwright/test";
import {
  addDeterministicMedia,
  installDeterministicMedia,
  joinRoom,
} from "./helpers/room";

test.describe.configure({ mode: "serial" });

test.describe("room player UI regressions", () => {
  test("shows the current People surface and one empty-room composer", async ({
    page,
  }) => {
    const media = await installDeterministicMedia(page);
    try {
      await joinRoom(page, `player-${crypto.randomUUID()}`, "Player Tester");
      await expect(
        page.getByRole("button", { name: "People (1)" }),
      ).toBeVisible();
      await expect(
        page.getByRole("textbox", { name: "YouTube URL or search" }),
      ).toHaveCount(1);
    } finally {
      media.resume();
    }
  });

  test("keeps the native volume slider continuous for deterministic media", async ({
    context,
    page,
  }) => {
    const media = await installDeterministicMedia(page);
    const client = { context, page, nickname: "Volume Tester", media };
    try {
      await joinRoom(page, `volume-${crypto.randomUUID()}`, client.nickname);
      await addDeterministicMedia(client);
      await expect(
        page.getByRole("slider", { name: "Volume slider" }),
      ).toHaveAttribute("step", "any");
    } finally {
      media.resume();
    }
  });
});
