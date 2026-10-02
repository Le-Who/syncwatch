import { execSync } from 'child_process';

const branchName = 'sentinel-fix-x-forwarded-for-spoofing';
const commitTitle = '🛡️ Sentinel: [CRITICAL] Fix x-forwarded-for spoofing vulnerability';
const commitMessage = `
🚨 Severity: CRITICAL
💡 Vulnerability: The application read 'x-forwarded-for' directly to determine the client IP, allowing attackers to spoof their IP address to bypass rate limits or attribute malicious actions to innocent users.
🎯 Impact: Attackers could bypass Redis rate limits on critical API endpoints and WebSocket connections, leading to denial of service or bruteforce vulnerabilities.
🔧 Fix: Implemented \`getClientIp\` from \`lib/ip.ts\` across all Next.js API routes and Socket.io event handlers to parse \`x-forwarded-for\` securely right-to-left, skipping bogon (private/internal) IPs.
✅ Verification: Ran \`pnpm lint\` and \`pnpm test\` successfully. Verified no direct usages of \`x-forwarded-for\` remain.
`;

execSync(`git add .`);
execSync(`git commit -m "${commitTitle}" -m "${commitMessage}"`);
