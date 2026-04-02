## 2024-03-05 - Optimize Array Finding in Redis Worker

**Learning:** O(N^2) `.find()` operations within loops mapping over array IDs can severely bottleneck performance as array sizes increase (e.g., maximum 500 playlist limit).
**Action:** Replace nested `.find()` searches with a pre-computed O(N) `Map` linking array identifiers to their respective items, drastically improving lookup speed to O(1).

## 2024-03-05 - Avoid redundant array traversals
**Learning:** Multiple O(N) array traversals (e.g., .find() followed by .findIndex() for the same condition) in synchronous mutation loops can degrade performance for large arrays.
**Action:** Extract the item or index once, and pass it to helper functions or use it for subsequent operations to minimize array scans.
