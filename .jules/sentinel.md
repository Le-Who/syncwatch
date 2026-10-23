## 2024-10-23 - [Prevent X-Forwarded-For IP Spoofing]
**Vulnerability:** X-Forwarded-For IP Spoofing allows attackers to bypass rate limits by providing fake IPs on the left side of the header.
**Learning:** The left-most IP in X-Forwarded-For can be arbitrarily spoofed by a malicious client. The right-most IP is the only one appended by the trusted proxy and is reliable.
**Prevention:** Always extract the right-most IP address from the X-Forwarded-For header using `.pop()` when behind a trusted proxy.
