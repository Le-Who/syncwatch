## 2024-03-05 - Optimize Array Finding in Redis Worker

**Learning:** O(N^2) `.find()` operations within loops mapping over array IDs can severely bottleneck performance as array sizes increase (e.g., maximum 500 playlist limit).
**Action:** Replace nested `.find()` searches with a pre-computed O(N) `Map` linking array identifiers to their respective items, drastically improving lookup speed to O(1).

## 2026-08-29 - Extracted Playlist Search Form

**Learning:** Large React components rendering massive O(N) lists (like a 500-item playlist) can severely bottleneck performance if they also own localized state that updates frequently (like a controlled text input). Any keystroke forces a re-render of the entire list.
**Action:** Isolate frequently updating UI (like search bars or active playback controls) into separate, sibling or child components wrapped in `React.memo`. This prevents rapid state changes from polluting the parent render cycle and diffing the large list array.

## 2024-10-28 - Throttling Continuous DOM Events

**Learning:** Attaching unthrottled handlers to continuous events like `mousemove` and `touchstart` can severely degrade performance by firing dozens of times per second (causing rapid React state reads and timeout clears/sets), completely blocking the main thread.
**Action:** Always throttle continuous DOM events using a simple timestamp check (e.g., 200ms) to preserve UI responsiveness while lowering execution frequency, and attach passive listeners (`{ passive: true }`) to ensure scrolling performance isn't impacted.
