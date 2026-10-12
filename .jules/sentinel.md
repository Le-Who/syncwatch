## 2025-02-18 - Fix X-Forwarded-For IP Spoofing
**Vulnerability:** The application was extracting the left-most IP address from the `X-Forwarded-For` header to identify the client IP. This allows malicious clients to spoof their IP address by injecting a fake IP address at the beginning of the header.
**Learning:** When using `X-Forwarded-For` behind a trusted proxy, the proxy appends the real client IP to the right side of the header.
**Prevention:** Always extract the right-most IP address (e.g., using `.pop()`) from the `X-Forwarded-For` header when behind a trusted proxy.
