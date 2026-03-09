import { test, expect } from "@playwright/test";
import { getTestRoomUrl, joinRoom } from "./helpers/room";

test.describe("Network Resilience (TC-302)", () => {
  test("Client TCP drops securely reconnect and preserve JWT session", async ({
    page,
    context,
  }) => {
    test.setTimeout(45000);
    const roomUrl = getTestRoomUrl();
    await joinRoom(page, roomUrl, "DropoutUser");

    // Arrange: Ensure joined and connected
    await expect(
      page.locator('input[value="DropoutUser"]').first(),
    ).toBeVisible({ timeout: 15000 });

    const mockMetadataApi = async (route: any) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          title: "Reconnect Video",
          thumbnail: "",
        }),
      });
    };
    await page.route("**/api/metadata*", mockMetadataApi);

    // Arrange: Assert initial connection state before dropout
    await expect(async () => {
      const isConnected = await page.evaluate(
        () => (window as any).__store.getState().isConnected,
      );
      expect(isConnected).toBe(true);
    }).toPass({ timeout: 10000 });

    // Act: Emulate physical network drop by closing the underlying transport
    // This perfectly mimics a TCP connection reset without triggering the application's clean disconnect flow
    await page.evaluate(() => {
      (window as any).__roomSocketService.getSocket().io.engine.close();
    });

    // Act: Wait for the client to realize it's disconnected (Store update)
    await expect(async () => {
      const isConnected = await page.evaluate(
        () => (window as any).__store.getState().isConnected,
      );
      expect(isConnected).toBe(false);
    }).toPass({ timeout: 15000 });

    // Act: Wait for the automatic reconnection (Socket.io exponential backoff)
    // The socket will automatically try to reconnect and the __roomSocketService will upgrade the session
    await expect(async () => {
      const state = await page.evaluate(() =>
        (window as any).__store.getState(),
      );
      expect(state.isConnected).toBe(true);
      expect(state.sessionToken).toBeTruthy(); // Ensure token survived/was restored
    }).toPass({ timeout: 15000 });

    // Assert: Verify the re-established connection actually works with a privileged JWT action
    // "DropoutUser" is the first user, so they are the owner.
    // The initial screen displays the empty player input
    const urlInput = page.locator(
      'input[placeholder="Paste video stream URL..."]',
    );
    await urlInput.waitFor({ state: "visible" });
    await urlInput.fill("https://example.com/video.mp4");
    await page.locator("button", { hasText: "Init" }).click();

    // Assert: Verify the API command was accepted by the server and broadcasted back
    await expect(page.locator("text=Reconnect Video").first()).toBeVisible({
      timeout: 15000,
    });
  });
});
