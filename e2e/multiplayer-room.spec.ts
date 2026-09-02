import { expect, test } from "@playwright/test";
import {
  addDeterministicMedia,
  closeRoomClients,
  createRoomClients,
  expectAdvancing,
  expectCanonicalStatus,
  expectPeopleCount,
  expectReconnected,
  initializePlayback,
  installDeterministicMedia,
  joinRoom,
  mediaPosition,
  openPeople,
  participantCard,
  playbackControl,
  renameParticipantAndExpect,
  seekToFraction,
  sendCommandViaSession,
} from "./helpers/room";
import { pulseOffline } from "./helpers/network";

test.describe.configure({ mode: "serial" });

test.describe("deterministic friend rooms", () => {
  test("five independent friends share presence and permissioned playback", async ({
    browser,
  }) => {
    test.setTimeout(120_000);
    const room = await createRoomClients(browser, 5);

    try {
      await Promise.all(
        room.clients.map(({ page }) => expectPeopleCount(page, 5)),
      );

      await addDeterministicMedia(room.clients[0]);
      await Promise.all(room.clients.map(initializePlayback));

      // Before a leader exists, a viewer is allowed to control playback.
      await playbackControl(room.clients[4].page, "Play").click();
      await Promise.all(
        room.clients.map(({ page }) => expectCanonicalStatus(page, "playing")),
      );
      await Promise.all(
        room.clients.map(({ page }) => expectAdvancing(page, 0.6)),
      );

      await openPeople(room.clients[1].page);
      await room.clients[1].page
        .getByRole("button", { name: "Request leader" })
        .click();
      await Promise.all(
        room.clients.map(async ({ page }) => {
          await openPeople(page);
          await expect(
            page.getByText("Friend 2", { exact: true }).first(),
          ).toBeVisible();
          await expect(page.getByText("LEADER", { exact: true })).toBeVisible();
        }),
      );

      // The UI is correctly disabled, while a lower-level command using this
      // participant's genuine browser-issued session proves the exact ACK.
      await expect(
        playbackControl(room.clients[4].page, "Pause"),
      ).toBeDisabled();
      const rejected = await sendCommandViaSession(
        room.clients[4],
        room.roomId,
        "pause",
        { position: await mediaPosition(room.clients[4].page) },
      );
      expect(rejected).toMatchObject({
        status: "rejected",
        code: "NOT_PERMITTED",
      });

      await openPeople(room.clients[0].page);
      const futureModerator = participantCard(room.clients[0].page, "Friend 3");
      await futureModerator
        .getByRole("button", { name: "Manage user" })
        .click();
      await room.clients[0].page
        .getByRole("button", { name: "Make Moderator" })
        .click();
      await expect(
        participantCard(room.clients[0].page, "Friend 3"),
      ).toContainText("moderator");

      // Active leader pause reaches every healthy participant.
      await playbackControl(room.clients[1].page, "Pause").click();
      await Promise.all(
        room.clients.map(({ page }) => expectCanonicalStatus(page, "paused")),
      );

      // The room owner retains playback authority while Friend 2 is leader.
      await playbackControl(room.clients[0].page, "Play").click();
      await Promise.all(
        room.clients.map(({ page }) => expectCanonicalStatus(page, "playing")),
      );
      await playbackControl(room.clients[0].page, "Pause").click();
      await Promise.all(
        room.clients.map(({ page }) => expectCanonicalStatus(page, "paused")),
      );

      // A moderator may also control while another participant is leader.
      await playbackControl(room.clients[2].page, "Play").click();
      await Promise.all(
        room.clients.map(({ page }) => expectCanonicalStatus(page, "playing")),
      );
      await expectAdvancing(room.clients[3].page, 0.6);
    } finally {
      await closeRoomClients(room.clients);
    }
  });

  test("reconnects without duplicates, late-joins in sync, and hands off a departed owner", async ({
    browser,
  }) => {
    test.setTimeout(120_000);
    const room = await createRoomClients(browser, 3);

    try {
      await addDeterministicMedia(room.clients[0]);
      await Promise.all(room.clients.map(initializePlayback));
      await playbackControl(room.clients[0].page, "Play").click();
      await Promise.all(
        room.clients.map(({ page }) => expectCanonicalStatus(page, "playing")),
      );

      await openPeople(room.clients[1].page);
      await room.clients[1].page
        .getByRole("button", { name: "Request leader" })
        .click();
      await Promise.all(
        room.clients.map(async ({ page }) => {
          await openPeople(page);
          await expect(participantCard(page, "Friend 2")).toContainText(
            "LEADER",
          );
        }),
      );

      await pulseOffline(room.clients[0].context, 800);
      await expectReconnected(room.clients[0].page, async () => {
        await renameParticipantAndExpect(
          room.clients[0],
          room.clients[2].page,
          "Friend 1 Reconnected",
        );
      });
      await Promise.all(
        room.clients.map(({ page }) => expectPeopleCount(page, 3)),
      );
      await openPeople(room.clients[0].page);
      await expect(
        participantCard(room.clients[0].page, "Friend 1 Reconnected"),
      ).toContainText("owner");

      // This exceeds the client's first clock heartbeat while remaining inside
      // the 15-second participant grace window.
      await pulseOffline(room.clients[1].context, 3_500);
      await expectReconnected(room.clients[1].page, async () => {
        await renameParticipantAndExpect(
          room.clients[1],
          room.clients[2].page,
          "Friend 2 Reconnected",
        );
      });
      await Promise.all(
        room.clients.map(({ page }) => expectPeopleCount(page, 3)),
      );
      await openPeople(room.clients[1].page);
      await expect(
        participantCard(room.clients[1].page, "Friend 2 Reconnected"),
      ).toContainText("LEADER");

      const lateContext = await browser.newContext();
      const latePage = await lateContext.newPage();
      const lateMedia = await installDeterministicMedia(latePage);
      const lateClient = {
        context: lateContext,
        page: latePage,
        nickname: "Friend 4",
        media: lateMedia,
      };
      room.clients.push(lateClient);
      await joinRoom(latePage, room.roomId, lateClient.nickname);
      await initializePlayback(lateClient);
      await Promise.all(
        room.clients.map(({ page }) => expectPeopleCount(page, 4)),
      );
      await expectCanonicalStatus(latePage, "playing");
      await expect
        .poll(
          async () =>
            Math.abs(
              (await mediaPosition(latePage)) -
                (await mediaPosition(room.clients[2].page)),
            ),
          { timeout: 15_000 },
        )
        .toBeLessThan(4);

      await openPeople(room.clients[1].page);
      await room.clients[1].page
        .getByRole("button", { name: "Release leader" })
        .click();
      await openPeople(room.clients[0].page);
      await room.clients[0].page
        .getByRole("button", { name: "Request leader" })
        .click();
      await Promise.all(
        room.clients.map(async ({ page }) => {
          await openPeople(page);
          await expect(
            participantCard(page, "Friend 1 Reconnected"),
          ).toContainText("LEADER");
        }),
      );

      const beforeDeparture = await mediaPosition(room.clients[2].page);
      await room.clients[0].context.close();
      room.clients.splice(0, 1);

      await Promise.all(
        room.clients.map(({ page }) => expectPeopleCount(page, 3, 25_000)),
      );
      await Promise.all(
        room.clients.map(async ({ page }) => {
          await openPeople(page);
          await expect(
            page.locator(".participant-item").filter({ hasText: /owner/i }),
          ).toHaveCount(1);
          await expect(page.getByText("LEADER", { exact: true })).toHaveCount(
            0,
          );
          await expect(
            page.getByText("No active leader", { exact: true }),
          ).toBeVisible();
        }),
      );
      await expectCanonicalStatus(room.clients[1].page, "playing");
      await expect
        .poll(() => mediaPosition(room.clients[1].page), { timeout: 10_000 })
        .toBeGreaterThan(beforeDeparture + 2);
    } finally {
      await closeRoomClients(room.clients);
    }
  });

  for (const viewport of [
    { name: "desktop", width: 1280, height: 720 },
    { name: "mobile", width: 390, height: 844 },
  ]) {
    test(`${viewport.name} mounts exactly one composer before and after media is added`, async ({
      browser,
    }) => {
      const context = await browser.newContext({ viewport });
      const page = await context.newPage();
      const media = await installDeterministicMedia(page);
      const client = { context, page, nickname: "Composer", media };

      try {
        await joinRoom(
          page,
          `composer-${crypto.randomUUID()}`,
          client.nickname,
        );
        const composers = page.getByRole("textbox", {
          name: "YouTube URL or search",
        });
        await expect(composers).toHaveCount(1);
        await expect(composers).toBeVisible();

        await addDeterministicMedia(client);
        await page.getByRole("button", { name: /^Queue$/ }).click();
        await expect(composers).toHaveCount(1);
        await expect(composers).toBeVisible();
      } finally {
        await context.close();
      }
    });
  }
});
