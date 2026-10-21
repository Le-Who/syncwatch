## 2023-10-24 - [IP Spoofing via X-Forwarded-For]

**Vulnerability:** X-Forwarded-For spoofing allowing Rate Limit Bypass.
**Learning:** The application was extracting the left-most IP from the `x-forwarded-for` header. Since clients can easily set this header to arbitrary values, a malicious user could bypass rate limits or access controls by prepending a fake IP. Trusted reverse proxies append the actual connection IP to the end (right side) of the header list.
**Prevention:** When operating behind a trusted reverse proxy, always extract the right-most IP (e.g. `forwardedFor.split(',').pop().trim()`) rather than the left-most IP to obtain the true client address.
