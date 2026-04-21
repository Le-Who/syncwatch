## 2024-03-05 - Optimize Array Finding in Redis Worker

**Learning:** O(N^2) `.find()` operations within loops mapping over array IDs can severely bottleneck performance as array sizes increase (e.g., maximum 500 playlist limit).
**Action:** Replace nested `.find()` searches with a pre-computed O(N) `Map` linking array identifiers to their respective items, drastically improving lookup speed to O(1).

## 2024-04-21 - Eliminate Redundant Array Traversals in Room Logic

**Learning:** Redundant array traversals, such as using `Array.find()` when the target's index is already known or predictable (e.g., searching for the first element, or performing `.find()` immediately followed by `.findIndex()` for the same ID), cause unnecessary O(N) operations in synchronous critical paths.
**Action:** Replace `Array.find()` with direct O(1) index access (e.g., `array[0]`) when position is guaranteed, and consolidate paired `.find()`/`.findIndex()` calls by executing `.findIndex()` first and using its result for O(1) item retrieval.
