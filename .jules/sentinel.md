## Sentinel's Journal

## 2024-05-18 - Prevent IP Spoofing via X-Forwarded-For
**Vulnerability:** The application was reading the left-most IP address from the `X-Forwarded-For` header. This allows malicious clients to spoof their IP address by providing their own `X-Forwarded-For` header, bypassing rate limits.
**Learning:** A trusted proxy appends the real client IP to the end of the `X-Forwarded-For` list. The left-most IP is untrusted as it can be set by the client.
**Prevention:** Always extract the right-most IP address (e.g., using `.pop()`) from `X-Forwarded-For` when relying on it behind a trusted proxy.
