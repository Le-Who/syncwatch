import { describe, expect, it, vi } from "vitest";
import { cleanupStaleServiceWorkers } from "../service-worker-cleanup";

describe("cleanupStaleServiceWorkers", () => {
  it("unregisters same-origin service workers and reloads a controlled page", async () => {
    const unregister = vi.fn().mockResolvedValue(true);
    const reload = vi.fn();
    const deleteCache = vi.fn().mockResolvedValue(true);

    const cleaned = await cleanupStaleServiceWorkers({
      serviceWorker: {
        controller: {},
        getRegistrations: vi.fn().mockResolvedValue([
          { scope: "http://localhost:3000/", unregister },
        ]),
      },
      location: {
        origin: "http://localhost:3000",
        reload,
      },
      caches: {
        keys: vi.fn().mockResolvedValue(["old-cache"]),
        delete: deleteCache,
      },
    });

    expect(cleaned).toBe(true);
    expect(unregister).toHaveBeenCalledOnce();
    expect(deleteCache).toHaveBeenCalledWith("old-cache");
    expect(reload).toHaveBeenCalledOnce();
  });

  it("does not reload when there is no active service worker controller", async () => {
    const unregister = vi.fn().mockResolvedValue(true);
    const reload = vi.fn();

    const cleaned = await cleanupStaleServiceWorkers({
      serviceWorker: {
        controller: null,
        getRegistrations: vi.fn().mockResolvedValue([
          { scope: "http://localhost:3000/", unregister },
        ]),
      },
      location: {
        origin: "http://localhost:3000",
        reload,
      },
    });

    expect(cleaned).toBe(true);
    expect(unregister).toHaveBeenCalledOnce();
    expect(reload).not.toHaveBeenCalled();
  });
});
