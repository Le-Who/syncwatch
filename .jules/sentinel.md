## 2025-05-24 - [CRITICAL] Fix x-forwarded-for spoofing vulnerability

**Vulnerability:** The application was vulnerable to IP spoofing for rate-limit bypassing due to reading `x-forwarded-for` directly from headers, which attackers could manipulate to bypass limits since Next.js blindly trusts the header without reverse proxy configuration.
**Learning:** Naively trusting `x-forwarded-for` directly allows anyone to inject arbitrary IPs to circumvent IP-based security limits. The application should properly iterate through `x-forwarded-for` from right to left, skipping bogon (private/internal) IPs, to reliably extract the real client IP.
**Prevention:** Always use the dedicated `getClientIp` utility function from `lib/ip.ts` instead of directly accessing `request.headers.get("x-forwarded-for")` or `socket.handshake.headers["x-forwarded-for"]` across all API routes and WebSocket connections.
