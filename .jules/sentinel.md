## 2025-02-21 - Fix X-Forwarded-For Spoofing
**Vulnerability:** IP spoofing rate limit bypass. `getClientIp` blindly trusted the left-most IP in `X-Forwarded-For`, which is user-controlled.
**Learning:** When behind a trusted proxy, the proxy appends the real client IP to the right side of the header. The left-most IP can be arbitrarily spoofed by a malicious client.
**Prevention:** Always extract the right-most IP from `X-Forwarded-For` when relying on it for rate-limiting.
