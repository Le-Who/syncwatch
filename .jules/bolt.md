## 2024-03-05 - Optimize Array Finding in Redis Worker

**Learning:** O(N^2) `.find()` operations within loops mapping over array IDs can severely bottleneck performance as array sizes increase (e.g., maximum 500 playlist limit).
**Action:** Replace nested `.find()` searches with a pre-computed O(N) `Map` linking array identifiers to their respective items, drastically improving lookup speed to O(1).

## 2026-05-16 - Zustand destructuring anti-pattern
**Learning:** Destructuring directly from `useStore()` without a selector (e.g., `const { room } = useStore()`) subscribes the component to the entire state. This causes frequent, unnecessary re-renders whenever unrelated state changes (like high-frequency clock synchronization updates).
**Action:** Always use granular selectors (e.g., `const room = useStore((s) => s.room)`) or `useShallow` to extract specific properties, significantly reducing React render cycles and improving frontend performance.
