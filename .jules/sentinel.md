## 2025-02-20 - [Fix X-Forwarded-For IP Spoofing]
**Vulnerability:** The application blindly trusted the left-most IP address from the `X-Forwarded-For` header when `TRUST_PROXY=true`. This allowed a malicious client to spoof their IP by sending their own `X-Forwarded-For` header, potentially bypassing rate limiting or IP bans.
**Learning:** The left-most IP in `X-Forwarded-For` is client-provided and can be spoofed. Only the IP appended by the trusted proxy (the right-most IP) is reliable.
**Prevention:** Always use the right-most IP address (`.split(",").pop()`) from the `X-Forwarded-For` header when behind a trusted proxy to ensure the IP is genuine and prevent spoofing attacks.
