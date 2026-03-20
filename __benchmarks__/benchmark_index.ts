import { randomUUID } from "crypto";
import { performance } from "perf_hooks";

function bench() {
  const size = 500;
  const items = Array.from({ length: size }, (_, i) => ({
    id: randomUUID(),
    title: `Video ${i}`,
  }));

  const commands = Array.from({ length: 50 }, () => ({
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
    let playlistIndex: Map<string, number> | null = null;
    const getIndex = () => {
      if (!playlistIndex) {
        playlistIndex = new Map();
        for (let i = 0; i < room.playlist.length; i++) {
          playlistIndex.set(room.playlist[i].id, i);
        }
      }
      return playlistIndex;
    };
    for (const cmd of commands) {
      const idx = getIndex();
      const activeIdx = idx.get(room.currentMediaId);
      const activeItem =
        activeIdx !== undefined ? room.playlist[activeIdx] : undefined;
      const targetIdx = idx.get(cmd.payload.itemId);
      const targetItem =
        targetIdx !== undefined ? room.playlist[targetIdx] : undefined;
      room.currentMediaId = cmd.payload.itemId;
    }
  }
  const timeIndex = performance.now() - start;

  console.log(`find: ${timeFind.toFixed(2)}ms`);
  console.log(`index: ${timeIndex.toFixed(2)}ms`);
}

bench();
