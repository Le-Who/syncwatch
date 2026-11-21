## 2026-11-04 - Fix X-Forwarded-For IP Spoofing
**Vulnerability:** IP spoofing via `x-forwarded-for` header manipulation.
**Learning:** Extracting the left-most IP address from `x-forwarded-for` is dangerous because a malicious client can arbitrarily spoof it. The trusted proxy appends the real client IP to the right side of the header.
**Prevention:** Always extract the right-most IP address (e.g., using `.pop()`) when relying on `X-Forwarded-For` behind a trusted proxy.
