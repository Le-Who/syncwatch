## 2024-03-05 - Optimize Array Finding in Redis Worker

**Learning:** O(N^2) `.find()` operations within loops mapping over array IDs can severely bottleneck performance as array sizes increase (e.g., maximum 500 playlist limit).
**Action:** Replace nested `.find()` searches with a pre-computed O(N) `Map` linking array identifiers to their respective items, drastically improving lookup speed to O(1).

## 2024-05-24 - React List Memoization Pitfalls
**Learning:** Extracting an inline component from an array map function into `React.memo` will not prevent re-renders if the component's props include a global, rapidly changing object (like the `room` state in this application). React.memo performs a shallow comparison, and every time any property in the global object changes (e.g., playback time ticking), the object reference changes, causing all list items to re-render despite the memoization.
**Action:** Always strictly narrow the props passed to `React.memo`ized components. Pass primitive values or stable references (using `useCallback` for handlers) instead of entire state objects. For conditionally needed complex state (like active item playback metrics), conditionally pass `undefined` for inactive items, ensuring that only the active item re-renders on global state ticks.
