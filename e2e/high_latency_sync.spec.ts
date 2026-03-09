import { test, expect } from "@playwright/test";
import { getTestRoomUrl, joinRoom } from "./helpers/room";

test.describe("High Latency Network Chaos (TC-303)", () => {
  test("Viewer syncs correctly despite 500ms network latency", async ({
    browser,
  }) => {
    test.setTimeout(60000);

    const context1 = await browser.newContext();
    const context2 = await browser.newContext();
    const hostPage = await context1.newPage();
    const viewerPage = await context2.newPage();

    // 1. Arrange: Setup network conditions on Viewer
    const viewerCdp = await context2.newCDPSession(viewerPage);
    await viewerCdp.send("Network.enable");
    await viewerCdp.send("Network.emulateNetworkConditions", {
      offline: false,
      downloadThroughput: (10 * 1024 * 1024) / 8, // 10 Mbps
      uploadThroughput: (5 * 1024 * 1024) / 8, // 5 Mbps
      latency: 500, // 500ms ping
    });

    const roomUrl = getTestRoomUrl();
    await joinRoom(hostPage, roomUrl, "Host");
    await expect(hostPage.locator("input[value='Host']").first()).toBeVisible({
      timeout: 15000,
    });

    await joinRoom(viewerPage, roomUrl, "Viewer");
    await expect(
      viewerPage.locator("input[value='Viewer']").first(),
    ).toBeVisible({
      timeout: 15000,
    });

    // Mock API
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

    // Host queues video
    const testVideoUrl = "https://www.w3schools.com/html/mov_bbb.mp4";
    await hostPage.locator("button", { hasText: /Queue/i }).click();
    const urlInput = hostPage.locator(
      'input[placeholder="Paste video stream URL..."]',
    );
    await urlInput.waitFor({ state: "visible" });
    await urlInput.fill(testVideoUrl);
    await hostPage.locator("button", { hasText: "Init" }).click();

    // 2. Arrange: Wait for UI to settle
    await expect(
      hostPage.locator("text=Latency Test Video").first(),
    ).toBeVisible({ timeout: 15000 });

    const hostVideo = hostPage.locator("video").first();
    const viewerVideo = viewerPage.locator("video").first();
    await hostVideo.waitFor({ state: "attached", timeout: 15000 });
    await viewerVideo.waitFor({ state: "attached", timeout: 20000 }); // Give viewer more time

    await expect(async () => {
      const dur = await hostVideo.evaluate(
        (vid: HTMLVideoElement) => vid.duration,
      );
      expect(dur).toBeGreaterThan(0);
      expect(Number.isNaN(dur)).toBe(false);
    }).toPass({ timeout: 15000 });

    // Dismiss Intent Mask
    await hostPage
      .getByRole("button", { name: /Initialize Stream Sync/i })
      .click();
    await viewerPage
      .getByRole("button", { name: /Initialize Stream Sync/i })
      .click();

    await hostPage.waitForFunction(
      () => {
        const state = (window as any).__store?.getState();
        return state?.room?.playback?.status !== undefined;
      },
      { timeout: 15000 },
    );

    // 3. Act: Host initiates playback
    const playerWrapper = hostPage
      .getByTestId("player-interaction-layer")
      .first();
    await playerWrapper.hover({ force: true }).catch(() => {});
    await playerWrapper.click({ force: true });

    // Wait for Host to officially start playing
    await expect(async () => {
      const hostStatus = await hostPage.evaluate(
        () => (window as any).__store.getState().room?.playback?.status,
      );
      expect(hostStatus).toBe("playing");
    }).toPass({ timeout: 10000 });

    // 4. Assert: Viewer catches up despite 500ms latency without infinite looping
    // It should eventually reach "playing" state
    await expect(async () => {
      const viewerStatus = await viewerPage.evaluate(
        () => (window as any).__store.getState().room?.playback?.status,
      );
      expect(viewerStatus).toBe("playing");
    }).toPass({ timeout: 20000 }); // Viewer needs extra time due to 500ms RTT

    // Assert that the video is actually advancing for viewer
    await expect(async () => {
      const viewerTime = await viewerVideo.evaluate(
        (vid: HTMLVideoElement) => vid.currentTime,
      );
      expect(viewerTime).toBeGreaterThan(0.5);
    }).toPass({ timeout: 30000 });
  });
});
