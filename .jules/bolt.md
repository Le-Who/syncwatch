## 2024-03-05 - Optimize Array Finding in Redis Worker

**Learning:** O(N^2) `.find()` operations within loops mapping over array IDs can severely bottleneck performance as array sizes increase (e.g., maximum 500 playlist limit).
**Action:** Replace nested `.find()` searches with a pre-computed O(N) `Map` linking array identifiers to their respective items, drastically improving lookup speed to O(1).

## 2024-05-08 - Prevent unnecessary re-renders in Zustand components
**Learning:** Destructuring directly from `useStore()` without a selector subscribes the component to the entire state object, causing it to unnecessarily re-render whenever *any* unrelated state changes (e.g., `serverClockOffset`).
**Action:** Always use `useShallow` (from `zustand/react/shallow`) or granular selectors when extracting multiple properties from the store to ensure components only re-render when their specific dependencies change.
