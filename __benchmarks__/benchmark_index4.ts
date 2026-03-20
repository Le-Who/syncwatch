import { randomUUID } from "crypto";
import { performance } from "perf_hooks";

function bench(cmdCount) {
  const size = 500;
  const items = Array.from({ length: size }, (_, i) => ({
    id: randomUUID(),
    title: `Video ${i}`,
  }));

  const commands = Array.from({ length: cmdCount }, () => ({
    type: "set_media",
    payload: { itemId: items[Math.floor(Math.random() * size)].id },
  }));

  const ITERATIONS = 10000;

  let start = performance.now();
  for (let iter = 0; iter < ITERATIONS; iter++) {
    const room = { playlist: items, currentMediaId: items[0].id };
    for (const cmd of commands) {
      const activeItem = room.playlist.find(
        (i) => i.id === room.currentMediaId,
      );
      const targetItem = room.playlist.find((i) => i.id === cmd.payload.itemId);
      room.currentMediaId = cmd.payload.itemId;
    }
  }
  const timeFind = performance.now() - start;

  start = performance.now();
  for (let iter = 0; iter < ITERATIONS; iter++) {
    const room = { playlist: items, currentMediaId: items[0].id };

    // Using a map
    let playlistIndex: Map<string, any> = new Map();
    for (let i = 0; i < room.playlist.length; i++) {
      playlistIndex.set(room.playlist[i].id, room.playlist[i]);
    }

    for (const cmd of commands) {
      const activeItem = playlistIndex.get(room.currentMediaId);
      const targetItem = playlistIndex.get(cmd.payload.itemId);
      room.currentMediaId = cmd.payload.itemId;
    }
  }
  const timeIndexMap = performance.now() - start;

  console.log(`Commands per batch: ${cmdCount}`);
  console.log(`  find: ${timeFind.toFixed(2)}ms`);
  console.log(`  indexMap: ${timeIndexMap.toFixed(2)}ms`);
  console.log(`  ratio (map/find): ${(timeIndexMap / timeFind).toFixed(2)}`);
}

bench(1);
bench(2);
bench(3);
bench(5);
bench(10);
