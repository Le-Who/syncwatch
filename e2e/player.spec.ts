import { test, expect, Page } from "@playwright/test";
import { randomUUID } from "node:crypto";

function getTestRoomUrl() {
  return `/room/e2e-${randomUUID().slice(0, 8)}`;
}

async function joinRoom(page: Page, url: string, nickname: string) {
  await page.goto(url);
  const handleInput = page.getByPlaceholder("ENTER_HANDLE");
  await handleInput.waitFor({ state: "visible", timeout: 15000 });
  await handleInput.fill(nickname);

  await page.getByRole("button", { name: "Establish Link" }).click();
  // Wait for the UI layout to shift from "Join Room" to the main Player UI.
  // This proves the auth POST succeeded and React state transitioned.
  await expect(page.locator("text=SyncWatch").first()).toBeVisible({
    timeout: 15000,
  });

  // Switch to the Participants tab to mount the nickname in the DOM
  await page.getByRole("button", { name: /Entities/i }).click();

  // The most deterministic way to ensure Socket.io has successfully connected
  // and the React state has hydrated the initial Room data is to wait for the
  // "Participants" panel to visibly list the user that just joined.
  // Note: the local user is rendered as an input field, not a text block!
  await expect(page.locator(`input[value="${nickname}"]`).first()).toBeVisible({
    timeout: 15000,
  });
}

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
    await page.route(
      "https://www.w3schools.com/html/mov_bbb.mp4*",
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "video/mp4",
          body: Buffer.from("mock video content"),
        });
      },
    );

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

  // Unskipped and stabilized using explicit waiting strategies
  test("3. Multi-user Connection Sync and Playlist Replication", async ({
    browser,
  }) => {
    const context1 = await browser.newContext();
    const context2 = await browser.newContext();
    const page1 = await context1.newPage();
    const page2 = await context2.newPage();

    const isolatedRoom = getTestRoomUrl();
    await joinRoom(page1, isolatedRoom, "Host");
    await joinRoom(page2, isolatedRoom, "Viewer");

    // Ensure both landed on the same page
    expect(page1.url()).toBe(page2.url());

    // Check if both users appear in the participant list (Eventual consistency DOM polling)
    // Host is local on page1 (input field), remote on page2 (text)
    await expect(page1.locator('input[value="Host"]').first()).toBeVisible({
      timeout: 15000,
    });
    await expect(page2.locator("text=/Host/i").first()).toBeVisible({
      timeout: 15000,
    });

    // Viewer is remote on page1 (text), local on page2 (input field)
    await expect(page1.locator("text=/Viewer/i").first()).toBeVisible({
      timeout: 15000,
    });
    await expect(page2.locator('input[value="Viewer"]').first()).toBeVisible({
      timeout: 15000,
    });

    // --- Playlist Add & Sync Test ---
    // Switch back to the Queue tab on Host to add a video
    await page1.getByRole("button", { name: /Queue/i }).click();

    // Host adds a video (Using a mocked local endpoint since w3schools video was throwing ECONNREFUSED)
    const urlInput = page1.getByPlaceholder("Paste video stream URL...");
    await urlInput.waitFor({ state: "visible" });

    // Intercept metadata fetching to mock the response on BOTH pages, avoiding actual network requests
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

    await urlInput.fill("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    await page1.getByRole("button", { name: "Init" }).click();

    // Viewer switches to Queue tab to see the replicated playlist
    await page2.getByRole("button", { name: /Queue/i }).click();

    // Viewer immediately checks if the video title replicates into their local DOM flawlessly
    // Note: The Redis Queue worker operates asynchronously, so under heavy test load it may take longer than 15s.
    await expect(page2.locator("text=Mocked Sync Video")).toBeVisible({
      timeout: 30000,
    });
  });
});
