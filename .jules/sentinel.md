## 2024-05-24 - Rate Limit Bypass via x-forwarded-for Spoofing

**Vulnerability:** The application was directly reading the `x-forwarded-for` header from incoming requests (both API routes and WebSocket connections) without validating the source IP against trusted proxies. This allowed attackers to spoof their IP address and bypass rate limiting.
**Learning:** `x-forwarded-for` is a standard header used by reverse proxies, but it can be easily spoofed by malicious clients if the application does not verify the proxy.
**Prevention:** Never read `x-forwarded-for` directly. Always use a dedicated utility function (like `getClientIp` in `lib/ip.ts`) that correctly parses the comma-separated list from right to left (skipping bogon/private IPs) to find the true client IP, while ensuring the server itself doesn't get rate-limited.
