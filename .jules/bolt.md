## 2024-03-05 - Optimize Array Finding in Redis Worker

**Learning:** O(N^2) `.find()` operations within loops mapping over array IDs can severely bottleneck performance as array sizes increase (e.g., maximum 500 playlist limit).
**Action:** Replace nested `.find()` searches with a pre-computed O(N) `Map` linking array identifiers to their respective items, drastically improving lookup speed to O(1).
## 2024-11-23 - Prevent Zustand Component Re-Renders
**Learning:** Destructuring directly from `useStore()` without a selector subscribes the component to the entire state object. This causes unnecessary re-renders whenever unrelated state (like `serverClockOffset`) updates, severely degrading frontend performance.
**Action:** Always use Zustand`s `useShallow` hook when selecting multiple state properties to isolate components from unrelated state updates and eliminate wasteful rendering cycles.
