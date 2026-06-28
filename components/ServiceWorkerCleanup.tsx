"use client";

import { useEffect } from "react";
import { cleanupCurrentOriginServiceWorkers } from "@/lib/service-worker-cleanup";

export function ServiceWorkerCleanup() {
  useEffect(() => {
    cleanupCurrentOriginServiceWorkers();
  }, []);

  return null;
}
