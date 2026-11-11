## 2024-05-24 - IP Spoofing via X-Forwarded-For
**Vulnerability:** The rate limiter extracted the left-most IP address from the X-Forwarded-For header, which can be spoofed by malicious clients to bypass rate limiting.
**Learning:** When behind a trusted proxy, the proxy appends the real client IP to the right side of the XFF header. The left-most IP is untrusted.
**Prevention:** Always extract the right-most IP address using `.pop()` from the X-Forwarded-For header to prevent spoofing.
