## 2024-03-05 - Optimize Array Finding in Redis Worker

**Learning:** O(N^2) `.find()` operations within loops mapping over array IDs can severely bottleneck performance as array sizes increase (e.g., maximum 500 playlist limit).
**Action:** Replace nested `.find()` searches with a pre-computed O(N) `Map` linking array identifiers to their respective items, drastically improving lookup speed to O(1).

## 2026-08-29 - Extracted Playlist Search Form
**Learning:** Large React components rendering massive O(N) lists (like a 500-item playlist) can severely bottleneck performance if they also own localized state that updates frequently (like a controlled text input). Any keystroke forces a re-render of the entire list.
**Action:** Isolate frequently updating UI (like search bars or active playback controls) into separate, sibling or child components wrapped in `React.memo`. This prevents rapid state changes from polluting the parent render cycle and diffing the large list array.

## 2026-11-20 - Cache Zustand Derived State Array Lookups
**Learning:** Zustand selectors that perform O(N) operations (e.g. `array.find()`, `array.findIndex()`) will bottleneck performance when listening to a rapidly updating store. If the store manages highly-frequent updates (like playback progression), O(N) work occurs per tick, unnecessarily looping across unmodified arrays (e.g. large playlist).
**Action:** Use a `WeakMap<State, Cache>` to memoize the result of expensive O(N) lookups based on the *immutable reference* of the state object. Because Zustand generates a new state reference exclusively when state truly mutates, the `WeakMap` natively handles cache invalidation with O(1) reads for all non-mutating evaluations.
