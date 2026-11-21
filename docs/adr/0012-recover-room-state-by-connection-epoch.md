# Recover room state by connection epoch

The client records the canonical delivery counter when the live socket drops.
Playback recovery requires a delivery newer than that counter for the current
media epoch. A delivery accepted after the last reconciliation tick and before
disconnect still belongs to the old connection. A fresh authoritative snapshot
can repeat the last playback sequence, so the delivery counter and sequence both
matter. Only the client can mark an authoritative recovery snapshot after
correlating it with the current transport and request. A request ID remains
optional for older clients.

The server reserves a join before its first asynchronous step and processes
same-room joins in order so slower hydration cannot replace a newer snapshot or
clear its reservation. The join path checks for disconnect after asynchronous
room discovery, mutation, and departure work. A compare-and-swap reply can be
lost even if a socket was removed, so disconnect handling preserves the grace
cleanup for that participant. The server uses connection IDs to track which
sockets still hold a participant identity. The older disconnected flag remains
available during the reconnection grace period.

The client cancels stale identity upgrades when joining again, even for the same
room, and uses a fresh correlation nonce after the new join. On the server, token
verification and room mutation remain bound to the original room, participant,
and socket. If an upgrade commits after disconnect cleanup began, the stale
request removes only its socket from the destination identity. The client bounds
the authentication response and its JSON parsing and separately bounds the join
and upgrade wait. Expired upgrades leave retained commands available for explicit
retry.

Sleep preserves the current room and mounted player so activity can reconnect.
The store records sleep before disconnect so the retry overlay stays closed. The
reconnect overlay uses an external countdown store and a cached snapshot that
keeps its identity until the data changes. This lets socket and timer effects
drive retries through `useSyncExternalStore`.

The store reports a dispatched join as true, an HTTP rejection as false, and a superseded connection attempt as null.
