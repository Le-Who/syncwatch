## 2024-03-05 - Optimize Array Finding in Redis Worker

**Learning:** O(N^2) `.find()` operations within loops mapping over array IDs can severely bottleneck performance as array sizes increase (e.g., maximum 500 playlist limit).
**Action:** Replace nested `.find()` searches with a pre-computed O(N) `Map` linking array identifiers to their respective items, drastically improving lookup speed to O(1).

## 2024-05-13 - Eliminate redundant Array searches
**Learning:** In performance-critical synchronous logic, making an `Array.find()` call when the array index is already known (e.g. from an adjacent `Array.findIndex()` or explicit assignment to index 0) results in unnecessary O(N) traversal.
**Action:** Always reuse the result of `findIndex` or use direct O(1) index access (like `playlist[0]`) instead of redundantly searching the array by ID.
