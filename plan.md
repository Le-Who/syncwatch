1. **Optimize `lib/room-logic.ts`**
   - Update `snapshotActiveItemPosition` to accept an optional `activeItem` parameter to prevent redundant `find()` lookups.
   - Refactor `applyVideoEnded` to locate the current media item using `findIndex` once, then reuse that reference and index for `snapshotActiveItemPosition`, `activeItem`, and `endedIndex` variables. This eliminates 3 separate O(N) passes.
   - Refactor `applyNext` to locate the current index via `findIndex` once, then reuse it to fetch the `activeItem` for `snapshotActiveItemPosition`.
2. **Complete pre-commit steps**
   - Complete pre-commit steps to ensure proper testing, verification, review, and reflection are done.
3. **Submit the PR**
   - Submit the PR with the title `⚡ Bolt: Consolidate O(N) playlist traversals in room logic` and required description.
