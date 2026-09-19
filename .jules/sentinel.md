## 2025-02-21 - Rate Limit Bypass via IP Spoofing
**Vulnerability:** The application was vulnerable to IP spoofing and rate limit bypass because it directly read the `x-forwarded-for` header without validation.
**Learning:** Directly trusting the `x-forwarded-for` header allows attackers to bypass IP-based rate limiting by forging the header (e.g. `X-Forwarded-For: 1.2.3.4`). Next.js and typical node setups blindly trust this header if not configured otherwise.
**Prevention:** Always use a utility function (like `getClientIp` in `lib/ip.ts`) that correctly parses the `x-forwarded-for` comma-separated list from right to left (most recent proxy to original client) and skips bogon IPs to determine the true client IP, before falling back to the socket's address.
