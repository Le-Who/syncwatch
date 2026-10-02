## 2025-02-28 - [CRITICAL] Prevent Rate Limit Bypass & IP Spoofing via x-forwarded-for

**Vulnerability:** The application was reading the `x-forwarded-for` header directly (e.g., `request.headers.get("x-forwarded-for")`) and taking the first/entire value to determine the client IP for rate limiting and logging across the API routes and Socket.io events.

**Learning:** This is a critical security vulnerability because attackers can easily spoof the `x-forwarded-for` header by providing a fake IP. This allows them to bypass rate limits (since the rate limit key changes) or frame other IPs. We had a `getClientIp` function pattern mentioned in memory that parses the `x-forwarded-for` header from right to left, skipping bogons (private/internal IPs), to find the true origin IP from the closest untrusted proxy, but it wasn't fully implemented or used.

**Prevention:** Never read `x-forwarded-for` directly. Always use the `getClientIp` utility function from `lib/ip.ts` which securely parses the header right-to-left. For Socket.io, use `getClientIp(socket.handshake)`.
