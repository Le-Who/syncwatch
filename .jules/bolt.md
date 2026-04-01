## 2024-03-05 - Optimize Array Finding in Redis Worker

**Learning:** O(N^2) `.find()` operations within loops mapping over array IDs can severely bottleneck performance as array sizes increase (e.g., maximum 500 playlist limit).
**Action:** Replace nested `.find()` searches with a pre-computed O(N) `Map` linking array identifiers to their respective items, drastically improving lookup speed to O(1).

## 2026-04-01 - Remove redundant O(N) array scans in room state mutations
**Learning:** Command handlers in `lib/room-logic.ts` repeatedly scanned the playlist array using `.findIndex()` and `.find()` for the same item ID or condition (e.g., finding the active item while also finding the index to remove or mutate).
**Action:** Avoid redundant O(N) traversals by extracting the item or index once using `findIndex`, reusing the item reference, and utilizing array mutations like `splice` instead of `filter`.
