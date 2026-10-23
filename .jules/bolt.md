## 2024-03-05 - Optimize Array Finding in Redis Worker

**Learning:** O(N^2) `.find()` operations within loops mapping over array IDs can severely bottleneck performance as array sizes increase (e.g., maximum 500 playlist limit).
**Action:** Replace nested `.find()` searches with a pre-computed O(N) `Map` linking array identifiers to their respective items, drastically improving lookup speed to O(1).

## 2026-08-29 - Extracted Playlist Search Form

**Learning:** Large React components rendering massive O(N) lists (like a 500-item playlist) can severely bottleneck performance if they also own localized state that updates frequently (like a controlled text input). Any keystroke forces a re-render of the entire list.
**Action:** Isolate frequently updating UI (like search bars or active playback controls) into separate, sibling or child components wrapped in `React.memo`. This prevents rapid state changes from polluting the parent render cycle and diffing the large list array.

## 2025-02-24 - Throttling Continuous Global Event Listeners

**Learning:** Attaching unthrottled, non-passive global event listeners (like `mousemove` or `touchstart`) for background tasks like idle timeout detection causes the main thread to rapidly clear and set timeouts up to 60 times a second, hurting performance.
**Action:** Always throttle continuous background event handlers (e.g., using a 200ms `Date.now()` delta) and apply `{ passive: true }` using `AddEventListenerOptions` when `preventDefault()` isn't needed, to prevent scrolling jank and minimize main thread blocking.
