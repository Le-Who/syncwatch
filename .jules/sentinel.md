## 2024-03-05 - Rate Limit Bypass (X-Forwarded-For)
**Vulnerability:** Client IP parsed using `x-forwarded-for` sequentially or directly accessing array offsets which allows header spoofing.
**Learning:** Next.js and typical node setups blindly trust the proxy headers if not configured correctly, exposing rate limits to bypasses.
**Prevention:** Always use a safe parsing method like `getClientIp` that validates the IPs against bogon lists and traverses the header in reverse order (closest proxy to furthest client).
