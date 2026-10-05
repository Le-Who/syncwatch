## 2024-03-05 - Optimize Array Finding in Redis Worker

**Learning:** O(N^2) `.find()` operations within loops mapping over array IDs can severely bottleneck performance as array sizes increase (e.g., maximum 500 playlist limit).
**Action:** Replace nested `.find()` searches with a pre-computed O(N) `Map` linking array identifiers to their respective items, drastically improving lookup speed to O(1).

## 2026-08-29 - Extracted Playlist Search Form
**Learning:** Large React components rendering massive O(N) lists (like a 500-item playlist) can severely bottleneck performance if they also own localized state that updates frequently (like a controlled text input). Any keystroke forces a re-render of the entire list.
**Action:** Isolate frequently updating UI (like search bars or active playback controls) into separate, sibling or child components wrapped in `React.memo`. This prevents rapid state changes from polluting the parent render cycle and diffing the large list array.

## 2024-10-05 - Throttling Continuous DOM Events
**Learning:** Continuous DOM events like `mousemove` and `keydown` can cause performance degradation if they trigger rapid timeout clear/set cycles or frequent state reads.
**Action:** Throttle continuous events using a lightweight timestamp check (e.g., `Date.now() - lastTime < 200`) and attach the event listeners with `{ passive: true }` to avoid blocking scrolling performance and prevent main thread blocking. When doing so in strict TypeScript environments, extract event listener options into a variable typed and cast as `EventListenerOptions` (e.g., `const passiveOpts: EventListenerOptions = { passive: true } as EventListenerOptions;`) to prevent compilation errors.
