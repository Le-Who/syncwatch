## 2024-03-05 - Optimize Array Finding in Redis Worker

**Learning:** O(N^2) `.find()` operations within loops mapping over array IDs can severely bottleneck performance as array sizes increase (e.g., maximum 500 playlist limit).
**Action:** Replace nested `.find()` searches with a pre-computed O(N) `Map` linking array identifiers to their respective items, drastically improving lookup speed to O(1).

## 2024-06-03 - Optimize Redundant Array Traversals in State Mutations

**Learning:** Video transition events (`applyVideoEnded`, `applyNext`) were suffering from invisible performance penalties by redundantly traversing the playlist up to 3 separate times to find the same active item and index (via `find()` and `findIndex()` in both the caller and `snapshotActiveItemPosition`).
**Action:** Consolidate these into a single O(N) `findIndex()` call, using the resulting index to perform an O(1) array access, and pass the resolved item down to helper functions to skip repeated lookups.
