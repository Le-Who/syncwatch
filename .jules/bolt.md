## 2026-03-15 - Optimize duplicate checking in playlist updates
**Learning:** (N \cdot M)$ operations on arrays (like using '.some()' inside a loop) can significantly degrade performance as the playlist grows. Replacing these with (1)$ Set lookups reduces processing time dramatically.
**Action:** Implemented a Set-based lookup for URL deduplication in 'lib/redis-queue-worker.ts', resulting in a ~12x speedup in benchmarks.
