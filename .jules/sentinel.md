
## 2024-05-24 - Rate Limit Bypass via X-Forwarded-For Spoofing
**Vulnerability:** Attackers could bypass Redis rate limits on Next.js API routes and Socket.io connections by sending spoofed comma-separated `X-Forwarded-For` headers. The codebase was blindly trusting the first or entirety of the raw header string.
**Learning:** `x-forwarded-for` can easily be manipulated by clients. Reading it raw without parsing it right-to-left and filtering out private/bogon IPs allows trivially defeating rate limiters by changing the spoofed IP per request.
**Prevention:** Always use the centralized `getClientIp` function from `lib/ip.ts` which correctly parses the IP chain from right-to-left, skipping bogons to find the true client IP before applying rate limits.
