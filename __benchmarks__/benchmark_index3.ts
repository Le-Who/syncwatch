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

    // Conditionally computing it inside the batch
    let playlistIndex: Map<string, any> | null = null;
    const getIndex = () => {
      if (!playlistIndex) {
        playlistIndex = new Map();
        for (let i = 0; i < room.playlist.length; i++) {
          playlistIndex.set(room.playlist[i].id, room.playlist[i]);
        }
      }
      return playlistIndex;
    };

    for (const cmd of commands) {
      const idx = getIndex();
      const activeItem = idx.get(room.currentMediaId);
      const targetItem = idx.get(cmd.payload.itemId);
      room.currentMediaId = cmd.payload.itemId;
    }
  }
  const timeLazyIndexMap = performance.now() - start;

  console.log(`Commands per batch: ${cmdCount}`);
  console.log(`  find: ${timeFind.toFixed(2)}ms`);
  console.log(`  lazyIndexMap: ${timeLazyIndexMap.toFixed(2)}ms`);
  console.log(
    `  ratio (lazy/find): ${(timeLazyIndexMap / timeFind).toFixed(2)}`,
  );
}

bench(1);
bench(2);
bench(3);
bench(5);
bench(10);
