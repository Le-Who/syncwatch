## 2024-05-18 - [IP Spoofing via X-Forwarded-For]
**Vulnerability:** The rate limiting logic was extracting the first (left-most) IP address from the `X-Forwarded-For` header. This allowed malicious clients to spoof their IP address and bypass rate limits by prepending a fake IP to the header.
**Learning:** In a trusted proxy setup, the reverse proxy appends the real client IP to the end (right side) of the `X-Forwarded-For` header. The left-most IP is user-controlled and untrustworthy.
**Prevention:** Always extract the right-most (last) IP address from the `X-Forwarded-For` header when relying on it for security checks like rate limiting, assuming the immediate reverse proxy is trusted.
