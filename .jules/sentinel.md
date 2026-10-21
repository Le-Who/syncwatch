## 2024-05-24 - IP Spoofing via X-Forwarded-For
**Vulnerability:** IP spoofing risk when parsing `X-Forwarded-For` by extracting the left-most IP. Malicious clients can send spoofed headers, resulting in incorrect IP extraction and bypassing rate limits/security controls.
**Learning:** Proxies append the real client IP to the right side of the `X-Forwarded-For` header. The left-most IP can be arbitrarily spoofed.
**Prevention:** Always extract the right-most IP address (e.g., using `.split(",")?.pop()?.trim()`) when parsing `X-Forwarded-For` behind a trusted proxy.
