# Start on polling and authenticate with session cookies

A network can reject WebSocket upgrades or leave them unanswered. The room
client opens a Socket.IO polling session and upgrades when the WebSocket probe
succeeds. The gateway checks explicit origins against the public app origin. A
same-origin browser polling GET can omit `Origin`, so the gateway checks the
browser's Fetch Metadata and the canonical public host for those requests.
Proxies preserve that host and route an Engine.IO session to the same gateway
throughout polling.

The normal HTTP session response carries the participant ID. The browser sends
the signed HttpOnly cookie on the Socket.IO handshake. To refresh the identity of
an established connection, the client requests a signed 30-second proof scoped to
the room. An upgrade waits for the correlated join snapshot and retries with a
new nonce if server-side join processing is still in flight. The existing
15-second upgrade deadline bounds retries.

The `ALLOW_LEGACY_SOCKET_TOKEN` setting preserves the old response and signed
token protocol for a rolling migration. An upgrade proof has its own audience and
is usable only for `upgrade_session` in the named room.
