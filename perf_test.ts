import { randomUUID } from "crypto";
import { performance } from "perf_hooks";

function originalVideoEnded(room: any) {
  const activeItem = room.playlist.find((i: any) => i.id === room.currentMediaId);
  const endedIndex = room.playlist.findIndex((i: any) => i.id === room.currentMediaId);
  return { activeItem, endedIndex };
}

function optimizedVideoEnded(room: any) {
  const endedIndex = room.playlist.findIndex((i: any) => i.id === room.currentMediaId);
  const activeItem = endedIndex !== -1 ? room.playlist[endedIndex] : undefined;
  return { activeItem, endedIndex };
}

function originalRemoveItem(room: any) {
  const newHead = room.currentMediaId
    ? room.playlist.find((i: any) => i.id === room.currentMediaId)
    : null;
  return newHead;
}

function optimizedRemoveItem(room: any) {
  const newHead = room.playlist.length > 0 ? room.playlist[0] : null;
  return newHead;
}

function runBenchmark(size: number) {
  const playlist = Array.from({ length: size }, (_, i) => ({
    id: randomUUID(),
    title: `Video ${i}`,
  }));

  // Test worst case: last item
  const currentMediaId = playlist[playlist.length - 1].id;
  const room = { playlist, currentMediaId };

  const ITERATIONS = 50000;

  // Warmup
  for (let i = 0; i < 1000; i++) {
    originalVideoEnded(room);
    optimizedVideoEnded(room);
  }

  let start = performance.now();
  for (let i = 0; i < ITERATIONS; i++) {
    originalVideoEnded(room);
  }
  const originalVideoEndedTime = performance.now() - start;

  start = performance.now();
  for (let i = 0; i < ITERATIONS; i++) {
    optimizedVideoEnded(room);
  }
  const optimizedVideoEndedTime = performance.now() - start;

  // Warmup remove
  const roomForRemove = { playlist, currentMediaId: playlist[0].id };
  for (let i = 0; i < 1000; i++) {
    originalRemoveItem(roomForRemove);
    optimizedRemoveItem(roomForRemove);
  }

  start = performance.now();
  for (let i = 0; i < ITERATIONS; i++) {
    originalRemoveItem(roomForRemove);
  }
  const originalRemoveTime = performance.now() - start;

  start = performance.now();
  for (let i = 0; i < ITERATIONS; i++) {
    optimizedRemoveItem(roomForRemove);
  }
  const optimizedRemoveTime = performance.now() - start;

  console.log(`Playlist Size: ${size}`);
  console.log(`Video Ended:`);
  console.log(`  Original: ${originalVideoEndedTime.toFixed(2)} ms`);
  console.log(`  Optimized: ${optimizedVideoEndedTime.toFixed(2)} ms`);
  console.log(`  Improvement: ${(originalVideoEndedTime / optimizedVideoEndedTime).toFixed(2)}x faster`);
  console.log(`Remove Item (0th element):`);
  console.log(`  Original: ${originalRemoveTime.toFixed(2)} ms`);
  console.log(`  Optimized: ${optimizedRemoveTime.toFixed(2)} ms`);
  console.log(`  Improvement: ${(originalRemoveTime / optimizedRemoveTime).toFixed(2)}x faster\n`);
}

runBenchmark(500);
