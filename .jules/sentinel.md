## 2024-11-06 - X-Forwarded-For Header IP Spoofing and Rate Limit Bypass

**Vulnerability:** Application uses `request.headers.get("x-forwarded-for")` to determine user IP, exposing it to header spoofing.
**Learning:** Always extract IP via custom robust logic that handles comma-separated values, checks against bogon IPs, and defaults securely, rather than just grabbing headers directly.
**Prevention:** Use a dedicated function (`getClientIp`) that safely handles bogon IPs instead of reading raw headers directly.
