## 2024-05-24 - IP Spoofing via X-Forwarded-For
**Vulnerability:** The application was extracting the left-most IP address from the X-Forwarded-For header, allowing malicious clients to easily spoof their IP address.
**Learning:** Clients can provide their own XFF headers, and proxies append the real client IP to the right side. The left-most IP cannot be trusted.
**Prevention:** Always extract the right-most IP address from the XFF header (e.g., using `.pop()`) when relying on trusted proxies.
