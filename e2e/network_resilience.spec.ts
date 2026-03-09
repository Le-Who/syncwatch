import { test, expect } from "@playwright/test";
import { getTestRoomUrl, joinRoom } from "./helpers/room";

test.describe("Network Resilience (TC-302)", () => {
  test("Client TCP drops securely reconnect and preserve room entity presence", async ({
    page,
  }) => {
    const roomUrl = getTestRoomUrl();
    await joinRoom(page, roomUrl, "DropoutUser");

    await expect(
      page.locator('input[value="DropoutUser"]').first(),
    ).toBeVisible({ timeout: 15000 });

    // Emulate browser physical network drop via Playwright native API
    // This is much more accurate than window.dispatchEvent as it drops all active WebSockets
    const context = page.context();
    await context.setOffline(true);

    // Give it a moment to realize it's disconnected
    await page.waitForTimeout(2000);

    // Emulate network restoration
    await context.setOffline(false);

    // Verify user presence is maintained in UI (Didn't vanish from Entities list)
    // Actually the reconnect logic in socket.ts triggers `join_room` implicitly
    await expect(
      page.locator('input[value="DropoutUser"]').first(),
    ).toBeVisible({ timeout: 15000 });
  });
});
