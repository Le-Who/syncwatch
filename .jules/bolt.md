## 2024-03-05 - Optimize Array Finding in Redis Worker

**Learning:** O(N^2) `.find()` operations within loops mapping over array IDs can severely bottleneck performance as array sizes increase (e.g., maximum 500 playlist limit).
**Action:** Replace nested `.find()` searches with a pre-computed O(N) `Map` linking array identifiers to their respective items, drastically improving lookup speed to O(1).

## 2026-08-29 - Extracted Playlist Search Form
**Learning:** Large React components rendering massive O(N) lists (like a 500-item playlist) can severely bottleneck performance if they also own localized state that updates frequently (like a controlled text input). Any keystroke forces a re-render of the entire list.
**Action:** Isolate frequently updating UI (like search bars or active playback controls) into separate, sibling or child components wrapped in `React.memo`. This prevents rapid state changes from polluting the parent render cycle and diffing the large list array.

## 2024-11-12 - Optimize Array Lookup Bottlenecks in Synchronous Room Logic
**Learning:** Hidden O(N^2) bottlenecks easily slip into synchronous state updates when array scan methods (`some`, `includes`) are nested inside iteration methods (`filter`, `map`). In large collections like playlists (N=500), these operations block the main thread and severely delay room synchronization.
**Action:** Always pre-compute a `Set` from target arrays when checking for inclusion within an iteration loop to reduce O(N^2) time complexity to O(N) via O(1) `.has()` lookups.
