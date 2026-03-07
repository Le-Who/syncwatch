import { test, expect, Page } from "@playwright/test";
import { randomUUID } from "node:crypto";

function getTestRoomUrl() {
  return `/room/e2e-${randomUUID().slice(0, 8)}`;
}

async function joinRoom(page: Page, url: string, nickname: string) {
  await page.goto(url);
  const handleInput = page.locator('input[placeholder="ENTER_HANDLE"]');
  await handleInput.waitFor({ state: "visible", timeout: 15000 });
  await handleInput.fill(nickname);
  await page.locator("button", { hasText: "Establish Link" }).click();
}

test.describe("SyncWatch Player E2E Regressions", () => {
  // Use a predictable room URL for tests that don't need isolation per-test
  const roomUrl = getTestRoomUrl();

  test("1. Basic Connection and UI Mounting", async ({ page }) => {
    await joinRoom(page, roomUrl, "Tester1");
    // Ensure the main UI frames mount
    await expect(page.locator("text=SyncWatch")).toBeVisible();
    await expect(page.locator("text=Entities")).toBeVisible();

    // Check if the add video input is mounted in the Player component
    const input = page.locator(
      'input[placeholder="Paste video stream URL..."]',
    );
    await expect(input).toBeVisible();
  });

  test("2. Volume Slider Native Range Allows Partial Values", async ({
    page,
  }) => {
    await joinRoom(page, getTestRoomUrl(), "VolumeTester");

    // Add a basic video to mount the player
    const urlInput = page.locator(
      'input[placeholder="Paste video stream URL..."]',
    );
    await urlInput.waitFor({ state: "visible" });
    await urlInput.fill("https://www.w3schools.com/html/mov_bbb.mp4");
    await page.locator("button", { hasText: "Init" }).click();

    // Hover the primary interaction layer to reveal controls
    const interactionLayer = page.locator(".react-player-wrapper").first();
    await interactionLayer.hover({ trial: true, force: true }).catch(() => {});

    const slider = page.locator('input[type="range"]').first();
    await slider.waitFor({ state: "attached", timeout: 15000 });

    const stepAttribute = await slider.getAttribute("step");
    expect(stepAttribute).toBe("any");
  });

  // Note: We skip the heavy multi-page orchestration tests if they fail frequently in CI
  // due to WebSocket CORS blocks or IP limitations on GitHub Actions / Vercel.
  // We write them out for local development loops when NextServer is reachable.
  test("3. Multi-user Connection Sync", async ({ browser }) => {
    const context1 = await browser.newContext();
    const context2 = await browser.newContext();
    const page1 = await context1.newPage();
    const page2 = await context2.newPage();

    const isolatedRoom = getTestRoomUrl();
    await joinRoom(page1, isolatedRoom, "Host");
    await joinRoom(page2, isolatedRoom, "Viewer");

    // Ensure both landed on the same page
    expect(page1.url()).toBe(page2.url());

    // Check if both users appear in the participant list
    await expect(page1.locator("text=Host")).toBeVisible();
    await expect(page1.locator("text=Viewer")).toBeVisible();
    await expect(page2.locator("text=Host")).toBeVisible();
    await expect(page2.locator("text=Viewer")).toBeVisible();
  });
});
