import { expect, Page, test } from "@playwright/test";
import {
  closeRoomClients,
  createRoomClients,
  expectPeopleCount,
  expectReconnected,
  initializeProviderGesture,
  installDeterministicMedia,
  joinRoom,
} from "./helpers/room";
import { pulseOffline, setLatency } from "./helpers/network";

const LIVE_YOUTUBE_URL = "https://www.youtube.com/watch?v=M7lc1UVf-VE";

test.describe.configure({ mode: "serial" });
test.describe("live YouTube provider smoke", () => {
  test.skip(
    process.env.LIVE_YOUTUBE_SMOKE !== "1",
    "Set LIVE_YOUTUBE_SMOKE=1 and run headed to exercise real YouTube.",
  );

  test("add, play, pause, seek, reconnect, late join, and degraded continuation", async ({
    browser,
  }) => {
    test.setTimeout(180_000);
    const room = await createRoomClients(browser, 3);

    try {
      const owner = room.clients[0].page;
      await owner.getByRole("button", { name: /^Queue$/ }).click();
      await owner
        .getByRole("textbox", { name: "YouTube URL or search" })
        .fill(LIVE_YOUTUBE_URL);
      await owner.getByRole("button", { name: "Add media" }).click();

      await Promise.all(
        room.clients.map(async (client) => {
          await expect(client.page.locator("iframe")).toBeAttached({
            timeout: 45_000,
          });
          await initializeProviderGesture(client);
        }),
      );

      await youtubeControl(owner, /^Play/).click();
      await Promise.all(
        room.clients.map(({ page }) =>
          expect(youtubeControl(page, /^Pause/)).toBeVisible({
            timeout: 30_000,
          }),
        ),
      );

      await youtubeControl(room.clients[1].page, /^Pause/).click();
      await Promise.all(
        room.clients.map(({ page }) =>
          expect(youtubeControl(page, /^Play/)).toBeVisible({
            timeout: 30_000,
          }),
        ),
      );

      await youtubeControl(owner, /^Play/).click();
      const beforeSeek = await youtubePosition(owner);
      await owner
        .frameLocator("iframe")
        .first()
        .locator("#movie_player")
        .press("ArrowRight");
      await expect
        .poll(() => youtubePosition(owner), { timeout: 30_000 })
        .toBeGreaterThan(beforeSeek + 3);
      const ownerAfterSeek = await youtubePosition(owner);
      await Promise.all(
        room.clients.slice(1).map(async ({ page }) => {
          await expect(youtubeControl(page, /^Pause/)).toBeVisible({
            timeout: 30_000,
          });
          await expect
            .poll(
              async () =>
                Math.abs((await youtubePosition(page)) - ownerAfterSeek),
              {
                timeout: 30_000,
              },
            )
            .toBeLessThan(6);
        }),
      );

      const lateContext = await browser.newContext();
      const latePage = await lateContext.newPage();
      const lateMedia = await installDeterministicMedia(latePage);
      const lateClient = {
        context: lateContext,
        page: latePage,
        nickname: "YouTube Late Friend",
        media: lateMedia,
      };
      room.clients.push(lateClient);
      await joinRoom(latePage, room.roomId, lateClient.nickname);
      await initializeProviderGesture(lateClient);
      await expectPeopleCount(latePage, 4);
      await expect(youtubeControl(latePage, /^Pause/)).toBeVisible({
        timeout: 45_000,
      });
      await expect
        .poll(
          async () =>
            Math.abs(
              (await youtubePosition(latePage)) -
                (await youtubePosition(owner)),
            ),
          { timeout: 45_000 },
        )
        .toBeLessThan(6);

      await setLatency(room.clients[1].page, 1_500);
      const healthyBefore = await youtubePosition(owner);
      await pulseOffline(room.clients[2].context, 1_500);
      await expectReconnected(room.clients[2].page, 30_000);
      await expect(youtubeControl(owner, /^Pause/)).toBeVisible();
      await expect(youtubeControl(latePage, /^Pause/)).toBeVisible();
      await expect
        .poll(() => youtubePosition(owner), { timeout: 30_000 })
        .toBeGreaterThan(healthyBefore + 1);
    } finally {
      await closeRoomClients(room.clients);
    }
  });
});

function youtubeControl(page: Page, name: RegExp) {
  return page.frameLocator("iframe").first().getByRole("button", { name });
}

async function youtubePosition(page: Page) {
  const value =
    (await page
      .frameLocator("iframe")
      .first()
      .locator(".ytp-time-current")
      .textContent()) ?? "0:00";
  return value
    .split(":")
    .reduce((seconds, segment) => seconds * 60 + Number(segment), 0);
}
