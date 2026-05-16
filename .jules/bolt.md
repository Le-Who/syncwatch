## 2024-03-05 - Optimize Array Finding in Redis Worker

**Learning:** O(N^2) `.find()` operations within loops mapping over array IDs can severely bottleneck performance as array sizes increase (e.g., maximum 500 playlist limit).
**Action:** Replace nested `.find()` searches with a pre-computed O(N) `Map` linking array identifiers to their respective items, drastically improving lookup speed to O(1).

## 2024-03-05 - Avoid direct destructuring of useStore without selectors
**Learning:** Destructuring `useStore()` directly without selectors subscribes the component to the entire state. This triggers unnecessary re-renders on any state update, even unrelated ones (like `serverClockOffset`), which can severely degrade frontend performance.
**Action:** Always use granular selectors (e.g., `const room = useStore((s) => s.room);`) or `useShallow` from `zustand/react/shallow` to extract only the specific properties needed.
