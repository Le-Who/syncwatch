## 2024-03-05 - Optimize Array Finding in Redis Worker

**Learning:** O(N^2) `.find()` operations within loops mapping over array IDs can severely bottleneck performance as array sizes increase (e.g., maximum 500 playlist limit).
**Action:** Replace nested `.find()` searches with a pre-computed O(N) `Map` linking array identifiers to their respective items, drastically improving lookup speed to O(1).

## 2026-08-29 - Extracted Playlist Search Form
**Learning:** Large React components rendering massive O(N) lists (like a 500-item playlist) can severely bottleneck performance if they also own localized state that updates frequently (like a controlled text input). Any keystroke forces a re-render of the entire list.
**Action:** Isolate frequently updating UI (like search bars or active playback controls) into separate, sibling or child components wrapped in `React.memo`. This prevents rapid state changes from polluting the parent render cycle and diffing the large list array.
## 2024-03-05 - Optimize Playlist Items Rendering
**Learning:** React components rendering a large list of items, such as the 500-item playlist, can cause severe O(N) re-renders when the parent component triggers frequent updates (like a global state change tied to a playback timer). This forces the entire list array to diff and evaluate, causing a bottleneck.
**Action:** Extract list items (like `PlaylistItem`) into a separate subcomponent and aggressively wrap them in `React.memo` using custom equality comparators to ensure they are shielded from frequent parent updates.
