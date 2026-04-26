## 2024-03-05 - Optimize Array Finding in Redis Worker

**Learning:** O(N^2) `.find()` operations within loops mapping over array IDs can severely bottleneck performance as array sizes increase (e.g., maximum 500 playlist limit).
**Action:** Replace nested `.find()` searches with a pre-computed O(N) `Map` linking array identifiers to their respective items, drastically improving lookup speed to O(1).

## 2024-04-26 - Prevent Unnecessary Re-renders with Zustand useShallow
**Learning:** Destructuring directly from `useStore()` without a selector subscribes the component to the entire state. This causes performance issues and unnecessary re-renders when unrelated state fields (like high-frequency fields such as `serverClockOffset`) update.
**Action:** Always use granular selectors or `useShallow` from `zustand/react/shallow` to extract only the specific required properties when accessing Zustand stores.
