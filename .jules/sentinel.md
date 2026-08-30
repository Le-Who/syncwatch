## 2025-02-27 - Security Headers Missing

**Vulnerability:** Missing fundamental security headers (CSP, X-Frame-Options, HSTS, etc).
**Learning:** Next.js requires manual configuration for standard security headers in next.config.ts, they aren't added by default.
**Prevention:** Always verify security headers in next.config.ts for new Next.js projects to prevent clickjacking, MIME-sniffing, and enable HSTS.
