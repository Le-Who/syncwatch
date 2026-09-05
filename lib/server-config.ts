export function normalizeAppOrigin(value: string | undefined): string {
  const configured = value?.trim();
  if (!configured) {
    throw new Error(
      "NEXT_PUBLIC_APP_URL is required in production for Socket.IO origin checks.",
    );
  }

  const withProtocol = /^[a-z][a-z\d+.-]*:\/\//i.test(configured)
    ? configured
    : /^(localhost|127\.0\.0\.1|\[::1\])(?::|\/|$)/i.test(configured)
      ? `http://${configured}`
      : `https://${configured}`;
  const parsed = new URL(withProtocol);
  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    parsed.username ||
    parsed.password
  ) {
    throw new Error(
      "NEXT_PUBLIC_APP_URL must be an HTTP(S) origin without credentials.",
    );
  }
  return parsed.origin;
}

export function isSocketOriginAllowed(
  requestOrigin: string | undefined,
  allowedOrigin: string,
): boolean {
  if (!requestOrigin) return false;
  try {
    return new URL(requestOrigin).origin === allowedOrigin;
  } catch {
    return false;
  }
}

/**
 * The custom Node server is the only component that can observe the direct
 * TCP peer. It replaces this internal header before an App Route sees the
 * request, so a client cannot choose the direct-mode rate-limit bucket.
 */
export function applyAuthoritativeClientIp(
  headers: Record<string, string | string[] | undefined>,
  peerAddress: string | undefined,
): void {
  delete headers["x-syncwatch-client-ip"];
  if (peerAddress) headers["x-syncwatch-client-ip"] = peerAddress;
}
