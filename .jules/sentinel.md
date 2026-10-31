## 2024-05-24 - IP Spoofing via X-Forwarded-For

**Vulnerability:** IP rate limiting and tracking could be spoofed by users passing a malicious left-most IP in the X-Forwarded-For header.
**Learning:** When behind a trusted proxy, the proxy appends the real client IP to the right side of the header. Left-most values can be client-provided.
**Prevention:** Always extract the right-most IP address (e.g., using `.pop()`) when processing X-Forwarded-For behind a proxy.
