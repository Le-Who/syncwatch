## 2026-11-09 - Prevent IP Spoofing in Rate Limiter
**Vulnerability:** IP Spoofing via `X-Forwarded-For` header. The leftmost IP address in `X-Forwarded-For` can be spoofed by a malicious client. The rate limiter incorrectly used the leftmost IP address to identify clients.
**Learning:** The rightmost IP address in the `X-Forwarded-For` header is appended by the trusted proxy, and is thus the reliable IP address.
**Prevention:** Always use the rightmost IP address in the `X-Forwarded-For` header when sitting behind a trusted proxy.
