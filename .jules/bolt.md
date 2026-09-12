## 2024-03-05 - Optimize Array Finding in Redis Worker

**Learning:** O(N^2) `.find()` operations within loops mapping over array IDs can severely bottleneck performance as array sizes increase (e.g., maximum 500 playlist limit).
**Action:** Replace nested `.find()` searches with a pre-computed O(N) `Map` linking array identifiers to their respective items, drastically improving lookup speed to O(1).

## 2026-08-29 - Extracted Playlist Search Form
**Learning:** Large React components rendering massive O(N) lists (like a 500-item playlist) can severely bottleneck performance if they also own localized state that updates frequently (like a controlled text input). Any keystroke forces a re-render of the entire list.
**Action:** Isolate frequently updating UI (like search bars or active playback controls) into separate, sibling or child components wrapped in `React.memo`. This prevents rapid state changes from polluting the parent render cycle and diffing the large list array.

## 2024-05-18 - Avoid Pre-computed Maps for Array Lookups in Immutable State
**Learning:** Using `WeakMap` or pre-computed `Map` structures to replace O(N) array `.find()` lookups in Zustand selectors or Immer-managed state is an anti-pattern. Building the Map takes O(N) upfront, which is often slower than native `.find()`, and causes critical stale-cache bugs when working with mutable proxy references.
**Action:** Do not implement Map-based lookup caching for immutable or proxy-managed state. Simple native `.find()` array methods are sufficient and safer for standard application constraints.

## 2024-05-18 - Throttle Continuous DOM Events
**Learning:** Binding handlers to continuous DOM events like `mousemove` that trigger React state reads or rapid `clearTimeout`/`setTimeout` cycles can severely bottleneck the main thread.
**Action:** Always throttle such handlers. A lightweight check using `Date.now() - lastActivity < threshold` is often the most performant and dependency-free way to reduce execution frequency.
