## 2025-03-09 - [Fix Rate Limit Bypass via x-forwarded-for spoofing]
**Vulnerability:** Rate limit bypass and IP spoofing due to blindly trusting the `x-forwarded-for` header in multiple API and websocket endpoints.
**Learning:** `x-forwarded-for` is a comma-separated list of IPs added by proxies. Reading it blindly allows attackers to inject custom IPs and bypass rate limits or access internal APIs, as Next.js doesn't validate trusted proxies automatically.
**Prevention:** Always use the `getClientIp` utility function from `lib/ip.ts`, which correctly parses the comma-separated list from right to left, skipping bogons (private/local IPs), to determine the true client IP safely.
