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

    let playlistIndex: Map<string, number> | null = null;
    const getPlaylistIndex = () => {
      if (!playlistIndex) {
        playlistIndex = new Map();
        for (let i = 0; i < room.playlist.length; i++) {
          playlistIndex.set(room.playlist[i].id, i);
        }
      }
      return playlistIndex;
    };

    for (const cmd of commands) {
      const activeIdx = getPlaylistIndex().get(room.currentMediaId);
      const activeItemSet =
        activeIdx !== undefined ? room.playlist[activeIdx] : undefined;
      if (activeItemSet) {
        activeItemSet.lastPosition = 123;
      }
      room.currentMediaId = cmd.payload.itemId;
      const targetIdx = getPlaylistIndex().get(cmd.payload.itemId);
      const targetItemForSet =
        targetIdx !== undefined ? room.playlist[targetIdx] : undefined;
      if (targetItemForSet) {
        targetItemForSet.lastPosition = 123;
      }
    }
  }
  const timeLazyIndex = performance.now() - start;

  console.log(`find: ${timeFind.toFixed(2)}ms`);
  console.log(`lazyIndex: ${timeLazyIndex.toFixed(2)}ms`);
  console.log(`improvement: ${(timeFind / timeLazyIndex).toFixed(2)}x faster`);
}

bench();
