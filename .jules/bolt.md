## 2024-03-05 - Optimize Array Finding in Redis Worker

**Learning:** O(N^2) `.find()` operations within loops mapping over array IDs can severely bottleneck performance as array sizes increase (e.g., maximum 500 playlist limit).
**Action:** Replace nested `.find()` searches with a pre-computed O(N) `Map` linking array identifiers to their respective items, drastically improving lookup speed to O(1).

## 2026-08-29 - Extracted Playlist Search Form

**Learning:** Large React components rendering massive O(N) lists (like a 500-item playlist) can severely bottleneck performance if they also own localized state that updates frequently (like a controlled text input). Any keystroke forces a re-render of the entire list.
**Action:** Isolate frequently updating UI (like search bars or active playback controls) into separate, sibling or child components wrapped in `React.memo`. This prevents rapid state changes from polluting the parent render cycle and diffing the large list array.

## 2024-10-14 - Throttling Continuous DOM Events for Timeouts

**Learning:** Unthrottled continuous events (like `mousemove`, `keydown`) that trigger rapid `clearTimeout` / `setTimeout` cycles can cause significant main thread overhead, running at ~60Hz and dragging down overall performance.
**Action:** Throttle continuous events using a fast, simple timestamp check (e.g., `Date.now() - lastTime < 200`) to reduce event execution to ~5Hz. Additionally, apply `{ passive: true }` to the `addEventListener` calls to improve scrolling performance and prevent main thread blocking, ensuring it is typed as `AddEventListenerOptions` in strict TypeScript environments.
