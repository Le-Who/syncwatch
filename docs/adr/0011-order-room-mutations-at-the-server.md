# Order room mutations at the server

The server owns the shared playback timeline. Room mutation functions apply
changes in memory. The command service owns ordering, version updates,
persistence scheduling, and event publication. Fast mutations use Redis Lua to
apply authorization and the change atomically against the current leader and
participant role. The role and leader policy lives in TypeScript. Lua compares
the snapshots and returns a conflict if they have changed, so TypeScript can
reload and recheck authorization. Slow mutations use compare-and-swap and retry
against the new room snapshot when it changes.

A command's nonce supports a bounded, server-only idempotency history. Room
generation identifies the lifetime of an authority. A media run distinguishes
successive playbacks of an item, including when the same item plays again. Legacy
persisted rooms start at media run zero. A repeated Play on an already playing
room keeps the current playback anchor unless the request explicitly seeks. A
correction can move the anchor and set the nonce while preserving the playback
status. Playlist reordering preserves items that arrived concurrently, and
explicit Next and an accepted natural end share the same queue advance policy.

Buffering and recovery health belong to individual participants. A legacy
buffering command remains valid input and is an authorized no-op. Current clients
report provider health separately and reconcile to the latest canonical playback
for their current media epoch. Friends can keep watching while one participant
buffers, and the recovering provider can catch up locally. Legacy snapshots may
still contain the old room control mode. Current authorization derives from the
active room membership and roles.

Older callers can send flat Socket.IO command payloads. The server adapts those
payloads to the shared envelope and emits the legacy error event on rejection.
The nonce-correlated acknowledgement is the authoritative command response.

The browser and server share the same scalar nonce validator so both ends accept the same command identifiers.
