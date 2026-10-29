## YYYY-MM-DD - Fix X-Forwarded-For IP Spoofing
**Vulnerability:** The application was reading the left-most IP address from the X-Forwarded-For header. This allows malicious clients to arbitrarily spoof their IP address by injecting their own X-Forwarded-For header, bypassing rate limiting and IP blocks.
**Learning:** The left-most IP address in the X-Forwarded-For header is client-provided and completely untrusted. The trusted proxy appends the real client IP to the right side of the header.
**Prevention:** Always extract the right-most IP address (e.g., using .pop()) from the X-Forwarded-For header when relying on it behind a trusted proxy.
