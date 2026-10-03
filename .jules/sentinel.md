
## 2024-05-30 - Fix IP spoofing vulnerability in x-forwarded-for parsing
**Vulnerability:** IP spoofing via crafted `x-forwarded-for` headers, leading to rate limit bypasses.
**Learning:** Using the first IP from `x-forwarded-for` allows attackers to easily bypass rate limits by prepending arbitrary IPs.
**Prevention:** Iterate through the `x-forwarded-for` header from right to left, selecting the first valid, non-bogon IP address to correctly identify the true client IP.
