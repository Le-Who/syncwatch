## 2024-03-05 - Optimize Array Finding in Redis Worker

**Learning:** O(N^2) `.find()` operations within loops mapping over array IDs can severely bottleneck performance as array sizes increase (e.g., maximum 500 playlist limit).
**Action:** Replace nested `.find()` searches with a pre-computed O(N) `Map` linking array identifiers to their respective items, drastically improving lookup speed to O(1).

## 2024-03-06 - Prevent Unnecessary Re-renders from Zustand useStore

**Learning:** Destructuring directly from `useStore()` without a selector subscribes the component to the entire state object. Any state change, including high-frequency updates like `serverClockOffset`, causes expensive components to unnecessarily re-render, leading to performance degradation.
**Action:** Always use granular selectors or `useShallow` from `zustand/react/shallow` to extract only the required properties when consuming state from `useStore`.
