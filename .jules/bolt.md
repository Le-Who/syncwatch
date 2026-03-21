## 2024-03-05 - Optimize Array Finding in Redis Worker

**Learning:** O(N^2) `.find()` operations within loops mapping over array IDs can severely bottleneck performance as array sizes increase (e.g., maximum 500 playlist limit).
**Action:** Replace nested `.find()` searches with a pre-computed O(N) `Map` linking array identifiers to their respective items, drastically improving lookup speed to O(1).

## 2024-03-22 - O(N) Array Finding In Redis Queue Worker

**Learning:** Repeated O(N) array lookups (like \`.find()\` or \`.findIndex()\`) inside batched queue processing loops cause unnecessary overhead when processing many commands at once. However, blindly precomputing a \`Map\` per batch iteration adds allocation overhead.
**Action:** Use a lazily evaluated dictionary index (\`Record<string, number>\`) scoped to the batch processing loop that builds on first use and is invalidated (\`index = null\`) whenever the array is structurally mutated. This provides O(1) lookups inside the loop while avoiding precomputation cost when not needed.
