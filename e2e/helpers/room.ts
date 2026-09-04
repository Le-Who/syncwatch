import {
  Browser,
  BrowserContext,
  BrowserContextOptions,
  expect,
  Locator,
  Page,
} from "@playwright/test";
import { randomUUID } from "node:crypto";
import { io } from "socket.io-client";
import type { CommandAcknowledgement } from "../../lib/room-command-contract";

export const DETERMINISTIC_MEDIA_URL =
  "https://media.syncwatch.test/e2e-deterministic.wav";
export const DETERMINISTIC_MEDIA_TITLE = "Deterministic Room Audio";

const MEDIA_DURATION_SECONDS = 900;
const WAV_SAMPLE_RATE = 8_000;
const RANGE_CHUNK_BYTES = 8_000;
const WAV_BYTES = createSilentWav(MEDIA_DURATION_SECONDS, WAV_SAMPLE_RATE);

export interface DeterministicMediaAdapter {
  readonly requestCount: number;
  stall(): void;
  resume(): void;
}

export interface RoomClient {
  context: BrowserContext;
  page: Page;
  nickname: string;
  media: DeterministicMediaAdapter;
}

export function createIsolatedBrowserContext(
  browser: Browser,
  options: BrowserContextOptions = {},
) {
  return browser.newContext({
    ...options,
    extraHTTPHeaders: {
      ...options.extraHTTPHeaders,
      "x-syncwatch-e2e-client": randomUUID(),
    },
  });
}

export function getTestRoomUrl(roomId = `e2e-${randomUUID()}`) {
  return `/room/${roomId}`;
}

export async function installDeterministicMedia(
  page: Page,
): Promise<DeterministicMediaAdapter> {
  let stalled = false;
  let requestCount = 0;
  let releaseWaiters: Array<() => void> = [];

  await page.route("**/api/metadata?*", async (route) => {
    const target = new URL(route.request().url()).searchParams.get("url");
    if (target !== DETERMINISTIC_MEDIA_URL) {
      await route.continue();
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        title: DETERMINISTIC_MEDIA_TITLE,
        duration: MEDIA_DURATION_SECONDS,
      }),
    });
  });

  await page.route(DETERMINISTIC_MEDIA_URL, async (route) => {
    requestCount += 1;
    if (stalled) {
      await new Promise<void>((resolve) => releaseWaiters.push(resolve));
    }

    const requestedRange = route.request().headers()["range"];
    const requestedStart = requestedRange?.match(/^bytes=(\d+)-/)?.[1];
    const start = Math.min(Number(requestedStart ?? 0), WAV_BYTES.length - 1);
    const end = Math.min(start + RANGE_CHUNK_BYTES - 1, WAV_BYTES.length - 1);
    const body = WAV_BYTES.subarray(start, end + 1);

    await route.fulfill({
      status: 206,
      headers: {
        "Accept-Ranges": "bytes",
        "Cache-Control": "no-store",
        "Content-Length": String(body.length),
        "Content-Range": `bytes ${start}-${end}/${WAV_BYTES.length}`,
        "Content-Type": "audio/wav",
      },
      body,
    });
  });

  return {
    get requestCount() {
      return requestCount;
    },
    stall() {
      stalled = true;
    },
    resume() {
      stalled = false;
      const waiters = releaseWaiters;
      releaseWaiters = [];
      waiters.forEach((release) => release());
    },
  };
}

export async function joinRoom(
  page: Page,
  roomIdOrUrl: string,
  nickname: string,
) {
  const url = roomIdOrUrl.startsWith("/")
    ? roomIdOrUrl
    : getTestRoomUrl(roomIdOrUrl);
  await page.goto(url);
  await page.getByRole("textbox", { name: "Your name" }).fill(nickname);
  await page.getByRole("button", { name: "Join room" }).click();

  await expect(
    page.getByRole("button", { name: /^People \(\d+\)$/ }),
  ).toBeVisible({
    timeout: 30_000,
  });
  await openPeople(page);
  await expect(
    page.getByRole("textbox", { name: "Your nickname" }),
  ).toHaveValue(nickname, { timeout: 30_000 });
}

export async function createRoomClients(
  browser: Browser,
  count: number,
  roomId = `e2e-${randomUUID()}`,
) {
  if (!Number.isInteger(count) || count < 1) {
    throw new Error("count must be a positive integer");
  }

  const clients: RoomClient[] = [];
  try {
    for (let index = 0; index < count; index += 1) {
      const context = await createIsolatedBrowserContext(browser);
      try {
        const page = await context.newPage();
        const media = await installDeterministicMedia(page);
        const nickname = `Friend ${index + 1}`;
        const client = { context, page, nickname, media };
        await joinRoom(page, roomId, nickname);
        clients.push(client);
      } catch (error) {
        await context.close().catch(() => {});
        throw error;
      }
    }
    return { roomId, clients };
  } catch (error) {
    await closeRoomClients(clients);
    throw error;
  }
}

export async function closeRoomClients(clients: RoomClient[]) {
  await Promise.all(
    clients.map(async (client) => {
      client.media.resume();
      if (client.context.pages().length > 0) {
        await client.context.close().catch(() => {});
      }
    }),
  );
}

export async function openPeople(page: Page) {
  await page.getByRole("button", { name: /^People \(\d+\)$/ }).click();
  await expect(page.getByText("Leader", { exact: true })).toBeVisible();
}

export async function expectPeopleCount(
  page: Page,
  count: number,
  timeout = 15_000,
) {
  await expect(
    page.getByRole("button", { name: `People (${count})` }),
  ).toBeVisible({
    timeout,
  });
}

export function participantCard(page: Page, nickname: string): Locator {
  return page.locator(".participant-item").filter({
    has: page
      .getByText(nickname, { exact: true })
      .or(
        page
          .getByRole("textbox", { name: "Your nickname" })
          .and(page.locator(`input[value=${JSON.stringify(nickname)}]`)),
      ),
  });
}

export async function expectReconnected(
  page: Page,
  proveServerRoundTrip: () => Promise<void>,
  timeout = 15_000,
) {
  await expect(page.getByRole("button", { name: "Retry Now" })).toBeHidden({
    timeout,
  });
  await proveServerRoundTrip();
}

export async function renameParticipantAndExpect(
  client: RoomClient,
  observerPage: Page,
  nickname: string,
) {
  await openPeople(client.page);
  await client.page
    .getByRole("textbox", { name: "Your nickname" })
    .fill(nickname);
  await openPeople(observerPage);
  await expect(participantCard(observerPage, nickname)).toBeVisible({
    timeout: 15_000,
  });
  client.nickname = nickname;
}

export async function addDeterministicMedia(client: RoomClient) {
  await client.page.getByRole("button", { name: /^Queue$/ }).click();
  const composer = client.page.getByRole("textbox", {
    name: "YouTube URL or search",
  });
  await expect(composer).toBeVisible();
  await composer.fill(DETERMINISTIC_MEDIA_URL);
  await client.page.getByRole("button", { name: "Add media" }).click();
  await expect(
    client.page.getByText(DETERMINISTIC_MEDIA_TITLE, { exact: true }).first(),
  ).toBeVisible({ timeout: 20_000 });
}

export async function initializePlayback(client: RoomClient) {
  const media = client.page.locator("audio, video").first();
  await expect(media).toBeAttached({ timeout: 20_000 });
  await expect
    .poll(
      () =>
        media.evaluate((element: HTMLMediaElement) => ({
          duration: element.duration,
          readyState: element.readyState,
        })),
      { timeout: 20_000 },
    )
    .toMatchObject({ duration: MEDIA_DURATION_SECONDS });

  await initializeProviderGesture(client);
}

export async function initializeProviderGesture(client: RoomClient) {
  const guard = client.page.getByRole("button", {
    name: "Initialize Stream Sync",
  });
  if (await guard.isVisible()) await guard.click();
  await expect(guard).toBeHidden();
}

export async function expectCanonicalStatus(
  page: Page,
  status: "playing" | "paused",
) {
  const accessibleControlName = status === "playing" ? "Pause" : "Play";
  await expect(
    page
      .getByTestId("player-interaction-layer")
      .getByRole("button", { name: accessibleControlName, exact: true })
      .first(),
  ).toBeVisible({ timeout: 15_000 });
}

export function playbackControl(page: Page, name: "Play" | "Pause") {
  return page
    .getByTestId("player-interaction-layer")
    .getByRole("button", { name, exact: true })
    .last();
}

export async function mediaPosition(page: Page) {
  return page
    .locator("audio, video")
    .first()
    .evaluate((element: HTMLMediaElement) => element.currentTime);
}

export async function expectAdvancing(page: Page, minimumDelta: number) {
  const before = await mediaPosition(page);
  await expect
    .poll(() => mediaPosition(page), { timeout: 10_000 })
    .toBeGreaterThan(before + minimumDelta);
}

export async function seekToFraction(page: Page, fraction: number) {
  const scrubber = page.locator("#progress-bar-container");
  await expect(scrubber).toBeVisible();
  const bounds = await scrubber.boundingBox();
  if (!bounds) throw new Error("Playback scrubber has no layout box");
  await scrubber.click({
    position: {
      x: Math.max(1, Math.min(bounds.width - 1, bounds.width * fraction)),
      y: bounds.height / 2,
    },
  });
}

export async function sendCommandViaSession(
  client: RoomClient,
  roomId: string,
  type: string,
  payload: Record<string, unknown>,
): Promise<CommandAcknowledgement> {
  const origin = new URL(client.page.url()).origin;
  const participantId = await client.page.evaluate(() =>
    localStorage.getItem("participantId"),
  );
  const sessionCookie = (await client.context.cookies(origin)).find(
    (cookie) => cookie.name === "syncwatch_session",
  );
  if (!participantId || !sessionCookie) {
    throw new Error("The browser did not establish a genuine room session");
  }

  const socket = io(origin, {
    path: "/socket.io",
    transports: ["websocket"],
    reconnection: false,
    auth: { token: sessionCookie.value, participantId },
  });

  try {
    await waitForSocketEvent(socket, "connect");
    socket.emit("join_room", {
      roomId,
      nickname: client.nickname,
      participantId,
    });
    await waitForSocketEvent(socket, "room_state");

    const nonce = randomUUID();
    const acknowledgement = new Promise<CommandAcknowledgement>(
      (resolve, reject) => {
        const timer = setTimeout(
          () =>
            reject(new Error("Timed out waiting for command acknowledgement")),
          10_000,
        );
        socket.on("command_ack", (ack: CommandAcknowledgement) => {
          if (ack.nonce !== nonce) return;
          clearTimeout(timer);
          resolve(ack);
        });
      },
    );
    socket.emit("command", {
      roomId,
      nonce,
      clientSequence: 0,
      command: { type, payload },
    });
    return await acknowledgement;
  } finally {
    socket.close();
  }
}

function waitForSocketEvent(socket: ReturnType<typeof io>, event: string) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timed out waiting for socket ${event}`)),
      10_000,
    );
    socket.once(event, () => {
      clearTimeout(timer);
      resolve();
    });
    socket.once("connect_error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function createSilentWav(durationSeconds: number, sampleRate: number) {
  const dataLength = durationSeconds * sampleRate;
  const wav = Buffer.alloc(44 + dataLength, 128);
  wav.write("RIFF", 0, "ascii");
  wav.writeUInt32LE(36 + dataLength, 4);
  wav.write("WAVE", 8, "ascii");
  wav.write("fmt ", 12, "ascii");
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate, 28);
  wav.writeUInt16LE(1, 32);
  wav.writeUInt16LE(8, 34);
  wav.write("data", 36, "ascii");
  wav.writeUInt32LE(dataLength, 40);
  return wav;
}
