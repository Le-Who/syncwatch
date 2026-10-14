## 2025-01-20 - Fix IP Spoofing in X-Forwarded-For
**Vulnerability:** IP spoofing via X-Forwarded-For where left-most IP is read directly.
**Learning:** The proxy appends the real client IP to the right side of the header. Reading the left-most IP can be arbitrarily spoofed by a malicious client.
**Prevention:** Always extract the right-most IP address using `.pop()` when parsing X-Forwarded-For.
