import { test, expect } from "@playwright/test";
import { getTestRoomUrl, joinRoom } from "./helpers/room";

test.describe("SyncWatch Player E2E Regressions", () => {
  // Use a predictable room URL for tests that don't need isolation per-test
  const roomUrl = getTestRoomUrl();

  test("1. Basic Connection and UI Mounting", async ({ page }) => {
    await joinRoom(page, roomUrl, "Tester1");
    // Ensure the main UI frames mount
    await expect(page.getByText("Entities").first()).toBeVisible();

    // Check if the add video input is mounted in the Player component
    const input = page.getByPlaceholder("Paste video stream URL...");
    await expect(input).toBeVisible();
  });

  test("2. Volume Slider Native Range Allows Partial Values", async ({
    page,
  }) => {
    await joinRoom(page, getTestRoomUrl(), "VolumeTester");

    // Add a basic video to mount the player
    const urlInput = page.getByPlaceholder("Paste video stream URL...");
    await urlInput.waitFor({ state: "visible" });
    // Intercept and mock the external video URL to prevent DNS resolution errors/flakiness
    await page.route("**/api/metadata*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: "mock-test-id",
          title: "Big Buck Bunny Test",
          provider: "direct",
          duration: 120,
          url: "https://www.w3schools.com/html/mov_bbb.mp4",
        }),
      });
    });

    await urlInput.fill("https://www.w3schools.com/html/mov_bbb.mp4");
    await page.getByRole("button", { name: "Init" }).click();

    // Hover the primary interaction layer to reveal controls
    const interactionLayer = page.locator(".react-player-wrapper").first();
    await interactionLayer.hover({ trial: true, force: true }).catch(() => {});

    const slider = page.getByRole("slider").first();
    await slider.waitFor({ state: "attached", timeout: 15000 });

    const stepAttribute = await slider.getAttribute("step");
    expect(stepAttribute).toBe("any");
  });

  test("3. Multi-user Connection Sync", async ({ browser }) => {
    // Arrange
    const context1 = await browser.newContext();
    const context2 = await browser.newContext();
    const page1 = await context1.newPage();
    const page2 = await context2.newPage();

    const isolatedRoom = getTestRoomUrl();

    // Act
    await joinRoom(page1, isolatedRoom, "Host");
    await joinRoom(page2, isolatedRoom, "Viewer");

    // Assert
    expect(page1.url()).toBe(page2.url());

    await expect(page1.locator('input[value="Host"]').first()).toBeVisible({
      timeout: 15000,
    });
    await expect(page2.locator("text=/Host/i").first()).toBeVisible({
      timeout: 15000,
    });

    await expect(page1.locator("text=/Viewer/i").first()).toBeVisible({
      timeout: 15000,
    });
    await expect(page2.locator('input[value="Viewer"]').first()).toBeVisible({
      timeout: 15000,
    });
  });

  test("4. Playlist Addition and Replication", async ({ browser }) => {
    // Arrange
    const context1 = await browser.newContext();
    const context2 = await browser.newContext();
    const page1 = await context1.newPage();
    const page2 = await context2.newPage();

    const isolatedRoom = getTestRoomUrl();
    await joinRoom(page1, isolatedRoom, "Host");
    await joinRoom(page2, isolatedRoom, "Viewer");

    const mockYoutubeApi = async (route: any) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          videos: [
            {
              title: "Mocked Sync Video",
              provider: "youtube",
              duration: 120,
              thumbnail: "",
              url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
              author: "MockAuthor",
            },
          ],
        }),
      });
    };

    await page1.route("**/api/youtube/search*", mockYoutubeApi);
    await page2.route("**/api/youtube/search*", mockYoutubeApi);

    // Act
    await page1.getByRole("button", { name: /Queue/i }).click();

    const urlInput = page1.getByPlaceholder("Paste video stream URL...");
    await urlInput.waitFor({ state: "visible" });
    await urlInput.fill("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    await page1.getByRole("button", { name: "Init" }).click();

    await page2.getByRole("button", { name: /Queue/i }).click();

    // Assert
    await expect(page2.locator("text=Mocked Sync Video")).toBeVisible({
      timeout: 30000,
    });
  });
});
