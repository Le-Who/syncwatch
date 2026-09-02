
## 2025-05-24 - Rate Limit Bypass via x-forwarded-for spoofing
**Vulnerability:** API routes and WebSocket connections blindly trusted the `x-forwarded-for` header by taking its full value or the first value, allowing attackers to bypass rate limits by spoofing `X-Forwarded-For: 1.2.3.4`.
**Learning:** Next.js and standard Node request objects don't automatically validate proxy headers unless explicitly configured to trust certain proxies. Relying on `req.headers.get("x-forwarded-for")` is unsafe if the leftmost IP is taken blindly.
**Prevention:** Always use a robust IP extraction utility (like `getClientIp` which takes the rightmost IP appended by the trusted reverse proxy) instead of directly parsing proxy headers.
