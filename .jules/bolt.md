## 2024-03-05 - Optimize Array Finding in Redis Worker

**Learning:** O(N^2) `.find()` operations within loops mapping over array IDs can severely bottleneck performance as array sizes increase (e.g., maximum 500 playlist limit).
**Action:** Replace nested `.find()` searches with a pre-computed O(N) `Map` linking array identifiers to their respective items, drastically improving lookup speed to O(1).

## 2024-05-06 - Prevent Unnecessary Re-renders from Zustand Stores

**Learning:** Destructuring directly from `useStore()` without providing a selector (e.g., `const { room } = useStore()`) implicitly subscribes the component to the *entire* state object. This causes the component to needlessly re-render on any state change, even completely unrelated ones like `serverClockOffset` ticking rapidly in the background, significantly degrading rendering performance.
**Action:** Always use granular selectors (e.g., `const room = useStore((s) => s.room);`) or `useShallow` from `zustand/react/shallow` to extract specific properties, guaranteeing the component only re-renders when the exact dependencies it cares about change.
