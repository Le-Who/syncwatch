import { test, expect } from "@playwright/test";
import { getTestRoomUrl, joinRoom } from "./helpers/room";

test.describe("Playback Sync & Drift Catchup (TC-301)", () => {
  test("Host playback naturally syncs to Viewer's React state", async ({
    browser,
  }) => {
    test.setTimeout(60000);

    // ==========================================
    // ARRANGE: Environment, Mocks, and Setup
    // ==========================================
    const context1 = await browser.newContext();
    const context2 = await browser.newContext();
    const hostPage = await context1.newPage();
    const viewerPage = await context2.newPage();

    const roomUrl = getTestRoomUrl();

    // Mock API to return predictable metadata and prevent network flakes
    const mockMetadataApi = async (route: any) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          title: "Mocked Sync Video",
          thumbnail: "",
        }),
      });
    };
    await hostPage.route("**/api/metadata*", mockMetadataApi);
    await viewerPage.route("**/api/metadata*", mockMetadataApi);

    // Join room sequentially to avoid locking thrashing
    await joinRoom(hostPage, roomUrl, "Host");
    await expect(hostPage.locator("input[value='Host']").first()).toBeVisible();

    await joinRoom(viewerPage, roomUrl, "Viewer");
    await expect(
      viewerPage.locator("input[value='Viewer']").first(),
    ).toBeVisible();

    // Queue Video as Host
    const testVideoUrl = "https://www.w3schools.com/html/mov_bbb.mp4";
    await hostPage.locator("button", { hasText: /Queue/i }).click();
    const urlInput = hostPage.locator(
      'input[placeholder="Paste video stream URL..."]',
    );
    await urlInput.waitFor({ state: "visible" });
    await urlInput.fill(testVideoUrl);
    await hostPage.locator("button", { hasText: "Init" }).click();

    // Wait for Playlist UI updates
    await expect(
      hostPage.locator("text=Mocked Sync Video").first(),
    ).toBeVisible();

    // Wait for Video DOM attachment
    const hostVideo = hostPage.locator("video").first();
    const viewerVideo = viewerPage.locator("video").first();
    await hostVideo.waitFor({ state: "attached" });
    await viewerVideo.waitFor({ state: "attached" });

    // Ensure DOM Videos are ready with loaded metadata
    await expect(async () => {
      const dur = await hostVideo.evaluate(
        (vid: HTMLVideoElement) => vid.duration,
      );
      expect(dur).toBeGreaterThan(0);
      expect(Number.isNaN(dur)).toBe(false);
    }).toPass({ timeout: 15000 });

    // Dismiss Initial Gesture Guard
    await hostPage
      .getByRole("button", { name: /Initialize Stream Sync/i })
      .click();
    await viewerPage
      .getByRole("button", { name: /Initialize Stream Sync/i })
      .click();

    // Ensure Zustand store internal playback state is fully initialized as 'paused' before testing mutations
    await expect(async () => {
      const status = await hostPage.evaluate(
        () => (window as any).__store?.getState().room?.playback?.status,
      );
      expect(status).toBe("paused");
    }).toPass({ timeout: 15000 });

    // ==========================================
    // ACT: Apply one single logical action
    // ==========================================
    // Host simulates clicking Play on the video interaction layer
    const playerWrapper = hostPage
      .getByTestId("player-interaction-layer")
      .first();
    await playerWrapper.click({ force: true });

    // ==========================================
    // ASSERT: Verify specific behavioral outcomes
    // ==========================================
    // 1. Host should internally register 'playing'
    await expect(async () => {
      const hostStatus = await hostPage.evaluate(
        () => (window as any).__store.getState().room?.playback?.status,
      );
      expect(hostStatus).toBe("playing");
    }).toPass({ timeout: 10000 });

    // 2. Viewer should synchronize to 'playing'
    await expect(async () => {
      const viewerStatus = await viewerPage.evaluate(
        () => (window as any).__store.getState().room?.playback?.status,
      );
      expect(viewerStatus).toBe("playing");
    }).toPass({ timeout: 10000 });
  });
});
