## 2024-03-05 - Optimize Array Finding in Redis Worker

**Learning:** O(N^2) `.find()` operations within loops mapping over array IDs can severely bottleneck performance as array sizes increase (e.g., maximum 500 playlist limit).
**Action:** Replace nested `.find()` searches with a pre-computed O(N) `Map` linking array identifiers to their respective items, drastically improving lookup speed to O(1).
## 2024-11-20 - Optimize Redundant Array Searches in Sync Logic
**Learning:** In performance-critical synchronous logic, making duplicate O(N) calls to both `.find()` and `.findIndex()` for the same ID creates unnecessary CPU overhead.
**Action:** Eliminate redundant `Array.find()` calls by reusing the result of `Array.findIndex()`, and use direct O(1) index access (e.g., `playlist[0]`) instead of searching by ID when the element's position is already known.
