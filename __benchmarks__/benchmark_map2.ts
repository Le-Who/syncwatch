import { randomUUID } from "crypto";
import { performance } from "perf_hooks";

const size = 500;
const items = Array.from({ length: size }, (_, i) => ({
  id: randomUUID(),
  title: `Video ${i}`,
}));

const searchId1 = items[0].id;
const searchId2 = items[400].id;

const startMap = performance.now();
for (let iter = 0; iter < 10000; iter++) {
  const map = new Map();
  for (const item of items) map.set(item.id, item);
  map.get(searchId1);
  map.get(searchId2);
}
const timeMap = performance.now() - startMap;

const startFind = performance.now();
for (let iter = 0; iter < 10000; iter++) {
  items.find((i) => i.id === searchId1);
  items.find((i) => i.id === searchId2);
}
const timeFind2 = performance.now() - startFind;

const startIndex = performance.now();
for (let iter = 0; iter < 10000; iter++) {
  const index: Record<string, any> = {};
  for (const item of items) index[item.id] = item;
  index[searchId1];
  index[searchId2];
}
const timeIndex = performance.now() - startIndex;

console.log(`Map: ${timeMap.toFixed(2)}ms`);
console.log(`Find: ${timeFind2.toFixed(2)}ms`);
console.log(`Index: ${timeIndex.toFixed(2)}ms`);
