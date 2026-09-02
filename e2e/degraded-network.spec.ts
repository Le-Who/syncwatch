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
  mediaPosition,
  playbackControl,
  seekToFraction,
} from "./helpers/room";
import { alternateLatency, pulseOffline, setLatency } from "./helpers/network";

test.describe.configure({ mode: "serial" });

test("two independently degraded friends do not stall three healthy players and later converge", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const room = await createRoomClients(browser, 5);
  let stopJitter: (() => Promise<void>) | undefined;

  try {
    await addDeterministicMedia(room.clients[0]);
    await Promise.all(room.clients.map(initializePlayback));
    await playbackControl(room.clients[0].page, "Play").click();
    await Promise.all(
      room.clients.map(({ page }) => expectCanonicalStatus(page, "playing")),
    );
    await Promise.all(
      room.clients.map(({ page }) => expectAdvancing(page, 0.6)),
    );

    const slowProvider = room.clients[2];
    const jitteringTransport = room.clients[3];
    const healthy = [room.clients[0], room.clients[1], room.clients[4]];

    await setLatency(slowProvider.page, 1_500);
    stopJitter = await alternateLatency(jitteringTransport.page, [200, 1_200]);
    slowProvider.media.stall();

    const offlinePulse = pulseOffline(jitteringTransport.context, 1_800);
    await seekToFraction(room.clients[0].page, 0.65);

    await expect(
      slowProvider.page.getByRole("status", {
        name: /Your video is buffering.*Friends are still watching/i,
      }),
    ).toBeVisible({ timeout: 15_000 });

    await Promise.all(
      healthy.map(({ page }) => expectCanonicalStatus(page, "playing")),
    );
    const healthyBefore = await Promise.all(
      healthy.map(({ page }) => mediaPosition(page)),
    );
    await Promise.all(
      healthy.map(async ({ page }, index) => {
        await expect
          .poll(() => mediaPosition(page), { timeout: 10_000 })
          .toBeGreaterThan(healthyBefore[index] + 1);
      }),
    );

    await offlinePulse;
    await expectReconnected(jitteringTransport.page);
    await expectPeopleCount(jitteringTransport.page, 5);
    await expectCanonicalStatus(jitteringTransport.page, "playing");

    slowProvider.media.resume();
    await stopJitter();
    stopJitter = undefined;
    await setLatency(slowProvider.page, 0);
    await setLatency(jitteringTransport.page, 0);

    await expect(
      slowProvider.page.getByRole("status", {
        name: /Your video is buffering/i,
      }),
    ).toBeHidden({ timeout: 20_000 });

    await expect
      .poll(
        async () => {
          const positions = await Promise.all(
            room.clients.map(({ page }) => mediaPosition(page)),
          );
          return Math.max(...positions) - Math.min(...positions);
        },
        { timeout: 25_000 },
      )
      .toBeLessThan(4);
    await Promise.all(
      room.clients.map(({ page }) => expectCanonicalStatus(page, "playing")),
    );
  } finally {
    slowResume(room.clients);
    if (stopJitter) await stopJitter();
    await closeRoomClients(room.clients);
  }
});

function slowResume(
  clients: Awaited<ReturnType<typeof createRoomClients>>["clients"],
) {
  for (const client of clients) client.media.resume();
}
