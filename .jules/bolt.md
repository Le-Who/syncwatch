## 2024-03-05 - Optimize Array Finding in Redis Worker

**Learning:** O(N^2) `.find()` operations within loops mapping over array IDs can severely bottleneck performance as array sizes increase (e.g., maximum 500 playlist limit).
**Action:** Replace nested `.find()` searches with a pre-computed O(N) `Map` linking array identifiers to their respective items, drastically improving lookup speed to O(1).

## 2024-05-15 - Optimize Graceful Shutdown Latency

**Learning:** Sequential network operations during server shutdown hooks (like `flushDbSyncQueue`) drastically increase shutdown latency and can cause orchestrator timeout kills before persistence completes.
**Action:** Replace `for...of` loops performing sequential `await` over network resources (Redis/DB) with chunked concurrent batches (e.g., `BATCH_SIZE = 10` using `Promise.allSettled`). Always ensure rejected promises in concurrent batches are logged to maintain observability.
