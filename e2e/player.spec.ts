import { test, expect, Page } from "@playwright/test";
import { randomUUID } from "node:crypto";

function getTestRoomUrl() {
  return `/room/e2e-${randomUUID().slice(0, 8)}`;
}

async function joinRoom(page: Page, url: string, nickname: string) {
  const consoleLog = (msg: any) => console.log(`[BROWSER] ${msg.text()}`);
  page.on("console", consoleLog);

  // Generate a strictly unique ID so multi-tab tests don't overwrite the same Participant slot in Redis
  const pId = randomUUID();

  const { SignJWT } = require("jose");
  const JWT_SECRET = new TextEncoder().encode(
    process.env.JWT_SECRET || "default_local_secret_dont_use_in_prod",
  );
  // PREGENERATE the token first to prevent async delays inside the interceptor blocking React Hydration
  const token = await new SignJWT({ participantId: pId })
    .setProtectedHeader({ alg: "HS256" })
    .sign(JWT_SECRET);

  await page.route("**/api/auth/session", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ token }),
    });
  });

  // Set LocalStorage values for UI hydration & ENABLE SOCKET.IO DEBUGGING
  await page.addInitScript(
    ({ pId, name, token }) => {
      localStorage.setItem("participantId", pId);
      localStorage.setItem("nickname", name);
      localStorage.setItem("sessionToken", token);
      localStorage.setItem("debug", "socket.io-client:*,engine.io-client:*");
    },
    { pId, name: nickname, token },
  );

  // Parse the origin domain from the project's base URL config
  // (e.g. http://127.0.0.1:3000) so the cookie origin matches exactly
  const baseURL = page.context()._options.baseURL || "http://127.0.0.1:3000";
  const parsedUrl = new URL(url, baseURL);

  // Inject the server-side auth cookie used by the Socket.io WebSocket middleware
  await page.context().addCookies([
    {
      name: "syncwatch_session",
      value: token,
      url: parsedUrl.origin,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);

  await page.goto(url);
  const handleInput = page.getByPlaceholder("ENTER_HANDLE");
  await handleInput.waitFor({ state: "visible", timeout: 15000 });
  await handleInput.fill(nickname);

  // Provide a short stability delay for Next.js to hydrate the socket.io client singleton
  await page.waitForTimeout(500);

  await page.getByRole("button", { name: "Establish Link" }).click();

  // Wait for the UI layout to shift from "Join Room" to the main Player UI.
  // This proves the auth POST succeeded and React state transitioned.
  await expect(page.locator("text=SyncWatch").first()).toBeVisible({
    timeout: 30000,
  });

  // Switch to the Participants tab to mount the nickname in the DOM
  await page.getByRole("button", { name: /Entities/i }).click();

  // The most deterministic way to ensure Socket.io has successfully connected
  // and the React state has hydrated the initial Room data is to wait for the
  // "Participants" panel to visibly list the user that just joined.
  // Note: The local user is always rendered as an input field so they can change it.
  await expect(page.locator(`input[value="${nickname}"]`).first()).toBeVisible({
    timeout: 30000,
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
