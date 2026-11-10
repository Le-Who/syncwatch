## 2024-03-05 - Optimize Array Finding in Redis Worker

**Learning:** O(N^2) `.find()` operations within loops mapping over array IDs can severely bottleneck performance as array sizes increase (e.g., maximum 500 playlist limit).
**Action:** Replace nested `.find()` searches with a pre-computed O(N) `Map` linking array identifiers to their respective items, drastically improving lookup speed to O(1).

## 2026-08-29 - Extracted Playlist Search Form

**Learning:** Large React components rendering massive O(N) lists (like a 500-item playlist) can severely bottleneck performance if they also own localized state that updates frequently (like a controlled text input). Any keystroke forces a re-render of the entire list.
**Action:** Isolate frequently updating UI (like search bars or active playback controls) into separate, sibling or child components wrapped in `React.memo`. This prevents rapid state changes from polluting the parent render cycle and diffing the large list array.

## 2024-05-18 - Optimized Synchronous Queue Processing

**Learning:** `advanceQueue` executes synchronously on the main thread and parses massive `O(N)` playlist arrays. Nested `.includes()` or `.some()` iterations within a main `.filter()` call create hidden `O(N^2)` complexity bottlenecks that block rendering or lock up the state processor as room playlists approach 500 items.
**Action:** Replace sequential `Array` lookups nested in filtering logic with pre-computed `Set` conversions to drop complexity to `O(N)`.
