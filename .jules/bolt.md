## 2024-03-05 - Optimize Array Finding in Redis Worker

**Learning:** O(N^2) `.find()` operations within loops mapping over array IDs can severely bottleneck performance as array sizes increase (e.g., maximum 500 playlist limit).
**Action:** Replace nested `.find()` searches with a pre-computed O(N) `Map` linking array identifiers to their respective items, drastically improving lookup speed to O(1).

## 2026-08-29 - Extracted Playlist Search Form
**Learning:** Large React components rendering massive O(N) lists (like a 500-item playlist) can severely bottleneck performance if they also own localized state that updates frequently (like a controlled text input). Any keystroke forces a re-render of the entire list.
**Action:** Isolate frequently updating UI (like search bars or active playback controls) into separate, sibling or child components wrapped in `React.memo`. This prevents rapid state changes from polluting the parent render cycle and diffing the large list array.

## 2024-10-16 - Optimize Array Filtering in advanceQueue
**Learning:** Nested array `.some()` and `.includes()` operations inside `.filter()` calls (e.g. comparing arrays up to 500 items) create hidden O(N^2) bottlenecks during synchronous state updates, increasing execution time from ~0.1ms to ~3.5ms.
**Action:** Always map the target array to a `Set` before filtering to turn O(N) array scans into O(1) `.has()` lookups.
