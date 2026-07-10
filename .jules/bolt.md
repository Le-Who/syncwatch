## 2024-03-05 - Optimize Array Finding in Redis Worker

**Learning:** O(N^2) `.find()` operations within loops mapping over array IDs can severely bottleneck performance as array sizes increase (e.g., maximum 500 playlist limit).
**Action:** Replace nested `.find()` searches with a pre-computed O(N) `Map` linking array identifiers to their respective items, drastically improving lookup speed to O(1).
## 2024-03-05 - Avoid useShallow Anti-pattern with Objects
**Learning:** Destructuring deeply nested objects like `room` within Zustand's `useShallow()` (e.g., `useShallow(s => ({ room: s.room }))`) is a severe performance anti-pattern. Because deeply nested state changes references on any sub-property update (e.g., high-frequency playback position changes), the shallow equality check will *always* fail, forcing the React component to unnecessarily re-render on every tick while still paying the overhead of the shallow comparison loop.
**Action:** Always decouple components from volatile root objects by using purely granular, atomic selectors for specific primitive values or stable reference dictionaries (e.g., `useStore(s => s.room?.participants)`). For single-object lookups (e.g., `find()`), standard `useStore` is optimal since item references remain stable unless strictly mutated.
