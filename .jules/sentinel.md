## 2024-05-18 - [Fix IP Spoofing in X-Forwarded-For parsing]
**Vulnerability:** Parsing the left-most IP address from the X-Forwarded-For header allowed a malicious client to arbitrarily spoof their IP address to bypass rate limits and ban checks.
**Learning:** The left-most IP is untrustworthy since clients can send their own X-Forwarded-For header. A trusted proxy will append the real client IP to the right side of the list.
**Prevention:** Always extract the right-most IP address (e.g., using `.pop()`) from the X-Forwarded-For header when relying on it for security checks behind a trusted proxy.
