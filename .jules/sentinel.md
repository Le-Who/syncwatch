## 2024-10-04 - Fix IP Spoofing in Rate Limiters
**Vulnerability:** The application was extracting the client IP from the left-most value of the x-forwarded-for header, allowing attackers to spoof their IP address by injecting malicious comma-separated values.
**Learning:** When TRUST_PROXY is enabled, proxy chains append IPs to the right. Reading from the left trusts user input unconditionally. IPs should be parsed from right-to-left skipping bogons (private IPs) to find the first untrusted public IP.
**Prevention:** Always use right-to-left parsing with bogon filtering when extracting client IP from proxy headers to prevent rate limit bypassing.
