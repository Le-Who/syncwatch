## 2025-02-28 - Fix X-Forwarded-For Rate Limit Bypass
**Vulnerability:** Attackers could spoof their IP address by manipulating the `x-forwarded-for` header, bypassing Redis rate limits entirely.
**Learning:** Blindly trusting `request.headers.get("x-forwarded-for")` is insecure. The header can contain a comma-separated list of IPs.
**Prevention:** Always use a utility like `getClientIp` to parse the header correctly from right to left, filtering out private (bogon) IPs to find the true external client IP.
