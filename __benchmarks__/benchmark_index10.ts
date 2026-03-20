import { randomUUID } from "crypto";
import { performance } from "perf_hooks";

function bench() {
  const size = 500;
  const items = Array.from({ length: size }, (_, i) => ({
    id: randomUUID(),
    title: `Video ${i}`,
    duration: 100,
    startPosition: 0,
    lastPosition: 0,
  }));

  const commands = Array.from({ length: 5 }, () => ({
    type: "set_media",
    payload: { itemId: items[Math.floor(Math.random() * size)].id },
  }));

  const ITERATIONS = 10000;

  let start = performance.now();
  for (let iter = 0; iter < ITERATIONS; iter++) {
    const room = {
      playlist: items,
      currentMediaId: items[0].id,
      playback: {
        status: "playing",
        baseTimestamp: 0,
        basePosition: 0,
        rate: 1,
      },
    };
    for (const cmd of commands) {
      const activeItemSet = room.playlist.find(
        (i) => i.id === room.currentMediaId,
      );
      if (activeItemSet) {
        activeItemSet.lastPosition = 123;
      }
      room.currentMediaId = cmd.payload.itemId;
      const targetItemForSet = room.playlist.find(
        (i) => i.id === cmd.payload.itemId,
      );
      if (targetItemForSet) {
        targetItemForSet.lastPosition = 123;
      }
    }
  }
  const timeFind = performance.now() - start;

  start = performance.now();
  for (let iter = 0; iter < ITERATIONS; iter++) {
    const room = {
      playlist: items,
      currentMediaId: items[0].id,
      playback: {
        status: "playing",
        baseTimestamp: 0,
        basePosition: 0,
        rate: 1,
      },
    };

    // Instead of Map, we can just do single loop to find what we need to minimize allocations
    for (const cmd of commands) {
      let activeItemSet, targetItemForSet;
      for (let i = 0; i < room.playlist.length; i++) {
        const item = room.playlist[i];
        if (item.id === room.currentMediaId) activeItemSet = item;
        if (item.id === cmd.payload.itemId) targetItemForSet = item;
        if (activeItemSet && targetItemForSet) break;
      }
      if (activeItemSet) {
        activeItemSet.lastPosition = 123;
      }
      room.currentMediaId = cmd.payload.itemId;
      if (targetItemForSet) {
        targetItemForSet.lastPosition = 123;
      }
    }
  }
  const timeSingleLoop = performance.now() - start;

  console.log(`find: ${timeFind.toFixed(2)}ms`);
  console.log(`singleLoop: ${timeSingleLoop.toFixed(2)}ms`);
  console.log(`improvement: ${(timeFind / timeSingleLoop).toFixed(2)}x faster`);
}

bench();
