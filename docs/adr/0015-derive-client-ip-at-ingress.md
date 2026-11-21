# Derive client IP at the server ingress

The custom Node server sees the direct TCP peer. It replaces the internal client
IP header before handing an HTTP request to Next.js App Routes, which cannot
observe the peer directly. Socket.IO observes its own connection and passes its
peer address directly to IP resolution. This keeps the source of rate-limit
identity at the server boundary. A deployment can explicitly enable forwarded
client IPs when a trusted proxy sanitizes the forwarding headers.

The custom server loads Next.js environment configuration before initializing
handlers and services. Socket signing configuration is read during handler setup
after that load and retained for the socket's commands. The session endpoint
discards invalid cookie material and issues a fresh session without writing the
supplied credentials to logs.

The server parses the request URL and projects its pathname and query into the shape expected by the Next.js request handler.
