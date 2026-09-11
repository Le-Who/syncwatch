## 2024-05-24 - Rate Limit Bypass via X-Forwarded-For Spoofing
**Vulnerability:** The application was reading the `x-forwarded-for` header directly for rate limiting and assigning IPs, allowing attackers to bypass rate limits by spoofing this header with a comma-separated list of fake IPs.
**Learning:** Next.js and typical Node.js environments do not automatically parse or sanitize `x-forwarded-for` correctly for rate limiting, simply treating it as a raw string. Attackers can trivially exploit this to avoid IP bans or rate limit buckets.
**Prevention:** Always parse the `x-forwarded-for` header from right to left, skipping internal or bogon IPs (trusted proxies), and use a dedicated `getClientIp` utility for any rate limiting or security logging.
