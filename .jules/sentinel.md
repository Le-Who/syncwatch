
## 2024-05-24 - Rate Limit Bypass via X-Forwarded-For Spoofing
**Vulnerability:** API and WebSocket routes blindly read the `x-forwarded-for` header to identify client IP for rate limiting, allowing attackers to spoof their IP by sending custom `x-forwarded-for` headers and bypassing rate limits entirely.
**Learning:** Next.js and typical node setups blindly trust the `x-forwarded-for` header string. Since reverse proxies append to this comma-separated list, the true client IP must be parsed carefully by working right-to-left and ignoring bogon (internal/private) IPs, rather than just taking the whole string or the left-most value.
**Prevention:** Never read `x-forwarded-for` directly in endpoint handlers. Always use a centralized utility function (like `getClientIp`) that safely parses the comma-separated list right-to-left, skipping bogon IPs.
