## 2024-10-24 - Rate Limit Bypass via x-forwarded-for spoofing
**Vulnerability:** Client IP was being read directly from `request.headers.get("x-forwarded-for")`. Since Next.js blindy trusts this header, attackers could send fake `x-forwarded-for` headers to arbitrarily bypass IP-based rate limits.
**Learning:** Never trust the `x-forwarded-for` header natively unless you control the ingress or reverse proxy setting up the trusted hop.
**Prevention:** Always use a utility function (like `getClientIp` using `ipaddr.js`) that parses the comma-separated `x-forwarded-for` list from right to left, actively skipping private IPs and bogons, in order to extract the real IP securely.
