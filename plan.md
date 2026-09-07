1. *Identify the performance bottleneck.*
   - In `components/Player.tsx`, there are two instances of `s.room?.playlist.find` and `s.room.playlist.findIndex` happening inside `useShallow` selectors (`currentMedia` and `nextItem`).
   - According to the codebase memory: "Avoid O(N) array operations (like `.find()`) inside frequently evaluating Zustand selectors or pulling large arrays directly into components, which causes widespread unnecessary re-renders." Also, "To avoid expensive O(N) operations in Zustand selectors while retaining `useShallow`, use a `WeakMap` keyed to the immutable state reference (e.g., `WeakMap<PlaylistItem[], Map<string, number>>`) to cache lookups/derivations and achieve O(1) performance."
2. *Create a cache in `components/Player.tsx`.*
   - Declare a `WeakMap` at the module level in `components/Player.tsx` to memoize the playlist indices (or items).
   - `const playlistIndexCache = new WeakMap<PlaylistItem[], Map<string, number>>();` (need to import `PlaylistItem` from `lib/types`).
   - Create a helper `getPlaylistIndices(playlist)` that returns the `Map<string, number>` for a given `playlist` array.
3. *Update `currentMedia` selector.*
   - Use the `WeakMap` cache to get the index of `currentMediaId` and then access the item directly via `playlist[idx]` instead of `.find()`.
4. *Update `nextItem` selector.*
   - Use the `WeakMap` cache to get the index of `currentMediaId` instead of `.findIndex()`.
5. *Verify and run tests/linters.*
   - Run `pnpm lint`, `pnpm test`, `pnpm tsc --noEmit`.
6. *Complete pre-commit steps.*
   - Run `pre_commit_instructions` tool to make sure proper testing, verifications, reviews and reflections are done.
7. *Submit.*
   - Create a PR using the required title and description.
