import { expect, test, type Page } from "@playwright/test";
import {
  createIsolatedBrowserContext,
  expectPeopleCount,
  getTestRoomUrl,
  joinRoom,
  participantCard,
} from "./helpers/room";
import { pulseOffline } from "./helpers/network";

function pollingHandshake(page: Page) {
  return page.waitForResponse((response) => {
    const { pathname, searchParams } = new URL(response.url());
    return (
      pathname === "/socket.io/" &&
      searchParams.get("transport") === "polling" &&
      !searchParams.has("sid") &&
      response.ok()
    );
  });
}

function socketUpgrade(page: Page) {
  return page.waitForEvent("websocket", (socket) => {
    const { pathname, searchParams } = new URL(socket.url());
    return pathname === "/socket.io/" && searchParams.has("sid");
  });
}

for (const upgradePolicy of ["reject", "hold"]) {
  test(`joins and reconnects with a session cookie when WebSocket upgrades ${upgradePolicy}`, async ({
    browser,
  }) => {
    test.setTimeout(60_000);
    const context = await createIsolatedBrowserContext(browser, {
      extraHTTPHeaders: { "x-syncwatch-e2e-polling-only": upgradePolicy },
    });
    const observerContext = await createIsolatedBrowserContext(browser);

    try {
      const room = getTestRoomUrl();
      const page = await context.newPage();
      const observer = await observerContext.newPage();
      let blockedUpgradeCompleted = false;
      const watchBlockedUpgrade = () =>
        socketUpgrade(page).then((socket) => {
          socket.on("framesent", ({ payload }) => {
            if (payload === "5") blockedUpgradeCompleted = true;
          });
          if (upgradePolicy === "reject") {
            return new Promise<void>((resolve) => {
              socket.once("socketerror", () => resolve());
            });
          }
        });
      const firstHandshake = pollingHandshake(page);
      const stoppedUpgrade = watchBlockedUpgrade();
      const session = page.waitForResponse(
        (response) => new URL(response.url()).pathname === "/api/auth/session",
      );
      await joinRoom(page, room, "Polling Friend");
      const pollingHeaders = await (await firstHandshake)
        .request()
        .allHeaders();
      expect(pollingHeaders.origin).toBeUndefined();
      expect(pollingHeaders["sec-fetch-site"]).toBe("same-origin");
      await stoppedUpgrade;
      const response = await session;
      const { participantId } = await response.json();
      expect(await response.json()).not.toHaveProperty("token");
      expect(await context.cookies(page.url())).toContainEqual(
        expect.objectContaining({ name: "syncwatch_session", httpOnly: true }),
      );
      const normalUpgrade = socketUpgrade(observer).then((socket) =>
        socket.waitForEvent("framesent", ({ payload }) => payload === "5"),
      );
      await joinRoom(observer, room, "Observer");
      await normalUpgrade;
      await expectPeopleCount(page, 2);
      await expectPeopleCount(observer, 2);

      const nextHandshake = pollingHandshake(page);
      const nextUpgrade = watchBlockedUpgrade();
      await pulseOffline(context, 1_500);
      await nextHandshake;
      await nextUpgrade;
      await expectPeopleCount(page, 2);
      await expectPeopleCount(observer, 2);
      const nickname = page.getByRole("textbox", { name: "Your nickname" });
      await nickname.fill("Polling Friend Reconnected");
      await nickname.press("Enter");
      await expect(
        participantCard(observer, "Polling Friend Reconnected"),
      ).toBeVisible();
      expect(
        await page.evaluate(() => localStorage.getItem("participantId")),
      ).toBe(participantId);
      expect(blockedUpgradeCompleted).toBe(false);
    } finally {
      await Promise.all([context.close(), observerContext.close()]);
    }
  });
}
