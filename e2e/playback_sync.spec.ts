import { test, expect, Page } from "@playwright/test";
import { randomUUID } from "node:crypto";

function getTestRoomUrl() {
  return `/room/e2e-sync-${randomUUID().slice(0, 8)}`;
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
}

test.describe("Playback Sync & Drift Catchup (TC-301)", () => {
  test("Host seek updates Viewer's time correctly", async ({ browser }) => {
    const context1 = await browser.newContext();
    const context2 = await browser.newContext();
    const hostPage = await context1.newPage();
    const viewerPage = await context2.newPage();

    const roomUrl = getTestRoomUrl();
    await joinRoom(hostPage, roomUrl, "Host");
    await joinRoom(viewerPage, roomUrl, "Viewer");

    const mockYoutubeApi = async (route: any) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          videos: [
            {
              title: "Mocked Sync Video",
              provider: "raw",
              duration: 120,
              thumbnail: "",
              url: "http://localhost/mock.mp4",
              author: "MockAuthor",
            },
          ],
        }),
      });
    };
    await hostPage.route("**/api/youtube/search*", mockYoutubeApi);
    await viewerPage.route("**/api/youtube/search*", mockYoutubeApi);

    const mockMp4Stream = async (route: any) => {
      await route.fulfill({
        status: 200,
        contentType: "video/mp4",
        body: Buffer.from("mock video content"),
      });
    };
    await hostPage.route("http://localhost/mock.mp4", mockMp4Stream);
    await viewerPage.route("http://localhost/mock.mp4", mockMp4Stream);

    await hostPage.locator("button", { hasText: /Queue/i }).click();
    const urlInput = hostPage.locator(
      'input[placeholder="Paste video stream URL..."]',
    );
    await urlInput.waitFor({ state: "visible" });
    await urlInput.fill("http://localhost/mock.mp4");
    await hostPage.locator("button", { hasText: "Init" }).click();

    const hostVideo = hostPage.locator("video").first();
    const viewerVideo = viewerPage.locator("video").first();

    await hostVideo.waitFor({ state: "attached", timeout: 15000 });
    await viewerVideo.waitFor({ state: "attached", timeout: 15000 });

    // Host performs a seek
    await hostVideo.evaluate((vid: HTMLVideoElement) => {
      vid.currentTime = 50;
      vid.dispatchEvent(new Event("seeked"));
    });

    // We verify the viewer's currentTime jumps to ~50
    // Because the server processes the seek and emits room_state to Viewer
    await expect(async () => {
      const viewerTime = await viewerVideo.evaluate(
        (vid: HTMLVideoElement) => vid.currentTime,
      );
      expect(viewerTime).toBeGreaterThanOrEqual(49);
      expect(viewerTime).toBeLessThanOrEqual(52);
    }).toPass({ timeout: 15000 });
  });
});
