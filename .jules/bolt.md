## 2024-03-05 - Optimize Array Finding in Redis Worker

**Learning:** O(N^2) `.find()` operations within loops mapping over array IDs can severely bottleneck performance as array sizes increase (e.g., maximum 500 playlist limit).
**Action:** Replace nested `.find()` searches with a pre-computed O(N) `Map` linking array identifiers to their respective items, drastically improving lookup speed to O(1).

## 2025-03-05 - Optimize State Mutation Array Traversal
**Learning:** O(N) `.find()` and `.findIndex()` calls within state mutation functions like `lib/room-logic.ts` frequently scan the exact same condition sequentially in an unoptimized way.
**Action:** Extract the index or item once and pass it as arguments to helper functions like `snapshotActiveItemPosition` to minimize array scans.
