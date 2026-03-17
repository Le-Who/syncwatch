const crypto = require("crypto");

function setupTest(numItems, numNewOrderItems, oldIdsOverlap) {
  const playlist = [];
  const oldIds = new Set();
  const newOrderIds = [];

  // Create a playlist
  for (let i = 0; i < numItems; i++) {
    const id = crypto.randomUUID();
    playlist.push({ id, data: `data-${i}` });
    oldIds.add(id);

    if (i < numNewOrderItems) {
      newOrderIds.push(id);
    }
  }

  // shuffle newOrderIds
  for (let i = newOrderIds.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [newOrderIds[i], newOrderIds[j]] = [newOrderIds[j], newOrderIds[i]];
  }

  // add some new items to oldIds (simulate concurrent additions)
  for (let i = 0; i < oldIdsOverlap; i++) {
    const id = crypto.randomUUID();
    playlist.push({ id, data: `data-${numItems + i}` });
    oldIds.add(id);
  }

  return { playlist, oldIds, newOrderIds };
}

function runOldAlgorithm(playlist, oldIdsInput, newOrderIds) {
  const oldIds = new Set(oldIdsInput);
  const reconciledPlaylist = [];

  // 1. Maintain items that exist in both, in the new order
  for (const id of newOrderIds) {
    const item = playlist.find((i) => i.id === id);
    if (item) {
      reconciledPlaylist.push(item);
      oldIds.delete(id);
    }
  }

  // 2. Append items that were concurrently added (exist in oldIds but not in payload)
  for (const leftoverId of oldIds) {
    const item = playlist.find((i) => i.id === leftoverId);
    if (item) reconciledPlaylist.push(item);
  }

  return reconciledPlaylist;
}

function runNewAlgorithm(playlist, oldIdsInput, newOrderIds) {
  const oldIds = new Set(oldIdsInput);
  const reconciledPlaylist = [];

  // O(N) map preprocessing
  const playlistMap = new Map();
  for (const item of playlist) {
    playlistMap.set(item.id, item);
  }

  // 1. Maintain items that exist in both, in the new order
  for (const id of newOrderIds) {
    const item = playlistMap.get(id);
    if (item) {
      reconciledPlaylist.push(item);
      oldIds.delete(id);
    }
  }

  // 2. Append items that were concurrently added (exist in oldIds but not in payload)
  for (const leftoverId of oldIds) {
    const item = playlistMap.get(leftoverId);
    if (item) reconciledPlaylist.push(item);
  }

  return reconciledPlaylist;
}

function runBenchmark(numItems, numNewOrderItems, oldIdsOverlap) {
  const { playlist, oldIds, newOrderIds } = setupTest(
    numItems,
    numNewOrderItems,
    oldIdsOverlap,
  );

  console.log(
    `--- Benchmark: numItems=${numItems}, newOrderIds=${numNewOrderItems}, leftoverIds=${oldIdsOverlap} ---`,
  );

  // warm up
  runOldAlgorithm(playlist, oldIds, newOrderIds);
  runNewAlgorithm(playlist, oldIds, newOrderIds);

  const iters = 10000;

  const startOld = process.hrtime.bigint();
  for (let i = 0; i < iters; i++) {
    runOldAlgorithm(playlist, oldIds, newOrderIds);
  }
  const endOld = process.hrtime.bigint();

  const startNew = process.hrtime.bigint();
  for (let i = 0; i < iters; i++) {
    runNewAlgorithm(playlist, oldIds, newOrderIds);
  }
  const endNew = process.hrtime.bigint();

  const oldTimeMs = Number(endOld - startOld) / 1000000;
  const newTimeMs = Number(endNew - startNew) / 1000000;

  console.log(`Old Algorithm: ${oldTimeMs.toFixed(2)} ms`);
  console.log(`New Algorithm: ${newTimeMs.toFixed(2)} ms`);
  console.log(`Speedup: ${(oldTimeMs / newTimeMs).toFixed(2)}x\n`);
}

// 500 items is the max limit mentioned in the code
runBenchmark(500, 500, 10);
runBenchmark(500, 450, 50);
runBenchmark(100, 100, 5);
