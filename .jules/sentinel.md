## 2024-03-12 - [IP Spoofing Vulnerability via X-Forwarded-For]
**Vulnerability:** The application extracted the left-most IP address from the `X-Forwarded-For` header, trusting client-provided spoofed IPs.
**Learning:** When a trusted proxy appends the real client IP to the `X-Forwarded-For` header, it appends it to the right side. The left-most IP can be arbitrarily controlled by a malicious client.
**Prevention:** When relying on `X-Forwarded-For` behind a trusted proxy, always extract the right-most IP address to use the proxy-verified IP and prevent spoofing.
