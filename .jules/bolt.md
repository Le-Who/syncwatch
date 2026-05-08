## 2024-03-05 - Optimize Array Finding in Redis Worker

**Learning:** O(N^2) `.find()` operations within loops mapping over array IDs can severely bottleneck performance as array sizes increase (e.g., maximum 500 playlist limit).
**Action:** Replace nested `.find()` searches with a pre-computed O(N) `Map` linking array identifiers to their respective items, drastically improving lookup speed to O(1).

## 2024-05-08 - Eliminate redundant array searches in synchronous room logic
**Learning:** Found instances where both `Array.find()` and `Array.findIndex()` were being used sequentially to search for the same item in performance-critical synchronous room logic (like `applyVideoEnded` in `lib/room-logic.ts`).
**Action:** When both the item and its index are needed, use a single `Array.findIndex()` call and access the item via `array[index]` if the index is valid, cutting the array search overhead in half.
