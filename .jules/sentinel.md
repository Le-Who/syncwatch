
## 2024-05-19 - Rate Limit Bypass via X-Forwarded-For Spoofing
**Vulnerability:** Next.js API routes and Socket.io handlers trusted the `x-forwarded-for` header blindly (or via `request.headers.get`), allowing attackers to spoof IPs (e.g., `X-Forwarded-For: 1.2.3.4`) and easily bypass rate limiting limits.
**Learning:** Naively taking the first or all IPs from `x-forwarded-for` doesn't protect against spoofed headers sent by the client before hitting the reverse proxy. A correct implementation must parse from right to left, trusting only non-bogon IPs.
**Prevention:** Never read `x-forwarded-for` directly without sanitization. Always use `getClientIp` from `lib/ip.ts`, which safely parses from right to left and filters out bogon (private/local) addresses.
