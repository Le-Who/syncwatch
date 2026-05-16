## 2024-03-05 - Optimize Array Finding in Redis Worker

**Learning:** O(N^2) `.find()` operations within loops mapping over array IDs can severely bottleneck performance as array sizes increase (e.g., maximum 500 playlist limit).
**Action:** Replace nested `.find()` searches with a pre-computed O(N) `Map` linking array identifiers to their respective items, drastically improving lookup speed to O(1).
## 2024-11-20 - Prevent Component Re-renders with Zustand

**Learning:** Destructuring directly from `useStore()` without selectors (e.g., `const { room } = useStore()`) subscribes the component to the entire store state. This causes a full React render on *any* store update, which can cause UI stuttering.
**Action:** Always use granular selectors (e.g., `const room = useStore(useShallow(s => s.room))`) for complex objects or simple selectors for primitives to ensure the component only re-renders when the specific properties it subscribes to actually change.
