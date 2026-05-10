## 2024-03-05 - Optimize Array Finding in Redis Worker

**Learning:** O(N^2) `.find()` operations within loops mapping over array IDs can severely bottleneck performance as array sizes increase (e.g., maximum 500 playlist limit).
**Action:** Replace nested `.find()` searches with a pre-computed O(N) `Map` linking array identifiers to their respective items, drastically improving lookup speed to O(1).

## 2025-03-05 - Avoid Zustand Destructuring Without Selectors
**Learning:** Destructuring directly from `useStore()` without a selector subscribes the component to the entire state and triggers unnecessary re-renders on unrelated updates.
**Action:** Always use granular selectors or `useShallow` (imported from `zustand/react/shallow`) to extract specific needed properties.
