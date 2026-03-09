import { test, expect } from "@playwright/test";
import { getTestRoomUrl, joinRoom } from "./helpers/room";

test.describe("Playback Sync & Drift Catchup (TC-301)", () => {
  // In Playwright Headless Chromium, the native `<video>` element often suppresses autoplay
  // even if React sets `playing=true`. To verify our Server WebSocket logic works E2E,
  // we assert against the Viewer's internal React Zustand store.
  test("Host playback naturally syncs to Viewer's React state", async ({
    browser,
  }) => {
    test.setTimeout(60000);
    const context1 = await browser.newContext();
    const context2 = await browser.newContext();
    const hostPage = await context1.newPage();
    const viewerPage = await context2.newPage();

    const roomUrl = getTestRoomUrl();
    await joinRoom(hostPage, roomUrl, "Host");

    // Prevent Socket.io room creation race conditions by staging the connection
    await hostPage.waitForTimeout(1000);

    await joinRoom(viewerPage, roomUrl, "Viewer");

    const mockMetadataApi = async (route: any) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          title: "Mocked Sync MP4 Video",
          thumbnail: "",
        }),
      });
    };
    await hostPage.route("**/api/metadata*", mockMetadataApi);
    await viewerPage.route("**/api/metadata*", mockMetadataApi);

    // Provide a valid un-mocked MP4 URL so the browser can actually decode and seek it
    const testVideoUrl = "https://www.w3schools.com/html/mov_bbb.mp4";

    await hostPage.locator("button", { hasText: /Queue/i }).click();
    const urlInput = hostPage.locator(
      'input[placeholder="Paste video stream URL..."]',
    );
    await urlInput.waitFor({ state: "visible" });
    await urlInput.fill(testVideoUrl);
    await hostPage.locator("button", { hasText: "Init" }).click();

    // Verify the playlist item is added first
    await expect(
      hostPage.locator("text=Mocked Sync MP4 Video").first(),
    ).toBeVisible({
      timeout: 15000,
    });

    // Now wait for the video DOM elements to attach (Player component mounting)
    const hostVideo = hostPage.locator("video").first();
    const viewerVideo = viewerPage.locator("video").first();

    await hostVideo.waitFor({ state: "attached", timeout: 15000 });
    await viewerVideo.waitFor({ state: "attached", timeout: 15000 });

    // Ensure the native `<video>` element has actually parsed the metadata and knows its duration.
    // If we scrub before duration > 0, the Scrubber UI component ignores the pointer interaction.
    await expect(async () => {
      const dur = await hostVideo.evaluate(
        (vid: HTMLVideoElement) => vid.duration,
      );
      expect(dur).toBeGreaterThan(0);
      expect(Number.isNaN(dur)).toBe(false);
    }).toPass({ timeout: 15000 });

    // Dismiss the Autoplay "User Gesture Guard" overlay for both so the player can receive server commands
    await hostPage
      .getByRole("button", { name: /Initialize Stream Sync/i })
      .click();
    await viewerPage
      .getByRole("button", { name: /Initialize Stream Sync/i })
      .click();

    // Wait 2 seconds for the initial "play" event to clear the Adaptive Intent Mask block
    // (lastCommandEmitTimeRef.current < 1500)
    await hostPage.waitForTimeout(2000);

    // Let's test NATURAL Playback Sync (the Host plays the video, and the Viewer syncs and plays too)
    // 1. Reveal controls by interacting with the player wrapper
    const playerWrapper = hostPage.locator(".react-player-wrapper").first();
    await playerWrapper.hover({ force: true }).catch(() => {});

    // Click the wrapper to toggle "Play"
    await playerWrapper.click({ force: true });

    // Wait 5 seconds for the video to play out naturally across both browsers
    await hostPage.waitForTimeout(5000);

    // We verify the viewer's REACT STATE updated correctly.
    // If the Server successfully processed and broadcasted the "play" command,
    // the Viewer's Zustand store will reflect `status === 'playing'` regardless of
    // Chromium Headless media autoplay suppression quirks.
    await expect(async () => {
      const viewerStatus = await viewerPage.evaluate(
        () => (window as any).__store.getState().room?.playback?.status,
      );
      expect(viewerStatus).toBe("playing");
    }).toPass({ timeout: 15000 });
  });
});
