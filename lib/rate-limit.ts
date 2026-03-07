const rateLimitMap = new Map<string, { count: number; resetTime: number }>();

export function checkRateLimit(
  ip: string,
  limit: number = 20,
  windowMs: number = 60000,
): boolean {
  const now = Date.now();
  let record = rateLimitMap.get(ip);

  // Cleanup occasionally (simple heuristic to prevent map growing unbounded)
  if (rateLimitMap.size > 10000 && Math.random() < 0.01) {
    for (const [key, val] of rateLimitMap.entries()) {
      if (val.resetTime < now) rateLimitMap.delete(key);
    }
  }

  if (!record || record.resetTime < now) {
    record = { count: 1, resetTime: now + windowMs };
    rateLimitMap.set(ip, record);
    return true;
  }

  if (record.count >= limit) {
    return false;
  }

  record.count++;
  return true;
}
