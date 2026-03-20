import { randomUUID } from "crypto";
import { performance } from "perf_hooks";

function currentImplementation(room, items) {
  let stateChanged = false;
  for (const cmd of items) {
    if (cmd.type === "set_media") {
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
        targetItemForSet.lastPosition = 0;
      }
      stateChanged = true;
    } else if (cmd.type === "next") {
      const activeItemNext = room.playlist.find(
        (i) => i.id === room.currentMediaId,
      );
      if (activeItemNext) {
        activeItemNext.lastPosition = 123;
      }
      const currentIndex = room.playlist.findIndex(
        (i) => i.id === room.currentMediaId,
      );
      if (currentIndex !== -1 && currentIndex < room.playlist.length - 1) {
        room.currentMediaId = room.playlist[currentIndex + 1].id;
      }
      stateChanged = true;
    }
  }
}

function lazyMapImplementation(room, items) {
  let stateChanged = false;
  let playlistIndex = null;
  const getIndex = () => {
    if (!playlistIndex) {
      playlistIndex = new Map();
      for (let i = 0; i < room.playlist.length; i++) {
        playlistIndex.set(room.playlist[i].id, {
          item: room.playlist[i],
          index: i,
        });
      }
    }
    return playlistIndex;
  };

  for (const cmd of items) {
    if (cmd.type === "set_media") {
      const idx = getIndex();
      const activeEntry = idx.get(room.currentMediaId);
      if (activeEntry) {
        activeEntry.item.lastPosition = 123;
      }
      room.currentMediaId = cmd.payload.itemId;
      const targetEntry = idx.get(cmd.payload.itemId);
      if (targetEntry) {
        targetEntry.item.lastPosition = 0;
      }
      stateChanged = true;
    } else if (cmd.type === "next") {
      const idx = getIndex();
      const activeEntry = idx.get(room.currentMediaId);
      if (activeEntry) {
        activeEntry.item.lastPosition = 123;
        const currentIndex = activeEntry.index;
        if (currentIndex < room.playlist.length - 1) {
          room.currentMediaId = room.playlist[currentIndex + 1].id;
        }
      }
      stateChanged = true;
    }
  }
}

function runBench(size, queueLength) {
  const itemsArray = Array.from({ length: size }, (_, i) => ({
    id: randomUUID(),
    title: `Video ${i}`,
    lastPosition: 0,
  }));

  const commands = Array.from({ length: queueLength }, () => ({
    type: "set_media",
    payload: { itemId: itemsArray[Math.floor(Math.random() * size)].id },
  }));

  const ITERATIONS = 5000;

  let start = performance.now();
  for (let iter = 0; iter < ITERATIONS; iter++) {
    const room = { playlist: itemsArray, currentMediaId: itemsArray[0].id };
    currentImplementation(room, commands);
  }
  const timeCurrent = performance.now() - start;

  start = performance.now();
  for (let iter = 0; iter < ITERATIONS; iter++) {
    const room = { playlist: itemsArray, currentMediaId: itemsArray[0].id };
    lazyMapImplementation(room, commands);
  }
  const timeLazy = performance.now() - start;

  console.log(`Size: ${size}, Queue: ${queueLength}`);
  console.log(`  Current: ${timeCurrent.toFixed(2)}ms`);
  console.log(`  LazyMap: ${timeLazy.toFixed(2)}ms`);
}

runBench(500, 1);
runBench(500, 5);
runBench(500, 20);
