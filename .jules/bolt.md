## 2024-03-05 - Optimize Array Finding in Redis Worker

**Learning:** O(N^2) `.find()` operations within loops mapping over array IDs can severely bottleneck performance as array sizes increase (e.g., maximum 500 playlist limit).
**Action:** Replace nested `.find()` searches with a pre-computed O(N) `Map` linking array identifiers to their respective items, drastically improving lookup speed to O(1).

## 2026-08-29 - Extracted Playlist Search Form

**Learning:** Large React components rendering massive O(N) lists (like a 500-item playlist) can severely bottleneck performance if they also own localized state that updates frequently (like a controlled text input). Any keystroke forces a re-render of the entire list.
**Action:** Isolate frequently updating UI (like search bars or active playback controls) into separate, sibling or child components wrapped in `React.memo`. This prevents rapid state changes from polluting the parent render cycle and diffing the large list array.

## 2024-03-08 - O(1) Zustand Selector Lookups

**Learning:** Performing inline O(N) array lookups (like `.find()` or `.findIndex()`) inside frequently evaluating Zustand selectors (such as `useStore((s) => s.room?.playlist.find(...))`) forces unnecessary O(N) operations on every unrelated store update, causing severe performance degradation in complex components (like large playlists). Maps or WeakMaps should not be used as they force an upfront O(N) iteration that is slower than native `.find()` and causes critical stale-cache bugs with Immer mutable proxies.
**Action:** Replace inline `.find()` searches in Zustand selectors with simple module-level memoized functions that cache the array reference and the search key. This eliminates O(N) searches during unrelated store updates natively, acting effectively as an O(1) lookup cache without the Map overhead.

## 2024-03-08 - Throttle Continuous DOM Events
**Learning:** Continuous DOM events like `mousemove` and `keydown` fire extremely rapidly. Tying them directly to React state reads (`useStore.getState()`) and timeout clear/set cycles without rate-limiting causes unnecessary main thread execution, which can degrade scrolling and rendering performance.
**Action:** Throttle continuous event listeners using a lightweight timestamp check (e.g., `Date.now() - lastActivityTime < 1000`) and attach them with `{ passive: true }` to ensure scrolling performance is never blocked by main-thread activity detection logic.
