## 2024-05-18 - [Prevent X-Forwarded-For Spoofing]
**Vulnerability:** X-Forwarded-For spoofing via left-most IP extraction allowed rate limit bypass.
**Learning:** Blindly trusting the first IP in X-Forwarded-For is vulnerable because malicious clients can inject arbitrary IPs before the proxy appends the real one.
**Prevention:** When behind a trusted proxy, always extract the right-most IP address (using `.pop()`), as the proxy appends the true connection IP to the end of the list.
