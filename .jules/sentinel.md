## 2024-05-18 - [Rate Limit Bypass & IP Spoofing via x-forwarded-for]
**Vulnerability:** The application blindly trusted the `x-forwarded-for` header to retrieve the client IP in API routes and socket connections, and implicitly bypassed rate limits on `/api/auth/session` if the IP was `127.0.0.1`.
**Learning:** This permitted attackers to spoof their IP by sending `X-Forwarded-For: 127.0.0.1`, circumventing all rate limits (including authentication, creating a severe abuse vector). Also, blindly reading proxy headers allows rate limit bypass.
**Prevention:** Never read `x-forwarded-for` directly. Always use the new `getClientIp` utility function from `lib/ip.ts`, which parses the proxy chain securely from right to left, skipping bogon (private) IPs.
