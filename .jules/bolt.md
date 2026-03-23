## 2024-03-05 - Optimize Array Finding in Redis Worker

**Learning:** O(N^2) `.find()` operations within loops mapping over array IDs can severely bottleneck performance as array sizes increase (e.g., maximum 500 playlist limit).
**Action:** Replace nested `.find()` searches with a pre-computed O(N) `Map` linking array identifiers to their respective items, drastically improving lookup speed to O(1).

## 2024-03-23 - Optimize Array Finding in Redis Worker (Revision)
**Learning:** Unconditionally precomputing a `Map` for array lookups introduces unnecessary allocation overhead, particularly when the underlying array undergoes frequent structural mutations (e.g., additions, removals) within the same processing batch.
**Action:** Instead of a `Map`, implement a lazily evaluated dictionary index (`Record<string, number>`) scoped to the batch processing loop. The index builds on first use and is explicitly invalidated (`index = null`) whenever the array is structurally mutated, ensuring O(1) lookups while minimizing allocation penalties.
