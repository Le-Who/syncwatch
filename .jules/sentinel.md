## 2025-03-04 - Rate Limit Bypass via X-Forwarded-For Spoofing
**Vulnerability:** Attackers could bypass rate limiters by injecting arbitrary IPs into the `x-forwarded-for` header, as the system trusted the entire string without verifying it against bogon/private networks.
**Learning:** Directly reading `request.headers.get("x-forwarded-for")` or using the left-most value blindly trusts client input in proxies that append to the header rather than replace it.
**Prevention:** Always parse the `x-forwarded-for` header from right to left, skipping bogon (private/local) IP addresses to find the true, public client IP that connected to the edge. A dedicated utility function like `getClientIp` should enforce this pattern.
