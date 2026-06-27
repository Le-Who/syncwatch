## 2024-03-05 - Optimize Array Finding in Redis Worker

**Learning:** O(N^2) `.find()` operations within loops mapping over array IDs can severely bottleneck performance as array sizes increase (e.g., maximum 500 playlist limit).
**Action:** Replace nested `.find()` searches with a pre-computed O(N) `Map` linking array identifiers to their respective items, drastically improving lookup speed to O(1).
## 2024-03-05 - Optimize Zustand Component Subscriptions

**Learning:** Destructuring entire state objects from `useStore()` without a selector implicitly subscribes the component to every field in the Zustand store, leading to excessive React re-renders when unrelated fast-changing fields update (like clocks or rollbacks).
**Action:** Always wrap granular selections with `useShallow` from `zustand/react/shallow` to strictly bound component re-renders to only the properties the component depends upon.
