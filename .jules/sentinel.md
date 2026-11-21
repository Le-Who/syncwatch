## 2024-03-20 - [X-Forwarded-For IP Spoofing]
**Vulnerability:** Application extracted the left-most IP from `x-forwarded-for` header for rate-limiting. A malicious client could spoof the header, and the trusted proxy would append the real IP to the right.
**Learning:** When behind a trusted proxy, always rely on the right-most IP in the `X-Forwarded-For` header, as left-most IPs can be arbitrarily manipulated.
**Prevention:** Use `.split(",").pop()?.trim()` instead of selecting the first item when extracting client IP from proxy headers.
