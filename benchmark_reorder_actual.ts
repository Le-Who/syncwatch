import { randomUUID } from "crypto";
import { performance } from "perf_hooks";

// Current implementation in lib/redis-queue-worker.ts
function currentReorder(room: any, payload: any) {
  const oldIds = new Set(room.playlist.map((i: any) => i.id));
  const newOrderIds = payload.playlist.map((i: any) => i.id);

  // Create a map for O(1) lookups
  const itemMap = new Map(room.playlist.map((i: any) => [i.id, i]));

  // Reconcile arrays instead of blind overwrite (Concurrency Fix)
  const reconciledPlaylist: any[] = [];

  // O(N) Preprocessing for fast lookup during reconciliation
  const playlistMap = new Map();
  for (const item of room.playlist) {
    playlistMap.set(item.id, item);
  }

  // 1. Maintain items that exist in both, in the new order
  for (const id of newOrderIds) {
    const item = itemMap.get(id);
    if (item) {
      reconciledPlaylist.push(item);
      oldIds.delete(id);
    }
  }

  // 2. Append items that were concurrently added (exist in oldIds but not in payload)
  for (const leftoverId of oldIds) {
    const item = itemMap.get(leftoverId);
    if (item) reconciledPlaylist.push(item);
  }

  room.playlist = reconciledPlaylist;
}

// Optimized implementation (proposed)
function optimizedReorder(room: any, payload: any) {
  const itemMap = new Map();
  for (const item of room.playlist) {
    itemMap.set(item.id, item);
  }

  const reconciledPlaylist = [];

  // 1. Maintain items that exist in both, in the new order
  for (const newItem of payload.playlist) {
    const item = itemMap.get(newItem.id);
    if (item) {
      reconciledPlaylist.push(item);
      itemMap.delete(newItem.id);
    }
  }

  // 2. Append items that were concurrently added
  for (const leftoverItem of itemMap.values()) {
    reconciledPlaylist.push(leftoverItem);
  }

  room.playlist = reconciledPlaylist;
}

function runBenchmark(size: number) {
  const items = Array.from({ length: size }, (_, i) => ({
    id: randomUUID(),
    url: `https://example.com/v=${i}`,
    title: `Video ${i}`,
  }));
  const shuffledItems = [...items].sort(() => Math.random() - 0.5);

  const ITERATIONS = 10000;

  // Warmup
  for (let i = 0; i < 1000; i++) {
    currentReorder({ playlist: [...items] }, { playlist: [...shuffledItems] });
    optimizedReorder({ playlist: [...items] }, { playlist: [...shuffledItems] });
  }

  let start = performance.now();
  for (let i = 0; i < ITERATIONS; i++) {
    currentReorder({ playlist: [...items] }, { playlist: [...shuffledItems] });
  }
  const currentTime = performance.now() - start;

  start = performance.now();
  for (let i = 0; i < ITERATIONS; i++) {
    optimizedReorder({ playlist: [...items] }, { playlist: [...shuffledItems] });
  }
  const optimizedTime = performance.now() - start;

  console.log(`Playlist Size: ${size}`);
  console.log(`Current Time (${ITERATIONS} iter): ${currentTime.toFixed(2)} ms`);
  console.log(`Optimized Time (${ITERATIONS} iter): ${optimizedTime.toFixed(2)} ms`);
  console.log(`Improvement: ${(currentTime / optimizedTime).toFixed(2)}x faster\n`);
}

console.log("--- Benchmark Results ---");
runBenchmark(10);
runBenchmark(50);
runBenchmark(100);
runBenchmark(500);
