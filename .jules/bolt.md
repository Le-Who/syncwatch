## 2024-03-05 - Optimize Array Finding in Redis Worker

**Learning:** O(N^2) `.find()` operations within loops mapping over array IDs can severely bottleneck performance as array sizes increase (e.g., maximum 500 playlist limit).
**Action:** Replace nested `.find()` searches with a pre-computed O(N) `Map` linking array identifiers to their respective items, drastically improving lookup speed to O(1).
## 2024-03-05 - Avoid useShallow for fast-changing nested objects
**Learning:** Using `useShallow((s) => ({ room: s.room }))` is a dangerous anti-pattern. Because Zustand creates a new `room` object reference on every deep update (like playback position changes), the shallow equality check always returns false. This causes components to re-render exactly as if they had used `const { room } = useStore()`.
**Action:** Never return nested objects inside `useShallow` if they frequently change reference. Always use purely granular selectors for specific primitive values (e.g., `const roomName = useStore(s => s.room?.name)`).
