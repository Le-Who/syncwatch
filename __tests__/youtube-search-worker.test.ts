/**
 * @vitest-environment node
 */
import { afterEach, describe, expect, it } from "vitest";
import { Worker } from "node:worker_threads";

import { createYoutubeSearchWorkerModuleUrl } from "../app/api/youtube/search/route";

describe("YouTube search worker module", () => {
  it("executes the generated worker as a real Node worker without CommonJS-in-ESM failure", async () => {
    const worker = new Worker(createYoutubeSearchWorkerModuleUrl(), {
      workerData: { moduleRoot: process.cwd(), probe: true },
    });
    afterEach(async () => {
      await worker.terminate();
    });

    await expect(
      new Promise((resolve, reject) => {
        worker.once("message", resolve);
        worker.once("error", reject);
      }),
    ).resolves.toEqual({ ready: true });
  });
});
