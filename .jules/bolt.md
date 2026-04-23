## 2024-03-05 - Optimize Array Finding in Redis Worker
**Learning:** O(N^2) `.find()` operations within loops mapping over array IDs can severely bottleneck performance as array sizes increase (e.g., maximum 500 playlist limit).
**Action:** Replace nested `.find()` searches with a pre-computed O(N) `Map` linking array identifiers to their respective items, drastically improving lookup speed to O(1).

## 2024-03-05 - Zustand Destructuring Performance Issue
**Learning:** Component `RoomPage`, `Playlist`, `RoomSettingsDialog` and `Participants` destructured `useStore()` directly without granular selectors (e.g., `const { room, isConnected } = useStore()`). This subscribed them to the ENTIRE state object, so any minor update (like `serverClockOffset` firing every few seconds, or `commandSequence` changes) triggered full React re-renders of the entire page or heavy components, tanking performance.
**Action:** Replace `const { x, y } = useStore()` with granular selectors `const x = useStore(s => s.x)` or `useShallow` when selecting objects/arrays to limit re-renders strictly to changes in the properties the component actually uses.
