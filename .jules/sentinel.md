
## 2026-09-26 - Prevent IP Spoofing and Rate Limit Bypass
**Vulnerability:** Directly reading `x-forwarded-for` from request headers allows clients to bypass rate-limiting and spoof IP addresses.
**Learning:** `x-forwarded-for` can contain a comma-separated list of IP addresses, and attackers can inject bogon or fake IPs.
**Prevention:** Always parse `x-forwarded-for` from right to left, skipping bogons, and use the provided `getClientIp` function from `lib/ip.ts`.
