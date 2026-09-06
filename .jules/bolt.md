## 2024-03-05 - Optimize Array Finding in Redis Worker

**Learning:** O(N^2) `.find()` operations within loops mapping over array IDs can severely bottleneck performance as array sizes increase (e.g., maximum 500 playlist limit).
**Action:** Replace nested `.find()` searches with a pre-computed O(N) `Map` linking array identifiers to their respective items, drastically improving lookup speed to O(1).

## 2026-08-29 - Extracted Playlist Search Form
**Learning:** Large React components rendering massive O(N) lists (like a 500-item playlist) can severely bottleneck performance if they also own localized state that updates frequently (like a controlled text input). Any keystroke forces a re-render of the entire list.
**Action:** Isolate frequently updating UI (like search bars or active playback controls) into separate, sibling or child components wrapped in `React.memo`. This prevents rapid state changes from polluting the parent render cycle and diffing the large list array.

## 2024-05-18 - Optimize Array Lookups in Zustand Selectors
**Learning:** O(N) array operations (like `.find()` or `.findIndex()`) inside frequently evaluating Zustand selectors (e.g. `useShallow`) can cause widespread unnecessary re-renders and poor performance when dealing with large arrays.
**Action:** Use a `WeakMap` keyed to the immutable state array reference (e.g., `WeakMap<PlaylistItem[], Map<string, number>>`) to cache lookups/derivations and achieve O(1) performance without breaking `useShallow`'s reference equality checks.
