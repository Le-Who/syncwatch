## 2024-05-18 - Fix IP Spoofing via X-Forwarded-For Header
**Vulnerability:** X-Forwarded-For Header IP Spoofing
**Learning:** Using the left-most (first) IP from X-Forwarded-For allows spoofing. The trusted proxy appends the true client IP to the end of the list.
**Prevention:** Always extract the right-most IP address (e.g., using `.pop()`) from X-Forwarded-For headers.
