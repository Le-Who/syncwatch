## 2024-10-24 - Rate Limit Bypass via x-forwarded-for spoofing

**Vulnerability:** Attackers could bypass Redis rate limiting in API routes and Socket.io endpoints by sending spoofed, comma-separated IPs in the `X-Forwarded-For` header. Next.js natively extracts this verbatim without checking for bogon IPs or validating trusting proxies.
**Learning:** `request.headers.get("x-forwarded-for")` is naive and insecure. It blindly trusts user-supplied strings which lets attackers bypass security features (rate limiting, connection constraints).
**Prevention:** Always use the `getClientIp` function in `lib/ip.ts` that properly evaluates `cf-connecting-ip`, skips private/bogon IPs via `ipaddr.js` while parsing `x-forwarded-for`, and gracefully falls back to the true socket connection when handling incoming requests.
