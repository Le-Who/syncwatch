## 2025-03-01 - IP Spoofing via X-Forwarded-For
**Vulnerability:** IP spoofing leading to rate limit bypass when reading client-provided `x-forwarded-for` left-most values.
**Learning:** Next.js and typical implementations extract the first (left-most) IP from X-Forwarded-For. A client can craft a malicious request adding their own X-Forwarded-For header. A trusted proxy appends the real IP to the end of this list. Trusting the first item means you trust the client's spoofed IP.
**Prevention:** Use the right-most IP (e.g., using `.pop()`) from the X-Forwarded-For header when relying on a trusted proxy, as that is the IP appended by the proxy itself.
