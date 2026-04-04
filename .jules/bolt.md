## 2024-03-05 - Optimize Array Finding in Redis Worker

**Learning:** O(N^2) `.find()` operations within loops mapping over array IDs can severely bottleneck performance as array sizes increase (e.g., maximum 500 playlist limit).
**Action:** Replace nested `.find()` searches with a pre-computed O(N) `Map` linking array identifiers to their respective items, drastically improving lookup speed to O(1).
## 2024-03-05 - Consolidate Redundant O(N) Array Traversals

**Learning:** Redundant O(N) array traversals (e.g., using both `.find()` and `.findIndex()` for the same item in succession, or chaining `.find()` inside another function while the caller already has the index) add unnecessary overhead, particularly in synchronous pure state mutation functions (e.g., room logic).
**Action:** Consolidate multiple O(N) lookups into a single traversal (e.g., just `.findIndex()`) and pass the located item into helper functions (using optional parameters) to avoid nested redundant lookups.
