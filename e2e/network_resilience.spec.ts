import { test, expect, Page } from "@playwright/test";
import { randomUUID } from "node:crypto";

function getTestRoomUrl() {
  return `/room/e2e-net-${randomUUID().slice(0, 8)}`;
}

async function joinRoom(page: Page, url: string, nickname: string) {
  await page.goto(url);
  const handleInput = page.locator('input[placeholder="ENTER_HANDLE"]');
  await handleInput.waitFor({ state: "visible", timeout: 15000 });
  await handleInput.fill(nickname);

  await page.locator("button", { hasText: "Establish Link" }).click();
  await expect(page.locator("text=SyncWatch").first()).toBeVisible({
    timeout: 15000,
  });
  await page.locator("button", { hasText: /Entities/i }).click();
}

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
