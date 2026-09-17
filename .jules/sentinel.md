## 2024-05-18 - Rate Limit Bypass via X-Forwarded-For Spoofing
**Vulnerability:** Rate limiting implementation directly read the `x-forwarded-for` header, allowing attackers to arbitrarily spoof their IP address to bypass rate limits.
**Learning:** Next.js and typical NodeJS request objects do not automatically sanitize `x-forwarded-for` to remove bogon/private IPs unless specifically configured with a trusted proxy setup.
**Prevention:** Always use a dedicated IP parsing utility (like `getClientIp` in `lib/ip.ts`) that scans the `x-forwarded-for` comma-separated list from right to left, skipping bogon IPs, before falling back to the socket's remote address.
