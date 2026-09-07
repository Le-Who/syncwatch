## 2024-03-05 - Optimize Array Finding in Redis Worker

**Learning:** O(N^2) `.find()` operations within loops mapping over array IDs can severely bottleneck performance as array sizes increase (e.g., maximum 500 playlist limit).
**Action:** Replace nested `.find()` searches with a pre-computed O(N) `Map` linking array identifiers to their respective items, drastically improving lookup speed to O(1).

## 2026-08-29 - Extracted Playlist Search Form
**Learning:** Large React components rendering massive O(N) lists (like a 500-item playlist) can severely bottleneck performance if they also own localized state that updates frequently (like a controlled text input). Any keystroke forces a re-render of the entire list.
**Action:** Isolate frequently updating UI (like search bars or active playback controls) into separate, sibling or child components wrapped in `React.memo`. This prevents rapid state changes from polluting the parent render cycle and diffing the large list array.

## 2024-05-18 - Optimize Playlist Searching inside Zustand Selectors
**Learning:** Zustand selectors running inside components like `<Player>` fire frequently (e.g., when time updates or on any state change). O(N) operations like `.find()` or `.findIndex()` in selectors like `useShallow((s) => s.room?.playlist.find(...))` cause severe performance degradation on large arrays.
**Action:** Use a `WeakMap` keyed to the immutable `playlist` array reference to cache O(1) lookups inside the selector, avoiding repeated array traversals while retaining React reactivity.
