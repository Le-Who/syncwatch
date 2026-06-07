## 2024-03-05 - Optimize Array Finding in Redis Worker

**Learning:** O(N^2) `.find()` operations within loops mapping over array IDs can severely bottleneck performance as array sizes increase (e.g., maximum 500 playlist limit).
**Action:** Replace nested `.find()` searches with a pre-computed O(N) `Map` linking array identifiers to their respective items, drastically improving lookup speed to O(1).

## 2025-06-07 - Consolidate find() and findIndex()

**Learning:** Performing `Array.find()` followed immediately by `Array.findIndex()` for the same condition results in redundant O(N) iterations over the same array.
**Action:** Replace the dual calls by executing `Array.findIndex()` once, and then use O(1) index access (e.g., `array[index]`) to retrieve the item if the index is valid.
