## 2024-03-05 - Optimize Array Finding in Redis Worker

**Learning:** O(N^2) `.find()` operations within loops mapping over array IDs can severely bottleneck performance as array sizes increase (e.g., maximum 500 playlist limit).
**Action:** Replace nested `.find()` searches with a pre-computed O(N) `Map` linking array identifiers to their respective items, drastically improving lookup speed to O(1).

## 2026-05-14 - Prevent Unnecessary Re-renders from Zustand Subscriptions

**Learning:** Destructuring directly from `useStore()` without a selector subscribes the component to the entire store, causing unnecessary re-renders on unrelated state changes (like `serverClockOffset`).
**Action:** Always use granular selectors (e.g., `const room = useStore((s) => s.room)`) or `useShallow` when extracting multiple properties from the store to ensure components only re-render when their specific dependencies change.
