import { test, expect } from "@playwright/test";
import { getTestRoomUrl, joinRoom } from "./helpers/room";

test.describe("High Latency Network Chaos (TC-303)", () => {
  test("Viewer syncs correctly despite 500ms network latency", async ({
    browser,
  }) => {
    test.setTimeout(60000);

    // ==========================================
    // ARRANGE: Setup browsers, network bounds, and mock API
    // ==========================================
    const context1 = await browser.newContext();
    const context2 = await browser.newContext();
    const hostPage = await context1.newPage();
    const viewerPage = await context2.newPage();

    // Emulate 500ms latency on the viewer's CDP session
    const viewerCdp = await context2.newCDPSession(viewerPage);
    await viewerCdp.send("Network.enable");
    await viewerCdp.send("Network.emulateNetworkConditions", {
      offline: false,
      downloadThroughput: (10 * 1024 * 1024) / 8, // 10 Mbps
      uploadThroughput: (5 * 1024 * 1024) / 8, // 5 Mbps
      latency: 500, // 500ms ping
    });

    const roomUrl = getTestRoomUrl();

    // Mock API to return predictable metadata and prevent network flakes
    const mockMetadataApi = async (route: any) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          title: "Latency Test Video",
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

    // Host queues video
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
      hostPage.locator("text=Latency Test Video").first(),
    ).toBeVisible();

    const hostVideo = hostPage.locator("video").first();
    const viewerVideo = viewerPage.locator("video").first();
    await hostVideo.waitFor({ state: "attached" });
    await viewerVideo.waitFor({ state: "attached" });

    // Validate Media loaded durations explicitly before user gestures
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

    // Ensure state bindings internally recognized initialization
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
    await playerWrapper.click({ force: true });

    // ==========================================
    // ASSERT: Validate the downstream OCC drift calculation behavior bounds
    // ==========================================
    // Wait for Host to reliably broadcast "playing" constraint locally
    await expect(async () => {
      const hostStatus = await hostPage.evaluate(
        () => (window as any).__store.getState().room?.playback?.status,
      );
      expect(hostStatus).toBe("playing");
    }).toPass({ timeout: 10000 });

    // Despite massive 500ms network RTT and occ version mismatch padding, viewer resolves correctly
    await expect(async () => {
      const viewerStatus = await viewerPage.evaluate(
        () => (window as any).__store.getState().room?.playback?.status,
      );
      expect(viewerStatus).toBe("playing");
    }).toPass({ timeout: 20000 });

    // Ensure the player inherently catches up physically over time without ping-pong looping
    await expect(async () => {
      const viewerTime = await viewerVideo.evaluate(
        (vid: HTMLVideoElement) => vid.currentTime,
      );
      expect(viewerTime).toBeGreaterThan(0.5);
    }).toPass({ timeout: 30000 });
  });
});
