import { randomUUID } from "crypto";
import { performance } from "perf_hooks";

// Mock implementation of the original
function originalReorder(room: any, payload: any) {
  const oldIds = new Set(room.playlist.map((i: any) => i.id));
  const newOrderIds = payload.playlist.map((i: any) => i.id);

  const reconciledPlaylist = [];

  for (const id of newOrderIds) {
    const item = room.playlist.find((i: any) => i.id === id);
    if (item) {
      reconciledPlaylist.push(item);
      oldIds.delete(id);
    }
  }

  for (const leftoverId of oldIds) {
    const item = room.playlist.find((i: any) => i.id === leftoverId);
    if (item) reconciledPlaylist.push(item);
  }

  room.playlist = reconciledPlaylist;
}

// Optimized implementation
function optimizedReorder(room: any, payload: any) {
  const oldIds = new Set();
  const itemMap = new Map();

  for (const item of room.playlist) {
    oldIds.add(item.id);
    itemMap.set(item.id, item);
  }

  const newOrderIds = payload.playlist.map((i: any) => i.id);

  const reconciledPlaylist = [];

  for (const id of newOrderIds) {
    const item = itemMap.get(id);
    if (item) {
      reconciledPlaylist.push(item);
      oldIds.delete(id);
    }
  }

  for (const leftoverId of oldIds) {
    const item = itemMap.get(leftoverId);
    if (item) reconciledPlaylist.push(item);
  }

  room.playlist = reconciledPlaylist;
}

function runBenchmark(size: number) {
  const items = Array.from({ length: size }, (_, i) => ({
    id: randomUUID(),
    data: `item_${i}`,
  }));
  const shuffledItems = [...items].sort(() => Math.random() - 0.5);

  const roomOriginal = { playlist: [...items] };
  const payloadOriginal = { playlist: [...shuffledItems] };

  const roomOptimized = { playlist: [...items] };
  const payloadOptimized = { playlist: [...shuffledItems] };

  const ITERATIONS = 1000;

  // Warmup
  for (let i = 0; i < 100; i++) {
    originalReorder({ playlist: [...items] }, { playlist: [...shuffledItems] });
    optimizedReorder(
      { playlist: [...items] },
      { playlist: [...shuffledItems] },
    );
  }

  let start = performance.now();
  for (let i = 0; i < ITERATIONS; i++) {
    // Clone arrays to prevent state mutation affecting subsequent runs
    originalReorder({ playlist: [...items] }, { playlist: [...shuffledItems] });
  }
  const originalTime = performance.now() - start;

  start = performance.now();
  for (let i = 0; i < ITERATIONS; i++) {
    optimizedReorder(
      { playlist: [...items] },
      { playlist: [...shuffledItems] },
    );
  }
  const optimizedTime = performance.now() - start;

  console.log(`Array Size: ${size}`);
  console.log(`Original Time (1000 iter): ${originalTime.toFixed(2)} ms`);
  console.log(`Optimized Time (1000 iter): ${optimizedTime.toFixed(2)} ms`);
  console.log(
    `Improvement: ${(originalTime / optimizedTime).toFixed(2)}x faster\n`,
  );
}

runBenchmark(10);
runBenchmark(50);
runBenchmark(100);
runBenchmark(500);
