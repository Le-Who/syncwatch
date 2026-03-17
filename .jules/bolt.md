## 2025-02-23 - O(N^2) Array finding in reorder_playlist leftover items
**Learning:** `Array.find()` inside a loop over the same array size results in O(N^2) complexity, which can cause significant CPU overhead and block the event loop in Node.js, especially for tasks running repeatedly like a queue worker.
**Action:** Replaced the internal `find` calls with lookups on an O(N) pre-processed Map in `lib/redis-queue-worker.ts`, changing the time complexity from O(N^2) to O(N) and achieving a ~28x speedup on arrays of length 500.
