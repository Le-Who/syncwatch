## 2024-03-05 - Optimize Array Finding in Redis Worker

**Learning:** O(N^2) `.find()` operations within loops mapping over array IDs can severely bottleneck performance as array sizes increase (e.g., maximum 500 playlist limit).
**Action:** Replace nested `.find()` searches with a pre-computed O(N) `Map` linking array identifiers to their respective items, drastically improving lookup speed to O(1).

## 2024-03-05 - Direct Array Access Optimization
**Learning:** Sequential `.find()` and `.findIndex()` calls with identical predicates on the same array are a common anti-pattern that doubles iteration overhead. Also, calling `.find()` when the target element's index is inherently known (e.g., the 0th element after manipulation) is an unnecessary O(N) operation.
**Action:** Consolidate redundant search passes by reusing the result of `Array.findIndex()` for direct O(1) element access. When an item's position is definitively known, bypass searching entirely and use direct bracket notation (e.g., `array[0]`).
