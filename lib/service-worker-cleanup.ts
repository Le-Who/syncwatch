interface ServiceWorkerRegistrationLike {
  scope: string;
  unregister: () => Promise<boolean>;
}

interface ServiceWorkerContainerLike {
  controller: unknown;
  getRegistrations: () => Promise<readonly ServiceWorkerRegistrationLike[]>;
}

interface CacheStorageLike {
  keys: () => Promise<string[]>;
  delete: (key: string) => Promise<boolean>;
}

interface CleanupEnvironment {
  serviceWorker?: ServiceWorkerContainerLike;
  location: {
    origin: string;
    reload: () => void;
  };
  caches?: CacheStorageLike;
}

export async function cleanupStaleServiceWorkers(
  env: CleanupEnvironment,
): Promise<boolean> {
  if (!env.serviceWorker) return false;

  const registrations = await env.serviceWorker.getRegistrations();
  const sameOriginRegistrations = registrations.filter((registration) => {
    try {
      return new URL(registration.scope).origin === env.location.origin;
    } catch {
      return false;
    }
  });

  if (sameOriginRegistrations.length === 0) return false;

  const unregisterResults = await Promise.all(
    sameOriginRegistrations.map((registration) => registration.unregister()),
  );

  if (env.caches) {
    const cacheKeys = await env.caches.keys();
    await Promise.all(cacheKeys.map((key) => env.caches!.delete(key)));
  }

  const didUnregister = unregisterResults.some(Boolean);
  if (didUnregister && env.serviceWorker.controller) {
    env.location.reload();
  }

  return didUnregister;
}

export function cleanupCurrentOriginServiceWorkers(): void {
  if (typeof window === "undefined") return;
  if (!("serviceWorker" in navigator)) return;

  cleanupStaleServiceWorkers({
    serviceWorker: navigator.serviceWorker,
    location: window.location,
    caches: "caches" in window ? window.caches : undefined,
  }).catch((error) => {
    console.warn("Failed to clean up stale service worker", error);
  });
}
