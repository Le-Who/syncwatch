## 2024-03-05 - Optimize Array Finding in Redis Worker

**Learning:** O(N^2) `.find()` operations within loops mapping over array IDs can severely bottleneck performance as array sizes increase (e.g., maximum 500 playlist limit).
**Action:** Replace nested `.find()` searches with a pre-computed O(N) `Map` linking array identifiers to their respective items, drastically improving lookup speed to O(1).
## 2024-05-15 - [Zustand Component Re-render Optimization]
**Learning:** Found a widespread anti-pattern across components (`app/room/[id]/page.tsx`, `Playlist`, `Participants`, `RoomSettingsDialog`) where they were destructing state values directly from `useStore()` without selectors (e.g. `const { room, sendCommand } = useStore();`). This caused components to unnecessarily re-render whenever *any* unrelated state inside the store changed, such as high-frequency updates from `serverClockOffset`.
**Action:** Implemented the `useShallow` hook from `zustand/react/shallow` along with inline object selectors to drastically reduce unnecessary render cycles.
