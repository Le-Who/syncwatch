## 2024-10-30 - Fix X-Forwarded-For IP Spoofing
**Vulnerability:** The application was reading the left-most IP address from the X-Forwarded-For header, allowing clients to spoof their IP by sending a custom X-Forwarded-For header before the proxy appends the real IP.
**Learning:** Malicious clients can supply their own X-Forwarded-For header. A trusted proxy will append the real client IP to the right side (end) of the header list, not the left.
**Prevention:** Always extract the right-most IP address from X-Forwarded-For headers when behind a trusted proxy.
