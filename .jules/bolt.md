## 2024-03-05 - Optimize Array Finding in Redis Worker

**Learning:** O(N^2) `.find()` operations within loops mapping over array IDs can severely bottleneck performance as array sizes increase (e.g., maximum 500 playlist limit).
**Action:** Replace nested `.find()` searches with a pre-computed O(N) `Map` linking array identifiers to their respective items, drastically improving lookup speed to O(1).
## 2026-07-17 - Optimize Zustand selectors
**Learning:** Destructuring entire nested objects like `room` within `useShallow` always fails the shallow equality check on any sub-property update, causing excessive re-renders.
**Action:** Use purely granular, atomic selectors for specific primitive values instead of returning the entire object.
