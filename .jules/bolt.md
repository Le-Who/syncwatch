## 2024-03-05 - Optimize Array Finding in Redis Worker

**Learning:** O(N^2) `.find()` operations within loops mapping over array IDs can severely bottleneck performance as array sizes increase (e.g., maximum 500 playlist limit).
**Action:** Replace nested `.find()` searches with a pre-computed O(N) `Map` linking array identifiers to their respective items, drastically improving lookup speed to O(1).

## 2024-03-05 - Avoid Over-Subscribing to Zustand Store State

**Learning:** Destructuring properties directly from the result of a `useStore()` call that returns the entire state object causes the component to re-render whenever *any* state property changes, even if the component only uses a small subset of the state. This is especially problematic with high-frequency updates like `serverClockOffset`.
**Action:** Always use strict, granular selectors with `useStore` or utilize the `useShallow` hook (e.g. `useStore(useShallow((state) => ({ ... })))`) when extracting multiple values, ensuring the component only re-renders when the specific data it needs is updated.
