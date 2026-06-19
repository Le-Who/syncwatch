## 2024-03-05 - Optimize Array Finding in Redis Worker

**Learning:** O(N^2) `.find()` operations within loops mapping over array IDs can severely bottleneck performance as array sizes increase (e.g., maximum 500 playlist limit).
**Action:** Replace nested `.find()` searches with a pre-computed O(N) `Map` linking array identifiers to their respective items, drastically improving lookup speed to O(1).

## 2024-06-20 - Optimize Zustand Store Destructuring with useShallow

**Learning:** Destructuring directly from `useStore()` without a selector subscribes components to the entire store, causing unnecessary re-renders on unrelated, frequent updates like `serverClockOffset`.
**Action:** Always use granular selectors or `useShallow` from `zustand/react/shallow` to extract specific needed properties and prevent unnecessary re-renders.
