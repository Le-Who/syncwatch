## 2024-03-05 - Optimize Array Finding in Redis Worker

**Learning:** O(N^2) `.find()` operations within loops mapping over array IDs can severely bottleneck performance as array sizes increase (e.g., maximum 500 playlist limit).
**Action:** Replace nested `.find()` searches with a pre-computed O(N) `Map` linking array identifiers to their respective items, drastically improving lookup speed to O(1).

## 2026-08-29 - Extracted Playlist Search Form
**Learning:** Large React components rendering massive O(N) lists (like a 500-item playlist) can severely bottleneck performance if they also own localized state that updates frequently (like a controlled text input). Any keystroke forces a re-render of the entire list.
**Action:** Isolate frequently updating UI (like search bars or active playback controls) into separate, sibling or child components wrapped in `React.memo`. This prevents rapid state changes from polluting the parent render cycle and diffing the large list array.

## 2024-03-24 - Optimize Zustand Array Lookups
**Learning:** Performing O(N) array operations (like `.find()` or `.findIndex()`) directly inside Zustand selectors causes severe performance bottlenecks because the selector re-evaluates on every store update (e.g., rapid timestamp or coordinate changes), executing the O(N) loop repeatedly even if the array hasn't changed.
**Action:** Extract expensive array lookups into module-level memoized selector functions that cache the array reference and the search key, returning the previously found item if the inputs haven't changed.
