# Exercise real room behavior with test transports

The deterministic room tests replace external boundaries so they can
reproduce delivery races, provider events, and session recovery while exercising
the real command service, store, timer ownership, and playback reconciliation.
Held commands keep their send-time envelopes and order until release. The
playback cases bracket the recent-seek guard and distinguish stale provider
epochs, later canonical paused seeks, and local-only health changes.

The persistence integration test adapts transport and applies the checked-in
migrations to a real PostgreSQL-compatible engine. Redis worker unit tests
control transport to exercise deterministic interleavings. The matching Redis
integration suite runs the production Lua and uses a ping on the writing
connection to observe an enqueued fire-and-forget mark. That worker enumerates
the global write-behind queue, so it requires an opt-in against a disposable
Redis database. Ordinary Redis actor tests namespace and clean up their keys.

The fast-path unit suite always uses the Redis test double. The separate Lua
suite opts into a disposable Redis connection so it can observe Lua's version
checks, permission conflicts, and serialized playback state. Redis Lua encodes
empty arrays as objects, so the server normalizes room state both when it reads
Redis and when a playback mutation returns.

Browser acceptance uses the compiled room route as the web server readiness
check to keep route compilation outside navigation timeouts. The same-NAT case
omits the test proxy's distributed-IP marker so its browsers share one peer
address. The permission case pairs a disabled control with the corresponding
command acknowledgement using the participant's signed browser session. The
in-grace reconnect waits past the first clock heartbeat and returns before
participant expiry.

Test teardown completes active scrubber drags to prevent their listeners from
leaking into later cases. The subprocess serialization test gives the parent
test a longer deadline than the subprocess, leaving room for slow cold startup
under Windows coverage and reporting the subprocess failure first. The HTTP
test adapter sets Node's required request duplex option when it wraps an
incoming streamed body.
