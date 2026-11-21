# Persist canonical room snapshots

The Node server owns room authorization and writes durable state with a
server-only service-role key. Row-level security denies direct public access
to the room tables. The snapshot RPC grants execution to the service role and
uses an empty search path with schema-qualified table references to keep
resolution predictable when it runs with elevated privileges.

The snapshot RPC writes the canonical room JSON and its relational
compatibility tables in one transaction. The backfill reconstructs fields
available to the earlier writer. Connection IDs, readiness, and active
leadership are tied to live connections and start fresh on recovery. A cleared
queue writes a null media ID to the compatibility playback row, so readers
observe the cleared selection.

The live concurrency test writes real rows through this RPC. Run it with
`SYNCWATCH_TEST_DB_DEADLOCK=1` against a disposable Supabase database with
credentials for that database.
