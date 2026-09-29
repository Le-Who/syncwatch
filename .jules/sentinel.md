## 2025-05-27 - Rate Limit Bypass via spoofed X-Forwarded-For

**Vulnerability:** API routes and WebSockets blindly read `x-forwarded-for` directly from headers, which attackers can spoof (e.g. `X-Forwarded-For: 1.2.3.4`) to bypass rate limits.
**Learning:** Next.js and typical request objects pass along the raw `x-forwarded-for` header without automatically trusting/filtering based on upstream reverse proxies. Blindly trusting it allows trivial rate limit evasion.
**Prevention:** Always use a utility like `getClientIp` that parses the comma-separated `x-forwarded-for` header list from right to left, skipping any Bogon (private/internal) IPs to find the true, trusted client IP.
