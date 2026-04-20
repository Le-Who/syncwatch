## 2024-03-05 - Optimize Array Finding in Redis Worker

**Learning:** O(N^2) `.find()` operations within loops mapping over array IDs can severely bottleneck performance as array sizes increase (e.g., maximum 500 playlist limit).
**Action:** Replace nested `.find()` searches with a pre-computed O(N) `Map` linking array identifiers to their respective items, drastically improving lookup speed to O(1).
## 2026-04-20 - Optimize Room Logic Array Searching
**Learning:** Redundant O(N) `Array.find()` calls to locate the active item or just-added item in `lib/room-logic.ts` add unnecessary overhead when the index is implicitly known (e.g., position 0 after setting it) or explicitly derived (via `findIndex`).
**Action:** Replace nested or sequential array searches with direct index references or by reusing the result of `findIndex()` to achieve O(1) lookups.
