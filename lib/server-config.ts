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
