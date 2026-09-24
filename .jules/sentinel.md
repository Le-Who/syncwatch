## 2025-03-03 - Rate Limit Bypass via x-forwarded-for Spoofing
**Vulnerability:** Rate limiting was bypassed because `request.headers.get("x-forwarded-for")` was blindly trusted and read directly.
**Learning:** Using `x-forwarded-for` directly without stripping bogons and starting from the rightmost IP allows an attacker to prepend a fake IP, effectively spoofing their origin and bypassing rate limits.
**Prevention:** Always use `getClientIp` utility which parses the comma-separated `x-forwarded-for` list correctly, discarding untrusted bogon/private IPs.
