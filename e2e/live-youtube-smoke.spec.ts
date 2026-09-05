import { expect, Page, test } from "@playwright/test";
import {
  closeRoomClients,
  createIsolatedBrowserContext,
  createRoomClients,
  expectPeopleCount,
  expectReconnected,
  initializeProviderGesture,
  installDeterministicMedia,
  joinRoom,
  renameParticipantAndExpect,
} from "./helpers/room";
import {
  NetworkEmulationHandle,
  pulseOffline,
  setLatency,
} from "./helpers/network";

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
    let degradedNetwork: NetworkEmulationHandle | undefined;

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

      await playYouTube(owner);
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
          expect(syncwatchPlayControl(page)).toBeVisible({
            timeout: 30_000,
          }),
        ),
      );

      await playYouTube(owner);
      await Promise.all(
        room.clients.map(({ page }) =>
          expect(youtubeControl(page, /^Pause/)).toBeVisible({
            timeout: 30_000,
          }),
        ),
      );
      const beforeSeek = await youtubePosition(owner);
      const moviePlayer = owner
        .frameLocator("iframe")
        .first()
        .locator("#movie_player");
      for (let step = 0; step < 10; step += 1) {
        await moviePlayer.press("ArrowRight");
      }
      await expect
        .poll(() => youtubePosition(owner), { timeout: 30_000 })
        .toBeGreaterThan(beforeSeek + 40);
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

      const lateContext = await createIsolatedBrowserContext(browser);
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

      degradedNetwork = await setLatency(room.clients[1].page, 1_500);
      const healthyBefore = await youtubePosition(owner);
      await pulseOffline(room.clients[2].context, 1_500);
      await expectReconnected(
        room.clients[2].page,
        async () => {
          await renameParticipantAndExpect(
            room.clients[2],
            owner,
            "Friend 3 Reconnected",
          );
        },
        30_000,
      );
      await expect(youtubeControl(owner, /^Pause/)).toBeVisible();
      await expect(youtubeControl(latePage, /^Pause/)).toBeVisible();
      await expect
        .poll(
          async () =>
            Math.abs(
              (await youtubePosition(room.clients[2].page)) -
                (await youtubePosition(owner)),
            ),
          { timeout: 45_000 },
        )
        .toBeLessThan(6);
      const recoveredBefore = await youtubePosition(room.clients[2].page);
      await expect
        .poll(() => youtubePosition(room.clients[2].page), {
          timeout: 30_000,
        })
        .toBeGreaterThan(recoveredBefore + 1);
      await expect
        .poll(() => youtubePosition(owner), { timeout: 30_000 })
        .toBeGreaterThan(healthyBefore + 1);
    } finally {
      await degradedNetwork?.resetAndDispose();
      await closeRoomClients(room.clients);
    }
  });
});

function youtubeControl(page: Page, name: RegExp) {
  return page.frameLocator("iframe").first().getByRole("button", { name });
}

function syncwatchPlayControl(page: Page) {
  return page
    .getByTestId("player-interaction-layer")
    .getByRole("button", { name: "Play", exact: true });
}

async function playYouTube(page: Page) {
  await syncwatchPlayControl(page).click();
}

async function youtubePosition(page: Page) {
  const moviePlayer = page
    .frameLocator("iframe")
    .first()
    .locator("#movie_player");
  await expect(moviePlayer).toBeAttached({ timeout: 30_000 });
  return moviePlayer.evaluate((element) => {
    const player = element as HTMLElement & {
      getCurrentTime?: () => number;
    };
    const position = player.getCurrentTime?.();
    if (typeof position !== "number" || !Number.isFinite(position)) {
      throw new Error(
        "YouTube player API did not expose a finite current time",
      );
    }
    return position;
  });
}
