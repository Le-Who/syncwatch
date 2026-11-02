## 2024-05-20 - Prevent IP Spoofing via X-Forwarded-For
**Vulnerability:** `x-forwarded-for` header values were parsed by taking the left-most IP, allowing malicious clients to spoof their IP by sending their own header before the proxy.
**Learning:** Trusted proxies append the real client IP to the right side of the `x-forwarded-for` header. Relying on the left-most IP allows IP spoofing and rate limit bypass.
**Prevention:** Always extract the right-most IP address (e.g., using `.pop()`) when parsing `X-Forwarded-For` behind a trusted proxy.
