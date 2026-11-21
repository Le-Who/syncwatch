# Serialize room snapshot writers

`sync_room_state` takes a transaction-scoped advisory lock keyed by room ID
before touching the room and playlist. Overlapping writes could acquire
playlist row locks in different orders. The earlier parent-row lock required a
room row to exist, so the RPC now takes the advisory lock before the room
upsert. The RPC accepts UUIDs for the room and owner IDs so PostgreSQL validates
them at the function boundary.

While holding the lock, the RPC checks the stored version before updating.
A write-behind job can arrive late, so the RPC discards a snapshot whose
version is older than the durable room version.
