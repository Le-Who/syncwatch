## 2025-05-18 - IP Spoofing & Rate Limit Bypass via x-forwarded-for

**Vulnerability:** Reading `x-forwarded-for` directly without parsing from right-to-left allows clients to prepend arbitrary IP addresses (e.g. `x-forwarded-for: 1.2.3.4, <actual_ip>`), bypassing IP-based rate limiting by spoofing a new IP on every request.
**Learning:** `x-forwarded-for` is a comma-separated list where the reverse proxy appends the client IP to the end. The left-most IP is user-provided and untrusted. Also, `socket.remoteAddress` is often the reverse proxy itself, so prioritizing it over proxy headers incorrectly rate-limits the proxy.
**Prevention:** Always use the `getClientIp` utility function from `lib/ip.ts`, which parses the comma-separated list from right to left (skipping bogons like internal IPs) and returns `null` on failure, before falling back to `'unknown'`.
