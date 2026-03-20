import { randomUUID } from "crypto";
import { performance } from "perf_hooks";

function bench() {
  const size = 500;
  const items = Array.from({ length: size }, (_, i) => ({
    id: randomUUID(),
    title: `Video ${i}`,
  }));

  const commands = Array.from({ length: 1 }, () => ({
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
    for (const cmd of commands) {
      let activeItem, targetItem;
      for (let i = 0; i < room.playlist.length; i++) {
        const item = room.playlist[i];
        if (item.id === room.currentMediaId) activeItem = item;
        if (item.id === cmd.payload.itemId) targetItem = item;
        if (activeItem && targetItem) break;
      }
      room.currentMediaId = cmd.payload.itemId;
    }
  }
  const timeSinglePass = performance.now() - start;

  start = performance.now();
  for (let iter = 0; iter < ITERATIONS; iter++) {
    const room = { playlist: items, currentMediaId: items[0].id };

    // Conditionally computing it inside the batch
    let playlistIndex: Record<string, any> | null = null;
    const getIndex = () => {
      if (!playlistIndex) {
        playlistIndex = {};
        for (let i = 0; i < room.playlist.length; i++) {
          playlistIndex[room.playlist[i].id] = room.playlist[i];
        }
      }
      return playlistIndex;
    };

    for (const cmd of commands) {
      const idx = getIndex();
      const activeItem = idx[room.currentMediaId];
      const targetItem = idx[cmd.payload.itemId];
      room.currentMediaId = cmd.payload.itemId;
    }
  }
  const timeLazyIndexRecord = performance.now() - start;

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

  console.log(`find: ${timeFind.toFixed(2)}ms`);
  console.log(`singlePass: ${timeSinglePass.toFixed(2)}ms`);
  console.log(`lazyIndexRecord: ${timeLazyIndexRecord.toFixed(2)}ms`);
  console.log(`lazyIndexMap: ${timeLazyIndexMap.toFixed(2)}ms`);
}

bench();
