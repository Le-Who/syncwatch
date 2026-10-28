## YYYY-MM-DD - X-Forwarded-For IP Spoofing
**Vulnerability:** The application was using the left-most IP address (first) from the `X-Forwarded-For` header. This is a security vulnerability because the left-most IP can be arbitrarily spoofed by a malicious client.
**Learning:** When relying on `X-Forwarded-For` behind a trusted proxy, always extract the right-most IP address (e.g., using `.pop()`), as the left-most IP can be arbitrarily spoofed by a malicious client. The proxy appends the real client IP to the right side of the header.
**Prevention:** Always use the right-most IP from `X-Forwarded-For`.
## 2024-05-14 - IP Spoofing via X-Forwarded-For
**Vulnerability:** The application was vulnerable to IP spoofing because it trusted the first IP address in the X-Forwarded-For header, which can be easily forged by a malicious client.
**Learning:** When behind a trusted proxy, always use the right-most (last) IP address in the X-Forwarded-For header because it is the one reliably appended by the nearest trusted proxy.
**Prevention:** Always extract the last element of the comma-separated X-Forwarded-For list when identifying client IPs behind a trusted proxy.
