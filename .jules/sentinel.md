## 2024-10-19 - [Fix IP spoofing via X-Forwarded-For]
**Vulnerability:** The application was reading the left-most IP address from the X-Forwarded-For header, which can be spoofed by clients.
**Learning:** Malicious clients can provide their own X-Forwarded-For header before reaching the trusted proxy. The trusted proxy appends the real client IP to the right side of the list, making the right-most IP the only trustworthy one.
**Prevention:** Always extract the right-most IP address (e.g., using `.pop()`) from the X-Forwarded-For header when behind a trusted proxy.
