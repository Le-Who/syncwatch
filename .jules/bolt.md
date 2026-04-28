## 2024-03-05 - Optimize Array Finding in Redis Worker

**Learning:** O(N^2) `.find()` operations within loops mapping over array IDs can severely bottleneck performance as array sizes increase (e.g., maximum 500 playlist limit).
**Action:** Replace nested `.find()` searches with a pre-computed O(N) `Map` linking array identifiers to their respective items, drastically improving lookup speed to O(1).

## 2024-05-24 - Avoid Redundant Array Searches in Synchronous Reducers
**Learning:** In performance-critical synchronous room state mutations, performing redundant `.find()` and `.findIndex()` calls for the same element, or searching by ID when the array position (like `playlist[0]`) is already known, wastes CPU cycles.
**Action:** Eliminate redundant `Array.find()` calls by reusing the result of `Array.findIndex()`, and use direct O(1) index access when the element's position is known.
