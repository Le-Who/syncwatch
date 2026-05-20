## 2024-03-05 - Optimize Array Finding in Redis Worker

**Learning:** O(N^2) `.find()` operations within loops mapping over array IDs can severely bottleneck performance as array sizes increase (e.g., maximum 500 playlist limit).
**Action:** Replace nested `.find()` searches with a pre-computed O(N) `Map` linking array identifiers to their respective items, drastically improving lookup speed to O(1).

## 2024-03-05 - Avoid Unconditional O(N) Lookups
**Learning:** Adding unconditional `for` loops or array lookups on hot code paths (even to clean up redundant loops) can accidentally cause minor de-optimizations if those lookups were previously guarded behind conditional statements.
**Action:** Always maintain the original conditional safeguards. If a lookup is only needed under specific conditions, place the lookup *inside* the condition, avoiding unnecessary work in the default or fast path.
