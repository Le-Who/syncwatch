## 2024-03-05 - Optimize Array Finding in Redis Worker

**Learning:** O(N^2) `.find()` operations within loops mapping over array IDs can severely bottleneck performance as array sizes increase (e.g., maximum 500 playlist limit).
**Action:** Replace nested `.find()` searches with a pre-computed O(N) `Map` linking array identifiers to their respective items, drastically improving lookup speed to O(1).
## 2024-11-20 - Prevent Unnecessary Re-renders with Zustand `useShallow`

**Learning:** Destructuring entire state objects from a Zustand store using `useStore()` without a selector subscribes the component to every state update. In highly dynamic applications (like SyncWatch where `room` state or `serverClockOffset` updates frequently), this causes unnecessary re-renders in parent and child components (e.g. `RoomPage`, `Playlist`, `Participants`, `RoomSettingsDialog`), creating a major performance bottleneck and causing UI stuttering.
**Action:** Replace `const { ... } = useStore()` with granular selectors using `useShallow` (e.g., `const { room, participantId } = useStore(useShallow(s => ({ room: s.room, participantId: s.participantId })))`) to limit component re-renders strictly to changes in the accessed properties.
