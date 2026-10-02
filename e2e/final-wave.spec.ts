import { randomUUID } from "node:crypto";
import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  DETERMINISTIC_MEDIA_URL,
  installDeterministicMedia,
  joinRoom,
  expectPeopleCount,
  mediaPosition,
  expectCanonicalStatus,
  createRoomClients,
  closeRoomClients,
  addDeterministicMedia,
  initializePlayback,
  seekToFraction,
  DETERMINISTIC_MEDIA_TITLE,
} from "./helpers/room";

test("reselecting the same queue item recreates a ready and seekable provider", async ({
  browser,
}) => {
  const room = await createRoomClients(browser, 1);
  try {
    const client = room.clients[0];
    await addDeterministicMedia(client);
    await initializePlayback(client);
    await seekToFraction(client.page, 0.1);
    await expect.poll(() => mediaPosition(client.page)).toBeGreaterThan(80);
    await client.page
      .getByRole("listitem")
      .getByText(DETERMINISTIC_MEDIA_TITLE, { exact: true })
      .click();
    await initializePlayback(client);
    await expect(
      client.page.getByRole("slider", { name: "Playback position" }),
    ).toHaveAttribute("aria-disabled", "false");
    await expect.poll(() => mediaPosition(client.page)).toBeLessThan(3);
    await seekToFraction(client.page, 0.2);
    await expect.poll(() => mediaPosition(client.page)).toBeGreaterThan(170);
  } finally {
    await closeRoomClients(room.clients);
  }
});

async function tabTo(page: Page, locator: Locator) {
  for (let n = 0; n < 80; n++) {
    if (
      await locator.evaluateAll((nodes) =>
        nodes.some((node) => node === document.activeElement),
      )
    )
      return;
    await page.keyboard.press("Tab");
  }
  throw new Error("Keyboard focus did not reach the requested control");
}
test("keyboard-only room rename, tabs, scrubber and unrelated Space", async ({
  page,
}) => {
  test.setTimeout(90000);
  await installDeterministicMedia(page);
  await page.goto(`/room/keyboard-${randomUUID()}`);
  await page.keyboard.type("Keyboard Owner");
  await page.keyboard.press("Enter");
  const rename = page.getByRole("button", { name: "Rename room" });
  await expect(rename).toBeVisible();
  await tabTo(page, rename);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("textbox", { name: "Room name" })).toBeFocused();
  await page.keyboard.press("Control+A");
  await page.keyboard.type("Keyboard friends");
  await page.keyboard.press("Enter");
  await expect(rename).toHaveText("Keyboard friends");
  const chat = page.getByRole("button", { name: "Chat", exact: true });
  await tabTo(page, chat);
  expect(
    await chat.evaluate((node) => {
      const css = getComputedStyle(node);
      return css.outlineStyle !== "none" || css.boxShadow !== "none";
    }),
  ).toBe(true);
  await page.keyboard.press("Space");
  const queue = page.getByRole("button", { name: "Queue", exact: true });
  await tabTo(page, queue);
  await page.keyboard.press("Space");
  const composer = page.getByRole("textbox", { name: "YouTube URL or search" });
  await tabTo(page, composer);
  await page.keyboard.type(DETERMINISTIC_MEDIA_URL);
  await tabTo(
    page,
    page.getByRole("button", { name: "Add media", exact: true }),
  );
  await page.keyboard.press("Enter");
  const initialize = page.getByRole("button", {
    name: "Initialize Stream Sync",
  });
  await expect(initialize).toBeVisible();
  await tabTo(page, initialize);
  await page.keyboard.press("Enter");
  const slider = page.getByRole("slider", { name: "Playback position" });
  await expect(slider).toBeVisible();
  await expect(slider).toHaveAttribute("aria-disabled", "false", {
    timeout: 20000,
  });
  await tabTo(page, slider);
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowRight");
  await expect.poll(() => mediaPosition(page)).toBeGreaterThan(3);
  await expectCanonicalStatus(page, "paused");
  await tabTo(page, chat);
  await page.keyboard.press("Space");
  await expectCanonicalStatus(page, "paused");
});

test("three same-NAT friends retain signed identities across repeated reloads", async ({
  browser,
}) => {
  test.setTimeout(120000);
  const contexts = [];
  const pages: Page[] = [];
  const room = `same-nat-${randomUUID()}`;
  try {
    for (let n = 0; n < 3; n++) {
      // No distributed-IP fixture marker: these contexts share the proxy peer IP.
      const context = await browser.newContext();
      contexts.push(context);
      const page = await context.newPage();
      pages.push(page);
      await joinRoom(page, room, `NAT ${n}`);
    }
    const identities = await Promise.all(
      pages.map((page) =>
        page.evaluate(() => localStorage.getItem("participantId")),
      ),
    );
    for (const identity of identities)
      expect(identity).toMatch(/^[0-9a-f-]{36}$/i);
    expect(new Set(identities).size).toBe(3);
    for (let round = 0; round < 4; round++)
      for (let n = 0; n < pages.length; n++) {
        await pages[n].reload();
        // Wait for persisted nickname hydration before interacting with the form.
        await expect(
          pages[n].getByRole("textbox", { name: "Your name" }),
        ).toHaveValue(`NAT ${n}`);
        await pages[n].getByRole("button", { name: "Join room" }).click();
        await expectPeopleCount(pages[n], 3);
        expect(
          await pages[n].evaluate(() => localStorage.getItem("participantId")),
        ).toBe(identities[n]);
      }
    for (const page of pages) await expectPeopleCount(page, 3);
  } finally {
    for (const context of contexts) await context.close();
  }
});
