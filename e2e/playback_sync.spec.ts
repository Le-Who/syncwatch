import { test, expect } from "@playwright/test";
import { getTestRoomUrl, joinRoom } from "./helpers/room";

test.describe("Playback Sync & Drift Catchup (TC-301)", () => {
  test("Host playback naturally syncs to Viewer's React state", async ({
    browser,
  }) => {
    test.setTimeout(60000);
    // ==========================================
    // ARRANGE: Setup browsers, join room, and mock API
    // ==========================================
    const context1 = await browser.newContext();
    const context2 = await browser.newContext();
    const hostPage = await context1.newPage();
    const viewerPage = await context2.newPage();

    const roomUrl = getTestRoomUrl();
    await joinRoom(hostPage, roomUrl, "Host");

    // Prevent Socket.io room creation race conditions by polling for Host to be fully joined
    await expect(hostPage.locator("input[value='Host']").first()).toBeVisible({
      timeout: 15000,
    });

    await joinRoom(viewerPage, roomUrl, "Viewer");
    await expect(
      viewerPage.locator("input[value='Viewer']").first(),
    ).toBeVisible({
      timeout: 15000,
    });

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
    ).toBeVisible({ timeout: 15000 });

    // Now wait for the video DOM elements to attach (Player component mounting)
    const hostVideo = hostPage.locator("video").first();
    const viewerVideo = viewerPage.locator("video").first();

    await hostVideo.waitFor({ state: "attached", timeout: 15000 });
    await viewerVideo.waitFor({ state: "attached", timeout: 15000 });

    // Ensure video has successfully mapped metadata duration before interacting
    await expect(async () => {
      const dur = await hostVideo.evaluate(
        (vid: HTMLVideoElement) => vid.duration,
      );
      expect(dur).toBeGreaterThan(0);
      expect(Number.isNaN(dur)).toBe(false);
    }).toPass({ timeout: 15000 });

    // Dismiss the Autoplay "User Gesture Guard" overlay for both explicitly
    await hostPage
      .getByRole("button", { name: /Initialize Stream Sync/i })
      .click();
    await viewerPage
      .getByRole("button", { name: /Initialize Stream Sync/i })
      .click();

    // Wait for the initial loading "intent mask" to clear by asserting underlying playback store readiness
    await expect(async () => {
      const status = await hostPage.evaluate(
        () => (window as any).__store?.getState().room?.playback?.status,
      );
      expect(status).not.toBeUndefined(); // Store should be fully materialized
    }).toPass({ timeout: 15000 });

    // Ensure state is ready for interaction
    await hostPage.waitForFunction(
      () => {
        const state = (window as any).__store?.getState();
        return state?.room?.playback?.status !== undefined;
      },
      { timeout: 15000 },
    );

    // ==========================================
    // ACT: Host simulates playing the video
    // ==========================================
    const playerWrapper = hostPage
      .getByTestId("player-interaction-layer")
      .first();
    await playerWrapper.hover({ force: true }).catch(() => {});
    await playerWrapper.click({ force: true });

    // ==========================================
    // ASSERT: Both Host and Viewer correctly derive Playback state explicitly
    // ==========================================
    await expect(async () => {
      const hostStatus = await hostPage.evaluate(
        () => (window as any).__store.getState().room?.playback?.status,
      );
      expect(hostStatus).toBe("playing");
    }).toPass({ timeout: 15000 });

    await expect(async () => {
      const viewerStatus = await viewerPage.evaluate(
        () => (window as any).__store.getState().room?.playback?.status,
      );
      expect(viewerStatus).toBe("playing");
    }).toPass({ timeout: 15000 });
  });
});
