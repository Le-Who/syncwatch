import { Page, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";

export function getTestRoomUrl() {
  return `/room/e2e-${randomUUID().slice(0, 8)}`;
}

export async function joinRoom(page: Page, url: string, nickname: string) {
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
  // (e.g. http://localhost:3001) so the cookie origin matches exactly
  const baseURL =
    (page.context() as any)._options?.baseURL || "http://localhost:3001";
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
