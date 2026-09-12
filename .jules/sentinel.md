## 2024-03-20 - [Fix IP Spoofing & Rate Limit Bypass via x-forwarded-for]
**Vulnerability:** Reading `x-forwarded-for` directly without properly parsing it allowed clients to bypass rate limiting or spoof IPs by appending or modifying the header.
**Learning:** The `x-forwarded-for` header can contain a comma-separated list of IPs, including spoofed ones and proxies. Direct reads or reading from the left is insecure.
**Prevention:** Always parse `x-forwarded-for` from right to left, skipping known private/bogon IPs to find the true client IP. Use a utility like `getClientIp` in `lib/ip.ts` instead of directly accessing headers.
