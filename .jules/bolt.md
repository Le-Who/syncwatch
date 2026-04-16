## 2024-03-05 - Optimize Array Finding in Redis Worker

**Learning:** O(N^2) `.find()` operations within loops mapping over array IDs can severely bottleneck performance as array sizes increase (e.g., maximum 500 playlist limit).
**Action:** Replace nested `.find()` searches with a pre-computed O(N) `Map` linking array identifiers to their respective items, drastically improving lookup speed to O(1).
## 2024-04-16 - Optimize Array Finding in Room Logic
**Learning:** Using `Array.find()` followed immediately by `Array.findIndex()` for the same element results in redundant O(N) traversals, and using `.find()` to retrieve an item when its index is already known (like checking the new head of a playlist) is highly inefficient.
**Action:** Re-use the output of `findIndex` to eliminate the extra `find` loop, and leverage O(1) direct array access (`array[0]`) when checking deterministic positions to reduce traversal overhead in synchronous state logic.
