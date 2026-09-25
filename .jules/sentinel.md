## 2024-05-24 - [Rate Limit Bypass via x-forwarded-for Spoofing]

**Vulnerability:** The application was directly reading `x-forwarded-for` from request headers (`request.headers.get("x-forwarded-for")`) to determine the client IP address for rate limiting. This allowed attackers to bypass rate limits by spoofing the `x-forwarded-for` header with arbitrary IP addresses.
**Learning:** Directly trusting `x-forwarded-for` without properly parsing it and skipping bogons (private/internal IPs) is a security risk, especially when it's the primary mechanism for rate-limiting abusive requests.
**Prevention:** Always use the dedicated utility function (`getClientIp` in `lib/ip.ts`) which parses the `x-forwarded-for` list from right-to-left, skipping untrusted/private IPs, to reliably extract the true client IP.
