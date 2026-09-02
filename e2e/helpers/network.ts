import type { BrowserContext, CDPSession, Page } from "@playwright/test";

const DOWNLOAD_THROUGHPUT = 1_500_000;
const UPLOAD_THROUGHPUT = 750_000;

export interface NetworkEmulationHandle {
  setLatency(latencyMs: number): Promise<void>;
  resetAndDispose(): Promise<void>;
}

export async function setLatency(
  page: Page,
  latencyMs: number,
): Promise<NetworkEmulationHandle> {
  const session = await page.context().newCDPSession(page);
  try {
    await session.send("Network.enable");
    await applyLatency(session, latencyMs);
    return createNetworkHandle(session);
  } catch (error) {
    await session.detach().catch(() => {});
    throw error;
  }
}

export async function pulseOffline(
  context: BrowserContext,
  milliseconds: number,
) {
  await context.setOffline(true);
  try {
    await new Promise((resolve) => setTimeout(resolve, milliseconds));
  } finally {
    await context.setOffline(false);
  }
}

export async function alternateLatency(
  page: Page,
  latencyValues: readonly number[],
  intervalMs = 300,
) {
  if (latencyValues.length < 2) {
    throw new Error("alternateLatency requires at least two latency values");
  }
  const network = await setLatency(page, latencyValues[0]);
  let stopped = false;
  let nextIndex = 1;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let activeUpdate = Promise.resolve();

  const schedule = () => {
    timer = setTimeout(() => {
      activeUpdate = network.setLatency(latencyValues[nextIndex]).then(() => {
        nextIndex = (nextIndex + 1) % latencyValues.length;
        if (!stopped) schedule();
      });
    }, intervalMs);
  };
  schedule();

  return {
    setLatency: (latencyMs: number) => network.setLatency(latencyMs),
    async resetAndDispose() {
      if (!stopped) {
        stopped = true;
        if (timer) clearTimeout(timer);
        await activeUpdate;
      }
      await network.resetAndDispose();
    },
  };
}

function createNetworkHandle(session: CDPSession): NetworkEmulationHandle {
  let disposed = false;
  return {
    async setLatency(latencyMs: number) {
      if (disposed) throw new Error("Network emulation is already disposed");
      await applyLatency(session, latencyMs);
    },
    async resetAndDispose() {
      if (disposed) return;
      disposed = true;
      try {
        await applyLatency(session, 0);
      } finally {
        await session.detach();
      }
    },
  };
}

async function applyLatency(session: CDPSession, latencyMs: number) {
  await session.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: latencyMs,
    downloadThroughput: DOWNLOAD_THROUGHPUT,
    uploadThroughput: UPLOAD_THROUGHPUT,
    connectionType: "cellular3g",
  });
}
