## 2024-11-10 - IP Spoofing via X-Forwarded-For
**Vulnerability:** Application read the left-most IP address from the `X-Forwarded-For` header, allowing malicious clients to bypass rate limiting by injecting a spoofed IP.
**Learning:** Trusted proxies append the real client IP to the end of the `X-Forwarded-For` header. The left-most value can be controlled by the user.
**Prevention:** Always extract the right-most IP address (e.g., using `.pop()`) from the `X-Forwarded-For` header when behind a trusted proxy.
