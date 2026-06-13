## 2024-03-05 - Optimize Array Finding in Redis Worker

**Learning:** O(N^2) `.find()` operations within loops mapping over array IDs can severely bottleneck performance as array sizes increase (e.g., maximum 500 playlist limit).
**Action:** Replace nested `.find()` searches with a pre-computed O(N) `Map` linking array identifiers to their respective items, drastically improving lookup speed to O(1).

## 2024-03-05 - Avoid Zustand Destructuring Re-renders

**Learning:** Destructuring directly from `useStore()` without selectors subscribes components to the entire store state. Unrelated updates (like `serverClockOffset` which changes frequently) trigger full re-renders across heavy components (e.g., `Playlist`, `Participants`), degrading performance.
**Action:** Always wrap state retrievals that return multiple properties with `useShallow` (from `zustand/react/shallow`) to scope subscriptions tightly to required dependencies.
