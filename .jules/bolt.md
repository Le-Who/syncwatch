## 2024-03-05 - Optimize Array Finding in Redis Worker

**Learning:** O(N^2) `.find()` operations within loops mapping over array IDs can severely bottleneck performance as array sizes increase (e.g., maximum 500 playlist limit).
**Action:** Replace nested `.find()` searches with a pre-computed O(N) `Map` linking array identifiers to their respective items, drastically improving lookup speed to O(1).
## 2024-06-21 - Zustand Subscription Bottleneck

**Learning:** Destructuring directly from `useStore()` without granular selectors causes components to subscribe to the entire store state. This leads to frequent, unnecessary re-renders when unrelated fast-updating state (like `serverClockOffset`) changes.
**Action:** Always use granular selectors (e.g., `const room = useStore((s) => s.room)`) or `useShallow` when extracting state from Zustand stores to ensure components only re-render when their specific dependencies change.
