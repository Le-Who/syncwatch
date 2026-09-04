export const getJwtSecret = (): Uint8Array => {
  const configuredSecret = process.env.JWT_SECRET?.trim();
  if (configuredSecret) {
    return new TextEncoder().encode(configuredSecret);
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "JWT_SECRET is required when NODE_ENV=production; configure a deployment secret before startup.",
    );
  }

  const warningState = globalThis as typeof globalThis & {
    __syncwatchJwtFallbackWarned?: boolean;
  };
  if (!warningState.__syncwatchJwtFallbackWarned) {
    console.warn(
      "JWT_SECRET is not configured; using the development-only session key.",
    );
    warningState.__syncwatchJwtFallbackWarned = true;
  }
  return new TextEncoder().encode("default_local_secret_dont_use_in_prod");
};
