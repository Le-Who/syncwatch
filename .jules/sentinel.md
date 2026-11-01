## 2025-02-18 - X-Forwarded-For Spoofing
**Vulnerability:** The application extracts the left-most IP address from the X-Forwarded-For header when TRUST_PROXY is true. A malicious client can spoof this by sending their own X-Forwarded-For header, allowing them to bypass IP-based rate limiting or security checks.
**Learning:** The left-most IP address in X-Forwarded-For can be spoofed by the client. The trusted proxy appends the real client IP to the right side of the header, making the right-most IP the only trustworthy one.
**Prevention:** Always extract the right-most IP address (e.g., using `.split(",").pop()?.trim()`) from the X-Forwarded-For header when behind a trusted proxy.
