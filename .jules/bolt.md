## 2024-03-05 - Optimize Array Finding in Redis Worker

**Learning:** O(N^2) `.find()` operations within loops mapping over array IDs can severely bottleneck performance as array sizes increase (e.g., maximum 500 playlist limit).
**Action:** Replace nested `.find()` searches with a pre-computed O(N) `Map` linking array identifiers to their respective items, drastically improving lookup speed to O(1).
## 2026-04-13 - Memoize React render elements for loops instead of full state propagation
**Learning:** In large rendered lists (like a 500-item playlist), conditionally executing `.map` with complex children that directly consume constantly updating global state (like `room`) triggers massive O(N) re-renders, causing severe frontend performance lag.
**Action:** Extract list item interiors into a new component wrapped with `React.memo()` and pass down only stable, specific primitive props and selectively pass nested objects ONLY if the current item is the active one (e.g. `isActive={isActive}`, `playback={isActive ? room.playback : undefined}`).
