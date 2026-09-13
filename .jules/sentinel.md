## 2025-02-19 - Rate-Limit Bypass via IP Spoofing
**Vulnerability:** Direct parsing of `x-forwarded-for` headers was vulnerable to IP spoofing, allowing attackers to bypass rate limits by prepending bogus IP addresses to the header string.
**Learning:** `x-forwarded-for` strings can be easily modified by clients. Reading the header directly without scanning right-to-left and ignoring bogon/private IPs results in evaluating user-supplied strings instead of the true originating IP inserted by the trusted reverse proxy.
**Prevention:** Always use the dedicated `getClientIp` function from `lib/ip.ts`, which correctly parses the `x-forwarded-for` header from right to left, discarding untrusted and bogon IPs, to accurately determine the true client IP for rate limiting and logging.
